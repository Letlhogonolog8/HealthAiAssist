#!/usr/bin/env python3
"""Chooses the lung model's decision threshold for a screening use case.

    python scripts/choose-lung-threshold.py [target_sensitivity]

WHY NOT JUST USE ARGMAX

Argmax is a threshold of 0.5, which implicitly says a missed cancer and a false
alarm cost the same. In screening they do not. At argmax the retrained model
scores 0.838 balanced accuracy but only 0.695 sensitivity — it misses roughly 3
in 10 cancers, while achieving a specificity (0.982) far higher than screening
needs.

The threshold is selected on the VALIDATION split to hit a target sensitivity,
then the test split is scored once at that fixed threshold. Choosing it on test
would make the reported figures optimistic.

Writes the chosen threshold into lung_model_training.json for inference to read.
"""
import json
import os
import sys

import numpy as np
import tensorflow as tf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'dataset', 'lung_cancer_MRI_dataset')
MODEL_PATH = os.path.join(OUT_DIR, 'resnet50v2_lung_cancer_model_v2.h5')
META_PATH = os.path.join(OUT_DIR, 'lung_model_training.json')
CACHE = os.path.join(OUT_DIR, '.feature_cache')

CLASSES = ['cancer', 'no_cancer']  # index 0 = cancer
SEED = 4242
TRAIN_FRACTION, VAL_FRACTION = 0.70, 0.15
DATA_ROOT = os.path.join(ROOT, 'dataset', 'dataset', 'lung_cancer_MRI_dataset')
SOURCE_DIRS = ['train', 'validate']


def split_labels():
    """Reproduces the training split to label the cached val/test features."""
    val, test = [], []
    for label, cls in enumerate(CLASSES):
        paths = []
        for split in SOURCE_DIRS:
            directory = os.path.join(DATA_ROOT, split, cls)
            if os.path.isdir(directory):
                paths += [
                    f for f in sorted(os.listdir(directory))
                    if f.lower().endswith(('.jpg', '.jpeg', '.png'))
                ]
        rng = np.random.RandomState(SEED + label)
        rng.shuffle(paths)
        n = len(paths)
        n_train, n_val = int(n * TRAIN_FRACTION), int(n * VAL_FRACTION)
        val += [label] * n_val
        test += [label] * (n - n_train - n_val)
    return np.array(val), np.array(test)


def evaluate(cancer_prob, labels, threshold):
    """Positive class is cancer (label 0)."""
    predicted_cancer = cancer_prob >= threshold
    is_cancer = labels == 0
    tp = int((predicted_cancer & is_cancer).sum())
    fn = int((~predicted_cancer & is_cancer).sum())
    tn = int((~predicted_cancer & ~is_cancer).sum())
    fp = int((predicted_cancer & ~is_cancer).sum())
    sens = tp / max(tp + fn, 1)
    spec = tn / max(tn + fp, 1)
    return {
        'threshold': round(float(threshold), 4),
        'sensitivity': round(sens, 4),
        'specificity': round(spec, 4),
        'balancedAccuracy': round((sens + spec) / 2, 4),
        'accuracy': round((tp + tn) / max(tp + tn + fp + fn, 1), 4),
        'confusion': {'TP': tp, 'FN': fn, 'TN': tn, 'FP': fp},
    }


def main():
    target = float(sys.argv[1]) if len(sys.argv) > 1 else 0.90

    head = tf.keras.models.load_model(MODEL_PATH).get_layer('classifier_head')
    y_val, y_test = split_labels()
    val_probs = head.predict(np.load(os.path.join(CACHE, 'val_r0.npy')), verbose=0)[:, 0]
    test_probs = head.predict(np.load(os.path.join(CACHE, 'test_r0.npy')), verbose=0)[:, 0]

    print(f'Target sensitivity: {target:.2f}\n', file=sys.stderr)
    print('Validation sweep:', file=sys.stderr)
    chosen = None
    for threshold in np.arange(0.95, 0.0, -0.01):
        result = evaluate(val_probs, y_val, threshold)
        if result['sensitivity'] >= target:
            chosen = result
            break
        if abs(threshold - round(threshold, 1)) < 1e-9:
            print(f"  t={threshold:.2f}  sens {result['sensitivity']:.3f}  "
                  f"spec {result['specificity']:.3f}", file=sys.stderr)

    if chosen is None:
        print(f'No threshold reaches sensitivity {target}. Leaving argmax (0.5).',
              file=sys.stderr)
        chosen = evaluate(val_probs, y_val, 0.5)

    print(f"\nChosen on validation: t={chosen['threshold']} "
          f"sens {chosen['sensitivity']:.3f} spec {chosen['specificity']:.3f}", file=sys.stderr)

    argmax_test = evaluate(test_probs, y_test, 0.5)
    tuned_test = evaluate(test_probs, y_test, chosen['threshold'])

    print('\nHeld-out test set:', file=sys.stderr)
    for label, result in (('argmax (0.50)', argmax_test), (f"tuned ({chosen['threshold']})", tuned_test)):
        print(f"  {label:16} sens {result['sensitivity']:.3f}  spec {result['specificity']:.3f}  "
              f"balAcc {result['balancedAccuracy']:.3f}  missed cancers {result['confusion']['FN']}",
              file=sys.stderr)

    with open(META_PATH) as f:
        meta = json.load(f)
    meta['operatingPoint'] = {
        'cancerThreshold': chosen['threshold'],
        'targetSensitivity': target,
        'selectedOn': 'validation split',
        'rationale': (
            'Screening favours catching disease over avoiding false alarms. Argmax '
            'implicitly weights a missed cancer and a false alarm equally, which is '
            'the wrong trade here.'
        ),
        'testAtArgmax': argmax_test,
        'testAtThreshold': tuned_test,
    }
    with open(META_PATH, 'w') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')
    print(f'\nWrote operating point to {META_PATH}', file=sys.stderr)


if __name__ == '__main__':
    main()
