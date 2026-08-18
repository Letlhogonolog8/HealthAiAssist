#!/usr/bin/env python3
"""Builds an out-of-distribution detector for the skin cancer classifier.

    python scripts/build-ood-reference.py

THE PROBLEM

A classifier answers whatever it is given. Feed the skin model a chest X-ray, a
photograph of a cat, or a blurred thumb and it returns "malignant, 97%" with no
indication that the question was nonsense. Softmax confidence does not detect
this — networks are frequently *most* confident on inputs unlike anything they
were trained on.

THE METHOD

Principal components are fitted to the ResNet features of the training images.
An image resembling the training distribution reconstructs well from those
components; an unrelated image does not. The reconstruction error is the OOD
score, and the threshold is a high percentile of the training distribution.

This is cheap — one matrix multiply on a feature vector the model already
computes — and needs no second model or outlier training data.

The threshold is deliberately set at the 99.5th percentile of training error:
rejecting roughly 1 in 200 genuine lesions is a far better trade than confidently
classifying a photograph of a wall.

Writes dataset/data/skin_ood_reference.npz and skin_model_ood.json.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
import tensorflow as tf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_PATH = os.path.join(ROOT, 'dataset', 'data', 'resnet50v2_skin_cancer_model.h5')
CACHE = os.path.join(ROOT, 'dataset', 'data', '.feature_cache')
TEST_DIR = os.path.join(ROOT, 'dataset', 'dataset', 'data', 'test')
LUNG_DIR = os.path.join(ROOT, 'dataset', 'dataset', 'lung_cancer_MRI_dataset', 'validate')
NPZ_OUT = os.path.join(ROOT, 'dataset', 'data', 'skin_ood_reference.npz')
JSON_OUT = os.path.join(ROOT, 'dataset', 'data', 'skin_model_ood.json')

N_COMPONENTS = 64
PERCENTILE = 99.5
IMG_SIZE = (224, 224)


def feature_extractor(model):
    """Model mapping raw 0-255 RGB to the 2048-d ResNet feature vector."""
    inputs = model.input
    x = model.get_layer('resnet_v2_preprocess')(inputs)
    features = model.get_layer('resnet50v2')(x)
    return tf.keras.Model(inputs, features)


def reconstruction_error(features, mean, components):
    centred = features - mean
    projected = centred @ components.T
    reconstructed = projected @ components
    return np.linalg.norm(centred - reconstructed, axis=1)


def load_images(directory, limit=None):
    images = []
    for name in sorted(os.listdir(directory)):
        if not name.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        try:
            img = Image.open(os.path.join(directory, name)).convert('RGB').resize(IMG_SIZE)
        except Exception:
            continue
        images.append(np.array(img, dtype=np.float32))
        if limit and len(images) >= limit:
            break
    return np.array(images)


def main():
    train_cache = os.path.join(CACHE, 'train_r0.npy')
    if not os.path.exists(train_cache):
        print(f'Missing {train_cache}. Run scripts/train-skin-cancer-model.py first.',
              file=sys.stderr)
        sys.exit(1)

    train_features = np.load(train_cache).astype(np.float64)
    print(f'Training features: {train_features.shape}', file=sys.stderr)

    # PCA by SVD on the centred features.
    mean = train_features.mean(axis=0)
    centred = train_features - mean
    _, singular, vt = np.linalg.svd(centred, full_matrices=False)
    components = vt[:N_COMPONENTS]
    explained = float((singular[:N_COMPONENTS] ** 2).sum() / (singular ** 2).sum())
    print(f'{N_COMPONENTS} components explain {explained:.1%} of variance', file=sys.stderr)

    train_error = reconstruction_error(train_features, mean, components)
    threshold = float(np.percentile(train_error, PERCENTILE))
    print(f'Threshold at p{PERCENTILE}: {threshold:.3f}', file=sys.stderr)

    np.savez_compressed(NPZ_OUT, mean=mean.astype(np.float32),
                        components=components.astype(np.float32),
                        threshold=np.float32(threshold))
    print(f'Wrote {NPZ_OUT}', file=sys.stderr)

    # ---- validate the detector actually separates in- from out-of-distribution ----
    model = tf.keras.models.load_model(MODEL_PATH)
    # The trunk is a nested model applied to the rescaling output, so its `.output`
    # belongs to its own graph. Re-apply the layers to the outer input instead of
    # reaching into it.
    trunk = feature_extractor(model)

    def rate_for(images, label):
        features = trunk.predict(images, verbose=0, batch_size=16).astype(np.float64)
        errors = reconstruction_error(features, mean, components)
        flagged = float((errors > threshold).mean())
        print(f'  {label:34} n={len(images):4d}  median error {np.median(errors):7.3f}  '
              f'flagged {flagged:6.1%}', file=sys.stderr)
        return {'n': len(images), 'medianError': round(float(np.median(errors)), 3),
                'flaggedRate': round(flagged, 4)}

    print('\nValidation:', file=sys.stderr)
    checks = {}

    held_out = load_images(os.path.join(TEST_DIR, 'benign'), limit=120)
    checks['heldOutSkinLesions'] = rate_for(held_out, 'held-out skin lesions (in-dist)')

    if os.path.isdir(os.path.join(LUNG_DIR, 'cancer')):
        lung = load_images(os.path.join(LUNG_DIR, 'cancer'), limit=120)
        checks['chestImages'] = rate_for(lung, 'chest images (wrong modality)')

    rng = np.random.RandomState(0)
    noise = rng.randint(0, 256, size=(60, *IMG_SIZE, 3)).astype(np.float32)
    checks['randomNoise'] = rate_for(noise, 'random noise')

    flat = np.full((60, *IMG_SIZE, 3), 128.0, dtype=np.float32)
    checks['blankGrey'] = rate_for(flat, 'blank grey frames')

    report = {
        'model': os.path.basename(MODEL_PATH),
        'method': f'PCA reconstruction error in ResNet feature space, {N_COMPONENTS} components',
        'components': N_COMPONENTS,
        'varianceExplained': round(explained, 4),
        'thresholdPercentile': PERCENTILE,
        'threshold': round(threshold, 4),
        'fittedOn': f'{len(train_features)} training images',
        'validation': checks,
        'interpretation': (
            'Flagged rate should be near the expected false-positive rate on held-out '
            'skin lesions, and high on inputs from other domains. A flagged image is '
            'refused rather than classified.'
        ),
    }
    with open(JSON_OUT, 'w') as f:
        json.dump(report, f, indent=2)
        f.write('\n')
    print(f'\nWrote {JSON_OUT}', file=sys.stderr)


if __name__ == '__main__':
    main()
