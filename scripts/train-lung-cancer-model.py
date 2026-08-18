#!/usr/bin/env python3
"""Retrains the lung cancer classifier with a genuine held-out test set.

    python scripts/train-lung-cancer-model.py

WHY RETRAIN RATHER THAN JUST SPLIT OFF A TEST SET

The existing model reports 0.75 balanced accuracy measured on
`lung_cancer_MRI_dataset/validate`. That directory was the validation generator
during the original training run (see server/train-lung-cancer-model.py), so the
model was selected against it. The figure is optimistic and no untouched data
exists anywhere in the repository — carving a "test set" out of either directory
would just relabel data the model has already been tuned on.

So the two directories are pooled and re-split three ways: train / validation /
test, stratified, with a fixed seed. The test split is touched exactly once, at
evaluation. That produces a number that means what it says.

Mirrors scripts/train-skin-cancer-model.py: frozen ResNet50V2 trunk, trained
head, preprocessing fused into the saved graph so inference cannot disagree with
training about normalisation.

Writes to resnet50v2_lung_cancer_model_v2.h5 — the existing artifact is left
alone until the new one has been evaluated and deliberately promoted.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
import tensorflow as tf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_ROOT = os.path.join(ROOT, 'dataset', 'dataset', 'lung_cancer_MRI_dataset')
OUT_DIR = os.path.join(ROOT, 'dataset', 'lung_cancer_MRI_dataset')
OUT_MODEL = os.path.join(OUT_DIR, 'resnet50v2_lung_cancer_model_v2.h5')
OUT_META = os.path.join(OUT_DIR, 'lung_model_training.json')
SPLIT_MANIFEST = os.path.join(OUT_DIR, 'lung_splits.json')
CACHE = os.path.join(OUT_DIR, '.feature_cache')

IMG_SIZE = (224, 224)
# Index order must match server/lung-cancer-service.py: 0 = cancer, 1 = no_cancer.
CLASSES = ['cancer', 'no_cancer']
SOURCE_DIRS = ['train', 'validate']
TRAIN_FRACTION, VAL_FRACTION = 0.70, 0.15  # test takes the remaining 15%
SEED = 4242
EXTRACT_BATCH = 32
AUG_ROUNDS = 2


def list_images(cls):
    """Every image for a class, pooled across the original directories."""
    paths = []
    for split in SOURCE_DIRS:
        directory = os.path.join(DATA_ROOT, split, cls)
        if not os.path.isdir(directory):
            continue
        for name in sorted(os.listdir(directory)):
            if name.lower().endswith(('.jpg', '.jpeg', '.png')):
                paths.append(os.path.join(directory, name))
    return paths


def load_batch(paths, augment_fn=None):
    out = []
    for path in paths:
        img = Image.open(path).convert('RGB')
        if img.size != IMG_SIZE:
            img = img.resize(IMG_SIZE)
        arr = np.array(img, dtype=np.float32)
        if augment_fn is not None:
            arr = augment_fn(arr)
        out.append(arr)
    return np.array(out, dtype=np.float32)


def augment(arr):
    """Horizontal flip and small shifts. No vertical flip or rotation: chest
    images have a canonical orientation, unlike dermoscopy."""
    if np.random.rand() < 0.5:
        arr = arr[:, ::-1, :]
    shift = np.random.randint(-12, 13, size=2)
    arr = np.roll(arr, shift, axis=(0, 1))
    return np.ascontiguousarray(arr)


def build_backbone():
    inputs = tf.keras.Input(shape=(*IMG_SIZE, 3), name='raw_rgb_0_255')
    x = tf.keras.layers.Rescaling(1.0 / 127.5, offset=-1.0, name='resnet_v2_preprocess')(inputs)
    trunk = tf.keras.applications.ResNet50V2(
        include_top=False, weights='imagenet', pooling='avg', input_shape=(*IMG_SIZE, 3)
    )
    trunk.trainable = False
    return tf.keras.Model(inputs, trunk(x, training=False), name='resnet50v2_features'), trunk


def extract(model, paths, cache_name, augment_rounds=0):
    n = len(paths)
    rounds = [None] + [augment] * augment_rounds
    chunks = []

    for r_idx, fn in enumerate(rounds):
        cache_path = os.path.join(CACHE, f'{cache_name}_r{r_idx}.npy')
        if os.path.exists(cache_path):
            print(f'  {cache_name} round {r_idx}: cached', flush=True)
            chunks.append(np.load(cache_path))
            continue

        feats = []
        for i in range(0, n, EXTRACT_BATCH):
            batch = load_batch(paths[i:i + EXTRACT_BATCH], augment_fn=fn)
            feats.append(model.predict(batch, verbose=0))
            if (i // EXTRACT_BATCH) % 15 == 0:
                print(f'  {cache_name} round {r_idx}: {min(i + EXTRACT_BATCH, n)}/{n}', flush=True)
        arr = np.concatenate(feats, axis=0)
        os.makedirs(CACHE, exist_ok=True)
        np.save(cache_path, arr)
        print(f'  {cache_name} round {r_idx}: done ({len(arr)})', flush=True)
        chunks.append(arr)

    return np.concatenate(chunks, axis=0)


def metrics(y_true, y_pred):
    """Positive class is index 0 (cancer) — sensitivity is cancer detection."""
    tp = int(((y_true == 0) & (y_pred == 0)).sum())
    fn = int(((y_true == 0) & (y_pred == 1)).sum())
    tn = int(((y_true == 1) & (y_pred == 1)).sum())
    fp = int(((y_true == 1) & (y_pred == 0)).sum())
    sens = tp / max(tp + fn, 1)
    spec = tn / max(tn + fp, 1)
    return {
        'sensitivity': round(sens, 4), 'specificity': round(spec, 4),
        'balancedAccuracy': round((sens + spec) / 2, 4),
        'accuracy': round((tp + tn) / max(tp + tn + fp + fn, 1), 4),
        'confusion': {'TP': tp, 'FN': fn, 'TN': tn, 'FP': fp},
    }


def main():
    np.random.seed(SEED)
    tf.keras.utils.set_random_seed(SEED)

    splits = {'train': ([], []), 'val': ([], []), 'test': ([], [])}
    for label, cls in enumerate(CLASSES):
        paths = list_images(cls)
        rng = np.random.RandomState(SEED + label)
        rng.shuffle(paths)

        n = len(paths)
        n_train = int(n * TRAIN_FRACTION)
        n_val = int(n * VAL_FRACTION)
        parts = {
            'train': paths[:n_train],
            'val': paths[n_train:n_train + n_val],
            'test': paths[n_train + n_val:],
        }
        for name, group in parts.items():
            splits[name][0].extend(group)
            splits[name][1].extend([label] * len(group))
        print(f'{cls}: {n} total -> train {len(parts["train"])}, '
              f'val {len(parts["val"])}, test {len(parts["test"])}', flush=True)

    # Record which file went where, so the test split can be audited as untouched.
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(SPLIT_MANIFEST, 'w') as f:
        json.dump({
            'seed': SEED, 'classes': CLASSES,
            'note': 'Pooled from the original train/ and validate/ directories and '
                    're-split. The test entries were used only for final evaluation.',
            'counts': {k: len(v[0]) for k, v in splits.items()},
            'test': [os.path.relpath(p, ROOT) for p in splits['test'][0]],
        }, f, indent=1)
    print(f'Wrote split manifest {SPLIT_MANIFEST}', flush=True)

    feature_model, trunk = build_backbone()

    print('Extracting features...', flush=True)
    x_train = extract(feature_model, splits['train'][0], 'train', AUG_ROUNDS)
    y_train = np.tile(np.array(splits['train'][1]), AUG_ROUNDS + 1)
    x_val = extract(feature_model, splits['val'][0], 'val')
    y_val = np.array(splits['val'][1])
    x_test = extract(feature_model, splits['test'][0], 'test')
    y_test = np.array(splits['test'][1])

    head = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(x_train.shape[1],)),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(256, activation='relu'),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(len(CLASSES), activation='softmax'),
    ], name='classifier_head')
    head.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
                 loss='sparse_categorical_crossentropy', metrics=['accuracy'])

    counts = np.bincount(y_train, minlength=2)
    class_weight = {i: float(len(y_train) / (2 * counts[i])) for i in range(2)}
    print(f'class_weight={class_weight}', flush=True)

    head.fit(
        x_train, y_train, validation_data=(x_val, y_val),
        epochs=60, batch_size=64, class_weight=class_weight, verbose=2,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(monitor='val_loss', patience=10,
                                             restore_best_weights=True),
            tf.keras.callbacks.ReduceLROnPlateau(monitor='val_loss', factor=0.5,
                                                 patience=4, min_lr=1e-5),
        ],
    )

    val_metrics = metrics(y_val, head.predict(x_val, verbose=0).argmax(axis=1))
    test_metrics = metrics(y_test, head.predict(x_test, verbose=0).argmax(axis=1))
    print(f'\nVALIDATION {val_metrics}', flush=True)
    print(f'TEST       {test_metrics}', flush=True)

    inputs = tf.keras.Input(shape=(*IMG_SIZE, 3), name='raw_rgb_0_255')
    x = tf.keras.layers.Rescaling(1.0 / 127.5, offset=-1.0, name='resnet_v2_preprocess')(inputs)
    full = tf.keras.Model(inputs, head(trunk(x, training=False)), name='resnet50v2_lung_cancer')
    full.save(OUT_MODEL)
    print(f'Saved {OUT_MODEL}', flush=True)

    with open(OUT_META, 'w') as f:
        json.dump({
            'classes': CLASSES,
            'classIndexOrder': {c: i for i, c in enumerate(CLASSES)},
            'inputRange': 'raw RGB 0-255 (preprocessing fused into the model)',
            'imageSize': list(IMG_SIZE),
            'backbone': 'ResNet50V2 ImageNet, frozen',
            'seed': SEED,
            'splitCounts': {k: len(v[0]) for k, v in splits.items()},
            'validation': val_metrics,
            'test': test_metrics,
            'note': 'Test split held out from training and model selection. Pooled and '
                    're-split because the original validate/ directory was used as the '
                    'validation generator during the previous training run.',
        }, f, indent=2)
    print(f'Saved {OUT_META}', flush=True)


if __name__ == '__main__':
    main()
