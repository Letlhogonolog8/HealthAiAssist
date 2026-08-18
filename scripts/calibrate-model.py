#!/usr/bin/env python3
"""Measures and corrects the calibration of an image classifier.

    python scripts/calibrate-model.py skin
    python scripts/calibrate-model.py lung

WHY THIS MATTERS

The service reports the model's softmax output as "confidence" — a result reads
"malignant, 94.7% confidence". A clinician will read that as "a 94.7% chance this
is malignant". Softmax output is not that probability. Neural networks are
routinely overconfident, and an uncalibrated 94.7% may correspond to a far lower
true frequency of malignancy.

Calibration measures the gap and temperature scaling corrects it (Guo et al.,
"On Calibration of Modern Neural Networks", ICML 2017). Temperature is fitted on
the VALIDATION split — never on the test set, which would make the reported
improvement meaningless.

Because the saved model ends in a softmax, the logits are recovered as log(p).
Softmax is shift-invariant, so softmax(log(p)/T) is exactly temperature scaling.

Outputs dataset/data/skin_model_calibration.json, which inference then applies.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
import tensorflow as tf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_SIZE = (224, 224)
EPS = 1e-12

# Split parameters must match each training script or the "validation" split
# leaks into what is meant to be a clean fit.
MODELS = {
    'skin': {
        'model': os.path.join(ROOT, 'dataset', 'data', 'resnet50v2_skin_cancer_model.h5'),
        'cache': os.path.join(ROOT, 'dataset', 'data', '.feature_cache'),
        'out': os.path.join(ROOT, 'dataset', 'data', 'skin_model_calibration.json'),
        'classes': ['benign', 'malignant'],
        'split': 'holdout',           # test lives in its own directory
        'train_dir': os.path.join(ROOT, 'dataset', 'dataset', 'data', 'train'),
        'test_dir': os.path.join(ROOT, 'dataset', 'dataset', 'data', 'test'),
        'val_fraction': 0.15,
        'seed': 1337,
    },
    'lung': {
        'model': os.path.join(
            ROOT, 'dataset', 'lung_cancer_MRI_dataset', 'resnet50v2_lung_cancer_model.h5'),
        'cache': os.path.join(ROOT, 'dataset', 'lung_cancer_MRI_dataset', '.feature_cache'),
        'out': os.path.join(
            ROOT, 'dataset', 'lung_cancer_MRI_dataset', 'lung_model_calibration.json'),
        'classes': ['cancer', 'no_cancer'],
        'split': 'three_way',         # pooled and re-split; test features are cached
        'data_root': os.path.join(ROOT, 'dataset', 'dataset', 'lung_cancer_MRI_dataset'),
        'source_dirs': ['train', 'validate'],
        'train_fraction': 0.70,
        'val_fraction': 0.15,
        'seed': 4242,
    },
}


def split_labels(config):
    """Reproduces the training split so cached features can be labelled."""
    val, test = [], []
    for label, cls in enumerate(config['classes']):
        if config['split'] == 'holdout':
            directory = os.path.join(config['train_dir'], cls)
            paths = sorted(
                f for f in os.listdir(directory)
                if f.lower().endswith(('.jpg', '.jpeg', '.png'))
            )
            rng = np.random.RandomState(config['seed'] + label)
            rng.shuffle(paths)
            cut = int(len(paths) * (1 - config['val_fraction']))
            val += [label] * (len(paths) - cut)
        else:
            paths = []
            for source in config['source_dirs']:
                directory = os.path.join(config['data_root'], source, cls)
                if os.path.isdir(directory):
                    paths += [
                        f for f in sorted(os.listdir(directory))
                        if f.lower().endswith(('.jpg', '.jpeg', '.png'))
                    ]
            rng = np.random.RandomState(config['seed'] + label)
            rng.shuffle(paths)
            n = len(paths)
            n_train = int(n * config['train_fraction'])
            n_val = int(n * config['val_fraction'])
            val += [label] * n_val
            test += [label] * (n - n_train - n_val)
    return np.array(val), np.array(test)


def load_test_images(config):
    """Only needed when the test split is a directory rather than cached features."""
    images, labels = [], []
    for label, cls in enumerate(config['classes']):
        directory = os.path.join(config['test_dir'], cls)
        for name in sorted(os.listdir(directory)):
            try:
                img = Image.open(os.path.join(directory, name)).convert('RGB').resize(IMG_SIZE)
            except Exception:
                continue
            images.append(np.array(img, dtype=np.float32))
            labels.append(label)
    return np.array(images), np.array(labels)


def apply_temperature(probs, temperature):
    logits = np.log(np.clip(probs, EPS, 1.0)) / temperature
    logits -= logits.max(axis=1, keepdims=True)
    exp = np.exp(logits)
    return exp / exp.sum(axis=1, keepdims=True)


def nll(probs, labels):
    return float(-np.mean(np.log(np.clip(probs[np.arange(len(labels)), labels], EPS, 1.0))))


def brier(probs, labels):
    """Brier score on the positive (malignant) class. Lower is better."""
    return float(np.mean((probs[:, 1] - labels) ** 2))


def expected_calibration_error(probs, labels, bins=10):
    """Average gap between stated confidence and observed accuracy, weighted by bin size."""
    confidence = probs.max(axis=1)
    predicted = probs.argmax(axis=1)
    correct = (predicted == labels).astype(float)

    ece = 0.0
    table = []
    edges = np.linspace(0, 1, bins + 1)
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (confidence > lo) & (confidence <= hi)
        n = int(mask.sum())
        if not n:
            continue
        avg_conf = float(confidence[mask].mean())
        avg_acc = float(correct[mask].mean())
        ece += (n / len(labels)) * abs(avg_conf - avg_acc)
        table.append({
            'range': f'{lo:.1f}-{hi:.1f}', 'n': n,
            'statedConfidence': round(avg_conf, 4), 'observedAccuracy': round(avg_acc, 4),
            'gap': round(avg_conf - avg_acc, 4),
        })
    return float(ece), table


def fit_temperature(probs, labels):
    """Grid then local search for the temperature minimising validation NLL."""
    grid = np.arange(0.25, 6.01, 0.05)
    losses = [nll(apply_temperature(probs, t), labels) for t in grid]
    best = float(grid[int(np.argmin(losses))])

    fine = np.arange(max(0.05, best - 0.05), best + 0.05, 0.005)
    losses = [nll(apply_temperature(probs, t), labels) for t in fine]
    return float(fine[int(np.argmin(losses))])


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else 'skin'
    if name not in MODELS:
        raise SystemExit(f'Unknown model "{name}". Choose from: {", ".join(MODELS)}')
    config = MODELS[name]

    model = tf.keras.models.load_model(config['model'])
    head = model.get_layer('classifier_head')

    val_cache = os.path.join(config['cache'], 'val_r0.npy')
    if not os.path.exists(val_cache):
        print(f'Missing {val_cache}. Run the training script for {name} first.',
              file=sys.stderr)
        sys.exit(1)

    y_val, y_test_cached = split_labels(config)

    # Validation probabilities come from cached features — the trunk is frozen, so
    # this is identical to running the images and takes a second instead of minutes.
    val_features = np.load(val_cache)
    if len(val_features) != len(y_val):
        print(f'Validation cache has {len(val_features)} rows but the split reproduces '
              f'{len(y_val)} labels. Split parameters have drifted from training.',
              file=sys.stderr)
        sys.exit(1)

    val_probs = head.predict(val_features, verbose=0)
    temperature = fit_temperature(val_probs, y_val)
    print(f'[{name}] fitted temperature on {len(y_val)} validation samples: '
          f'T = {temperature:.3f}', file=sys.stderr)

    # Whether to deploy the correction is decided on VALIDATION. Choosing it by
    # test-set improvement would be selecting on the held-out data and would make
    # the reported figures optimistic.
    val_ece_before, _ = expected_calibration_error(val_probs, y_val)
    val_ece_after, _ = expected_calibration_error(apply_temperature(val_probs, temperature), y_val)
    apply_correction = val_ece_after < val_ece_before * 0.9
    deployed_temperature = temperature if apply_correction else 1.0

    print(f'  validation ECE {val_ece_before:.4f} -> {val_ece_after:.4f}', file=sys.stderr)
    print(f'  decision: {"apply" if apply_correction else "do NOT apply"} temperature scaling',
          file=sys.stderr)

    test_cache = os.path.join(config['cache'], 'test_r0.npy')
    if os.path.exists(test_cache):
        print('Scoring the cached held-out test features...', file=sys.stderr)
        test_probs = head.predict(np.load(test_cache), verbose=0)
        y_test = y_test_cached
    else:
        print('Scoring the held-out test images...', file=sys.stderr)
        x_test, y_test = load_test_images(config)
        test_probs = model.predict(x_test, verbose=0, batch_size=16)

    calibrated = apply_temperature(test_probs, deployed_temperature)
    ece_before, table_before = expected_calibration_error(test_probs, y_test)
    ece_after, table_after = expected_calibration_error(calibrated, y_test)

    report = {
        'model': os.path.basename(config['model']),
        'method': 'temperature scaling (Guo et al., ICML 2017)',
        # What inference actually applies. 1.0 means the identity: measured, and
        # found not to need correcting.
        'temperature': round(deployed_temperature, 4),
        'fittedTemperature': round(temperature, 4),
        'applied': apply_correction,
        'decision': (
            'Temperature scaling applied: it improved validation ECE.'
            if apply_correction else
            'Temperature scaling measured but NOT applied. The fitted correction did '
            'not improve validation ECE by a meaningful margin, so applying it would '
            'add complexity for no gain.'
        ),
        'validation': {
            'expectedCalibrationErrorBefore': round(val_ece_before, 4),
            'expectedCalibrationErrorAfterFittedT': round(val_ece_after, 4),
        },
        'fittedOn': f'validation split, n={len(y_val)}',
        'evaluatedOn': f'held-out test set, n={len(y_test)}',
        'before': {
            'expectedCalibrationError': round(ece_before, 4),
            'brierScore': round(brier(test_probs, y_test), 4),
            'negativeLogLikelihood': round(nll(test_probs, y_test), 4),
            'reliability': table_before,
        },
        'after': {
            'expectedCalibrationError': round(ece_after, 4),
            'brierScore': round(brier(calibrated, y_test), 4),
            'negativeLogLikelihood': round(nll(calibrated, y_test), 4),
            'reliability': table_after,
        },
        'note': (
            'Accuracy is unchanged by temperature scaling — it is monotonic, so the '
            'argmax never moves. What changes is whether the stated probability can '
            'be read as a likelihood. An ECE near 0.02 means the stated probability '
            'and the observed frequency agree to within about two percentage points.'
        ),
    }

    with open(config['out'], 'w') as f:
        json.dump(report, f, indent=2)
        f.write('\n')

    print(f"\nWrote {config['out']}", file=sys.stderr)
    print(f'  ECE   {ece_before:.4f} -> {ece_after:.4f}', file=sys.stderr)
    print(f"  Brier {brier(test_probs, y_test):.4f} -> {brier(calibrated, y_test):.4f}",
          file=sys.stderr)
    print('\n  Reliability before calibration (stated vs observed):', file=sys.stderr)
    for row in table_before:
        print(f"    {row['range']}  n={row['n']:4d}  stated {row['statedConfidence']:.3f} "
              f"observed {row['observedAccuracy']:.3f}  gap {row['gap']:+.3f}", file=sys.stderr)



if __name__ == '__main__':
    main()
