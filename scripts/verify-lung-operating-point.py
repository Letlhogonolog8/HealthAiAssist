#!/usr/bin/env python3
"""Verifies the lung figures at the operating point actually deployed.

    python scripts/verify-lung-operating-point.py

WHY evaluate-model.py IS NOT ENOUGH

That script scores at argmax, which is a threshold of 0.5 and implicitly says a
missed cancer and a false alarm cost the same. This model does not run at
argmax. It applies temperature scaling and then thresholds the calibrated
P(cancer) at 0.30, and the figures MODEL_REGISTRY publishes — sensitivity
0.8121, specificity 0.757 — are the figures at that operating point, not at
argmax.

So argmax reproduction is necessary and not sufficient: it confirms the weights,
not the deployed behaviour. This reproduces the serving path end to end on the
held-out split, in the same order the service applies it:

    softmax -> temperature scaling -> threshold on P(cancer)

Reads the temperature and threshold from the same files the service reads, so a
change to either is picked up here rather than silently diverging.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
import tensorflow as tf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(ROOT, 'dataset', 'lung_cancer_MRI_dataset')
MODEL_PATH = os.path.join(MODEL_DIR, 'resnet50v2_lung_cancer_model.h5')
TEST_DIR = os.path.join(MODEL_DIR, 'test')
CALIBRATION = os.path.join(MODEL_DIR, 'lung_model_calibration.json')
TRAINING = os.path.join(MODEL_DIR, 'lung_model_training.json')

CLASSES = ['cancer', 'no_cancer']  # index 0 = cancer
IMG_SIZE = (224, 224)


def load_config():
    with open(CALIBRATION) as f:
        cal = json.load(f)
    with open(TRAINING) as f:
        train = json.load(f)
    temperature = float(cal.get('temperature', 1.0)) if cal.get('applied') else 1.0
    threshold = float(train['operatingPoint']['cancerThreshold'])
    return temperature, threshold


def apply_temperature(probs, temperature):
    """Batch form of the service's _apply_temperature, row-wise."""
    if temperature == 1.0:
        return probs
    logits = np.log(np.clip(probs, 1e-12, 1.0)) / temperature
    logits -= logits.max(axis=1, keepdims=True)
    exp = np.exp(logits)
    return exp / exp.sum(axis=1, keepdims=True)


def main():
    if not os.path.isdir(TEST_DIR):
        raise SystemExit(
            'No test split. Run: python scripts/materialise-lung-test-split.py'
        )

    temperature, threshold = load_config()
    print(f'temperature {temperature}, cancer threshold {threshold}', file=sys.stderr)

    model = tf.keras.models.load_model(MODEL_PATH)

    counts = {}
    p_cancer = {}
    for cls in CLASSES:
        directory = os.path.join(TEST_DIR, cls)
        names = sorted(
            f for f in os.listdir(directory)
            if f.lower().endswith(('.jpg', '.jpeg', '.png'))
        )
        batch = np.array([
            np.array(Image.open(os.path.join(directory, n)).convert('RGB').resize(IMG_SIZE),
                     dtype=np.float32)
            for n in names
        ])
        probs = apply_temperature(model.predict(batch, verbose=0), temperature)
        p_cancer[cls] = probs[:, 0]  # index 0 is cancer
        counts[cls] = len(names)
        print(f'  {cls}: {len(names)} images', file=sys.stderr)

    # Sensitivity is recall on cancer at the deployed threshold.
    tp = int((p_cancer['cancer'] > threshold).sum())
    fn = counts['cancer'] - tp
    tn = int((p_cancer['no_cancer'] <= threshold).sum())
    fp = counts['no_cancer'] - tn

    sensitivity = tp / counts['cancer']
    specificity = tn / counts['no_cancer']

    report = {
        'model': os.path.basename(MODEL_PATH),
        'dataset': os.path.relpath(TEST_DIR, ROOT).replace(os.sep, '/'),
        'operatingPoint': {
            'calibrationTemperature': temperature,
            'cancerThreshold': threshold,
            'note': 'Softmax, then temperature scaling, then threshold on P(cancer). '
                    'The order the service applies it.',
        },
        'counts': counts,
        'sensitivity': round(sensitivity, 4),
        'specificity': round(specificity, 4),
        'balancedAccuracy': round((sensitivity + specificity) / 2, 4),
        'confusion': {'TP': tp, 'FN': fn, 'TN': tn, 'FP': fp},
        'cancersMissed': fn,
    }
    print(json.dumps(report, indent=2))

    # Compare against what MODEL_REGISTRY publishes, so a drift is a failure
    # rather than something a reader has to notice.
    published = {'sensitivity': 0.8121, 'specificity': 0.757}
    drift = {
        k: round(abs(report[k] - v), 4)
        for k, v in published.items()
        if abs(report[k] - v) > 0.005
    }
    if drift:
        print(f'\nDOES NOT MATCH MODEL_REGISTRY: {drift}', file=sys.stderr)
        raise SystemExit(1)

    print('\nMatches the published figures at the deployed operating point.',
          file=sys.stderr)


if __name__ == '__main__':
    main()
