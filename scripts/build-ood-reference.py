#!/usr/bin/env python3
"""Builds an out-of-distribution detector for an image classifier.

    python scripts/build-ood-reference.py skin
    python scripts/build-ood-reference.py lung

THE PROBLEM

A classifier answers whatever it is given. Feed the skin model a chest X-ray, or
the lung model a photograph of a mole, and it returns a confident verdict with no
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
rejecting roughly 1 in 200 genuine images is a far better trade than confidently
classifying a photograph of a wall.

A feature-space detector alone is not sufficient. A blank frame sits near the
mean and reconstructs cleanly, so it scores as perfectly in-distribution — it is
caught by the pixel-level checks in the inference scripts instead.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
import tensorflow as tf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
N_COMPONENTS = 64
PERCENTILE = 99.5
IMG_SIZE = (224, 224)

# Per-model paths, plus the domains used to check the detector actually
# separates in- from out-of-distribution. The "wrong modality" source for each
# model is the other model's data, which is the most realistic confusion.
MODELS = {
    'skin': {
        'model': os.path.join(ROOT, 'dataset', 'data', 'resnet50v2_skin_cancer_model.h5'),
        'cache': os.path.join(ROOT, 'dataset', 'data', '.feature_cache'),
        'npz': os.path.join(ROOT, 'dataset', 'data', 'skin_ood_reference.npz'),
        'json': os.path.join(ROOT, 'dataset', 'data', 'skin_model_ood.json'),
        'in_distribution': os.path.join(ROOT, 'dataset', 'dataset', 'data', 'test', 'benign'),
        'wrong_modality': os.path.join(
            ROOT, 'dataset', 'dataset', 'lung_cancer_MRI_dataset', 'validate', 'cancer'),
        'wrong_modality_label': 'chest images (wrong modality)',
    },
    'lung': {
        'model': os.path.join(
            ROOT, 'dataset', 'lung_cancer_MRI_dataset', 'resnet50v2_lung_cancer_model.h5'),
        'cache': os.path.join(ROOT, 'dataset', 'lung_cancer_MRI_dataset', '.feature_cache'),
        'npz': os.path.join(ROOT, 'dataset', 'lung_cancer_MRI_dataset', 'lung_ood_reference.npz'),
        'json': os.path.join(ROOT, 'dataset', 'lung_cancer_MRI_dataset', 'lung_model_ood.json'),
        'in_distribution': os.path.join(
            ROOT, 'dataset', 'dataset', 'lung_cancer_MRI_dataset', 'validate', 'no_cancer'),
        'wrong_modality': os.path.join(ROOT, 'dataset', 'dataset', 'data', 'test', 'benign'),
        'wrong_modality_label': 'skin lesions (wrong modality)',
    },
}


def feature_extractor(model):
    """Raw 0-255 RGB to the 2048-d ResNet feature vector.

    The trunk is nested and applied to the rescaling output, so its `.output`
    belongs to a separate graph; the layers are re-applied to the outer input.
    """
    inputs = model.input
    x = model.get_layer('resnet_v2_preprocess')(inputs)
    return tf.keras.Model(inputs, model.get_layer('resnet50v2')(x))


def reconstruction_error(features, mean, components):
    centred = features - mean
    projected = centred @ components.T
    reconstructed = projected @ components
    return np.linalg.norm(centred - reconstructed, axis=1)


def load_images(directory, limit=None):
    images = []
    if not os.path.isdir(directory):
        return np.array(images)
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
    name = sys.argv[1] if len(sys.argv) > 1 else 'skin'
    if name not in MODELS:
        raise SystemExit(f'Unknown model "{name}". Choose from: {", ".join(MODELS)}')
    config = MODELS[name]

    train_cache = os.path.join(config['cache'], 'train_r0.npy')
    if not os.path.exists(train_cache):
        print(f'Missing {train_cache}. Run the training script for {name} first.',
              file=sys.stderr)
        sys.exit(1)

    train_features = np.load(train_cache).astype(np.float64)
    print(f'[{name}] training features: {train_features.shape}', file=sys.stderr)

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

    np.savez_compressed(config['npz'], mean=mean.astype(np.float32),
                        components=components.astype(np.float32),
                        threshold=np.float32(threshold))
    print(f"Wrote {config['npz']}", file=sys.stderr)

    # ---- validate the detector actually separates the domains ----
    model = tf.keras.models.load_model(config['model'])
    trunk = feature_extractor(model)

    def rate_for(images, label):
        if not len(images):
            return None
        features = trunk.predict(images, verbose=0, batch_size=16).astype(np.float64)
        errors = reconstruction_error(features, mean, components)
        flagged = float((errors > threshold).mean())
        print(f'  {label:34} n={len(images):4d}  median error {np.median(errors):7.3f}  '
              f'flagged {flagged:6.1%}', file=sys.stderr)
        return {'n': len(images), 'medianError': round(float(np.median(errors)), 3),
                'flaggedRate': round(flagged, 4)}

    print('\nValidation:', file=sys.stderr)
    checks = {}
    checks['inDistribution'] = rate_for(
        load_images(config['in_distribution'], limit=120), 'held-out, same modality')
    checks['wrongModality'] = rate_for(
        load_images(config['wrong_modality'], limit=120), config['wrong_modality_label'])

    rng = np.random.RandomState(0)
    checks['randomNoise'] = rate_for(
        rng.randint(0, 256, size=(60, *IMG_SIZE, 3)).astype(np.float32), 'random noise')
    checks['blankGrey'] = rate_for(
        np.full((60, *IMG_SIZE, 3), 128.0, dtype=np.float32), 'blank grey frames')

    report = {
        'model': os.path.basename(config['model']),
        'method': f'PCA reconstruction error in ResNet feature space, {N_COMPONENTS} components',
        'components': N_COMPONENTS,
        'varianceExplained': round(explained, 4),
        'thresholdPercentile': PERCENTILE,
        'threshold': round(threshold, 4),
        'fittedOn': f'{len(train_features)} training images',
        'validation': checks,
        'interpretation': (
            'Flagged rate should be near the expected false-positive rate on held-out '
            'images of the same modality, and high on inputs from other domains. A '
            'flagged image is refused rather than classified. Blank frames are caught '
            'by pixel-level checks, not by this detector.'
        ),
    }
    with open(config['json'], 'w') as f:
        json.dump(report, f, indent=2)
        f.write('\n')
    print(f"\nWrote {config['json']}", file=sys.stderr)


if __name__ == '__main__':
    main()
