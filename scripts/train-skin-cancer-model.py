#!/usr/bin/env python3
"""Retrain the skin cancer classifier (benign vs malignant).

Replaces an artifact that scored at chance (balanced accuracy 0.50) and whose
training code no longer existed, so its preprocessing and class order could not
be recovered. See MODEL_CARDS.md.

Two decisions carried by this script:

1. **Preprocessing is baked into the model.** The saved graph starts with a
   Rescaling layer implementing resnet_v2's x/127.5-1, so the served model takes
   raw 0-255 RGB. Inference cannot silently disagree with training about
   normalisation, which is the failure mode that made the old artifact unusable.

2. **Frozen backbone, trained head.** ImageNet features are extracted once and
   cached, then a small classifier is fitted on them. This box is CPU-only with
   ~1GB free RAM; full fine-tuning would thrash. Feature extraction over 2637
   images is a few minutes and fits comfortably.

The test split is never touched here. Evaluate separately:

    python scripts/evaluate-model.py \\
        dataset/data/resnet50v2_skin_cancer_model.h5 \\
        dataset/dataset/data/test benign malignant raw_0_255
"""
import json
import os
import sys

import numpy as np
from PIL import Image
import tensorflow as tf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRAIN_DIR = os.path.join(ROOT, "dataset", "dataset", "data", "train")
OUT_MODEL = os.path.join(ROOT, "dataset", "data", "resnet50v2_skin_cancer_model.h5")
OUT_META = os.path.join(ROOT, "dataset", "data", "skin_model_training.json")
# Extracted features are cached so an interrupted run does not repeat the
# expensive forward passes. Derived data — gitignored.
CACHE = os.path.join(ROOT, "dataset", "data", ".feature_cache")

IMG_SIZE = (224, 224)
# Index order must match the inference service and evaluate-model.py.
CLASSES = ["benign", "malignant"]
VAL_FRACTION = 0.15
SEED = 1337
EXTRACT_BATCH = 32
AUG_ROUNDS = 2  # original + 2 augmented copies of the training set


def list_images(split_dir, cls):
    d = os.path.join(split_dir, cls)
    return [os.path.join(d, f) for f in sorted(os.listdir(d))
            if f.lower().endswith((".jpg", ".jpeg", ".png"))]


def load_batch(paths, augment_fn=None):
    """Load images as raw float32 0-255, optionally augmented."""
    out = []
    for p in paths:
        img = Image.open(p).convert("RGB")
        if img.size != IMG_SIZE:
            img = img.resize(IMG_SIZE)
        arr = np.array(img, dtype=np.float32)
        if augment_fn is not None:
            arr = augment_fn(arr)
        out.append(arr)
    return np.array(out, dtype=np.float32)


def augment(arr):
    """Flips and 90-degree rotations. Dermoscopy images have no canonical
    orientation, so these are label-preserving."""
    if np.random.rand() < 0.5:
        arr = arr[:, ::-1, :]
    if np.random.rand() < 0.5:
        arr = arr[::-1, :, :]
    k = np.random.randint(4)
    if k:
        arr = np.rot90(arr, k=k)
    return np.ascontiguousarray(arr)


def build_backbone():
    """ResNet50V2 trunk with preprocessing fused in. Input is raw 0-255 RGB."""
    inputs = tf.keras.Input(shape=(*IMG_SIZE, 3), name="raw_rgb_0_255")
    # resnet_v2.preprocess_input is exactly x/127.5 - 1
    x = tf.keras.layers.Rescaling(scale=1.0 / 127.5, offset=-1.0, name="resnet_v2_preprocess")(inputs)
    trunk = tf.keras.applications.ResNet50V2(
        include_top=False, weights="imagenet", pooling="avg", input_shape=(*IMG_SIZE, 3)
    )
    trunk.trainable = False
    outputs = trunk(x, training=False)
    return tf.keras.Model(inputs, outputs, name="resnet50v2_features"), trunk


def extract_features(model, paths, augment_rounds=0, cache_name=None):
    """Forward-pass images through the frozen trunk, in small batches.

    Each augmentation round is cached separately, so an interrupted run resumes
    from the last completed round instead of redoing every forward pass.
    """
    n = len(paths)
    rounds = [None] + [augment] * augment_rounds
    all_feats = []

    for r_idx, fn in enumerate(rounds):
        cache_path = os.path.join(CACHE, f"{cache_name}_r{r_idx}.npy") if cache_name else None
        if cache_path and os.path.exists(cache_path):
            print(f"  round {r_idx}: cached", flush=True)
            all_feats.append(np.load(cache_path))
            continue

        feats = []
        for i in range(0, n, EXTRACT_BATCH):
            chunk = paths[i:i + EXTRACT_BATCH]
            feats.append(model.predict(load_batch(chunk, augment_fn=fn), verbose=0))
            if (i // EXTRACT_BATCH) % 10 == 0:
                print(f"  round {r_idx}: {min(i + EXTRACT_BATCH, n)}/{n}", flush=True)
        arr = np.concatenate(feats, axis=0)
        if cache_path:
            os.makedirs(CACHE, exist_ok=True)
            np.save(cache_path, arr)
        print(f"  round {r_idx}: done ({len(arr)})", flush=True)
        all_feats.append(arr)

    return np.concatenate(all_feats, axis=0)


def balanced_accuracy(y_true, y_pred):
    accs = []
    for c in (0, 1):
        mask = y_true == c
        accs.append(float((y_pred[mask] == c).mean()))
    return sum(accs) / 2, accs[1], accs[0]  # balanced, sensitivity, specificity


def main():
    np.random.seed(SEED)
    tf.random.set_seed(SEED)
    tf.keras.utils.set_random_seed(SEED)

    # ---- split train/val (test dir is untouched) -------------------------
    train_paths, train_labels, val_paths, val_labels = [], [], [], []
    for label, cls in enumerate(CLASSES):
        paths = list_images(TRAIN_DIR, cls)
        rng = np.random.RandomState(SEED + label)
        rng.shuffle(paths)
        cut = int(len(paths) * (1 - VAL_FRACTION))
        train_paths += paths[:cut]
        train_labels += [label] * cut
        val_paths += paths[cut:]
        val_labels += [label] * (len(paths) - cut)

    y_train = np.array(train_labels)
    y_val = np.array(val_labels)
    print(f"train={len(train_paths)} (benign={int((y_train==0).sum())}, "
          f"malignant={int((y_train==1).sum())})  val={len(val_paths)}", flush=True)

    # ---- cache features --------------------------------------------------
    feature_model, trunk = build_backbone()
    print("Extracting training features...", flush=True)
    x_train = extract_features(feature_model, train_paths,
                               augment_rounds=AUG_ROUNDS, cache_name="train")
    y_train_full = np.tile(y_train, AUG_ROUNDS + 1)
    print("Extracting validation features...", flush=True)
    x_val = extract_features(feature_model, val_paths, cache_name="val")

    # ---- fit the head ----------------------------------------------------
    feat_dim = x_train.shape[1]
    head = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(feat_dim,)),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(256, activation="relu"),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(len(CLASSES), activation="softmax"),
    ], name="classifier_head")
    head.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )

    counts = np.bincount(y_train_full, minlength=2)
    class_weight = {i: float(len(y_train_full) / (2 * counts[i])) for i in range(2)}
    print(f"class_weight={class_weight}", flush=True)

    head.fit(
        x_train, y_train_full,
        validation_data=(x_val, y_val),
        epochs=60, batch_size=64, class_weight=class_weight, verbose=2,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(
                monitor="val_loss", patience=10, restore_best_weights=True),
            tf.keras.callbacks.ReduceLROnPlateau(
                monitor="val_loss", factor=0.5, patience=4, min_lr=1e-5),
        ],
    )

    val_pred = head.predict(x_val, verbose=0).argmax(axis=1)
    bal, sens, spec = balanced_accuracy(y_val, val_pred)
    print(f"\nVALIDATION balanced_accuracy={bal:.4f} sensitivity={sens:.4f} "
          f"specificity={spec:.4f}", flush=True)

    # ---- assemble and save a single end-to-end model ---------------------
    inputs = tf.keras.Input(shape=(*IMG_SIZE, 3), name="raw_rgb_0_255")
    x = tf.keras.layers.Rescaling(1.0 / 127.5, offset=-1.0, name="resnet_v2_preprocess")(inputs)
    x = trunk(x, training=False)
    outputs = head(x)
    full = tf.keras.Model(inputs, outputs, name="resnet50v2_skin_cancer")
    full.save(OUT_MODEL)
    print(f"Saved {OUT_MODEL}", flush=True)

    with open(OUT_META, "w") as f:
        json.dump({
            "classes": CLASSES,
            "classIndexOrder": {c: i for i, c in enumerate(CLASSES)},
            "inputRange": "raw RGB 0-255 (preprocessing fused into the model)",
            "imageSize": list(IMG_SIZE),
            "backbone": "ResNet50V2 ImageNet, frozen",
            "augmentRounds": AUG_ROUNDS,
            "seed": SEED,
            "validation": {
                "balancedAccuracy": round(bal, 4),
                "sensitivity": round(sens, 4),
                "specificity": round(spec, 4),
                "n": int(len(y_val)),
            },
            "note": "Test split not used during training or model selection.",
        }, f, indent=2)
    print(f"Saved {OUT_META}", flush=True)


if __name__ == "__main__":
    main()
