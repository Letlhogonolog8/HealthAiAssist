#!/usr/bin/env python3
"""Reproduces the lung nodule characteriser's figures at its operating point.

    python scripts/verify-lung-nodule-operating-point.py

WHAT IT REPRODUCES, AND FROM WHAT

The held-out split from `dataset/lidc-ct/patches.csv` — the manifest the
training script wrote, which records the patient-level split and the nodule
identity of every patch — scored by the artifact on disk, in the order the
service applies: softmax, temperature (1.0: fitted and not applied), threshold
on P(malignant) read from lung_nodule_training.json.

Two figures come out, and only one is publishable:

  per nodule   the mean of P(malignant) over the (up to five) slices of each
               nodule, thresholded once. This is what lung_nodule_training.json
               publishes and what MODEL_REGISTRY carries.

  per patch    every slice scored on its own. This is CLOSER to how route 1
               serves — a clinician marks one slice, not five — and it is
               printed so the card can say so. Its interval is too tight by
               construction (five slices of one lesion are not five cases), so
               it is never the headline.

Exits non-zero if the per-nodule figures drift from what the registry
publishes by more than 0.005, so a retrain that forgets the registry fails
here rather than in front of a reader.
"""
import collections
import csv
import hashlib
import json
import math
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(ROOT, 'dataset', 'lung_nodule_model')
MODEL_PATH = os.path.join(MODEL_DIR, 'resnet50v2_lung_nodule_model.h5')
TRAINING = os.path.join(MODEL_DIR, 'lung_nodule_training.json')
CALIBRATION = os.path.join(MODEL_DIR, 'lung_nodule_model_calibration.json')
PATCH_ROOT = os.path.join(ROOT, 'dataset', 'lidc-ct')
MANIFEST = os.path.join(PATCH_ROOT, 'patches.csv')
OUT = os.path.join(MODEL_DIR, 'lung_nodule_verification.json')

IMG_SIZE = (224, 224)
CLASSES = ['cancer', 'no_cancer']  # index 0 = cancer


def wilson(successes, total, z=1.96):
    if total == 0:
        return (0.0, 0.0, 1.0)
    p = successes / total
    d = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / d
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d
    return (round(p, 4), round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4))


def score(is_cancer, prob, threshold):
    flagged = prob >= threshold
    tp = int((is_cancer & flagged).sum()); fn = int((is_cancer & ~flagged).sum())
    tn = int((~is_cancer & ~flagged).sum()); fp = int((~is_cancer & flagged).sum())
    sens, slo, shi = wilson(tp, tp + fn)
    spec, plo, phi = wilson(tn, tn + fp)
    return {
        'threshold': threshold,
        'sensitivity': sens, 'sensitivityCI95': [slo, shi],
        'specificity': spec, 'specificityCI95': [plo, phi],
        'balancedAccuracy': round((sens + spec) / 2, 4),
        'confusion': {'TP': tp, 'FN': fn, 'TN': tn, 'FP': fp},
        'n': int(len(is_cancer)),
    }


def fingerprint(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()[:12]


def apply_temperature(probs, temperature):
    if temperature == 1.0:
        return probs
    logits = np.log(np.clip(probs, 1e-12, 1.0)) / temperature
    logits -= logits.max(axis=1, keepdims=True)
    exp = np.exp(logits)
    return exp / exp.sum(axis=1, keepdims=True)


def main():
    for required in (MODEL_PATH, TRAINING, MANIFEST):
        if not os.path.exists(required):
            raise SystemExit(f'Missing {required}')

    with open(TRAINING) as f:
        training = json.load(f)
    calibration = {}
    if os.path.exists(CALIBRATION):
        with open(CALIBRATION) as f:
            calibration = json.load(f)
    threshold = float(training['operatingPoint']['threshold'])
    temperature = float(calibration.get('temperature', 1.0)) if calibration.get('applied') else 1.0
    print(f'threshold {threshold}, temperature {temperature} (applied={bool(calibration.get("applied"))})',
          file=sys.stderr)

    rows = [r for r in csv.DictReader(open(MANIFEST, encoding='utf-8')) if r['split'] == 'test']
    print(f'test patches: {len(rows)}', file=sys.stderr)

    import tensorflow as tf
    model = tf.keras.models.load_model(MODEL_PATH)

    probs = []
    for i in range(0, len(rows), 32):
        batch = np.array([
            np.array(Image.open(os.path.join(PATCH_ROOT, r['path'].replace('/', os.sep)))
                     .convert('RGB').resize(IMG_SIZE), dtype=np.float32)
            for r in rows[i:i + 32]
        ])
        probs.append(model.predict(batch, verbose=0))
    probs = apply_temperature(np.concatenate(probs, axis=0), temperature)
    p_cancer = probs[:, 0]

    # Per patch — the serving regime for a single marked slice.
    is_cancer_patch = np.array([r['label'] == 'cancer' for r in rows])
    per_patch = score(is_cancer_patch, p_cancer, threshold)

    # Per nodule — mean over the nodule's slices, the published figure.
    grouped = collections.defaultdict(list)
    labels = {}
    for r, p in zip(rows, p_cancer):
        grouped[r['nodule_id']].append(float(p))
        labels[r['nodule_id']] = r['label'] == 'cancer'
    ids = sorted(grouped)
    per_nodule = score(
        np.array([labels[i] for i in ids]),
        np.array([np.mean(grouped[i]) for i in ids]),
        threshold,
    )

    published = training['test']['perNodule']
    drift = {
        k: round(abs(per_nodule[k] - published[k]), 4)
        for k in ('sensitivity', 'specificity')
        if abs(per_nodule[k] - published[k]) > 0.005
    }

    report = {
        'model': os.path.basename(MODEL_PATH),
        'artifactFingerprint': fingerprint(MODEL_PATH),
        'verifiedAt': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
        'split': 'test rows of dataset/lidc-ct/patches.csv (patient-level split, decided before extraction)',
        'operatingPoint': {
            'threshold': threshold,
            'temperature': temperature,
            'note': 'Softmax, temperature (not applied: 1.0), threshold on P(malignant) — the order the service applies.',
        },
        'perNodule': per_nodule,
        'perPatch': per_patch,
        'publishedPerNodule': {k: published[k] for k in ('sensitivity', 'specificity', 'balancedAccuracy', 'confusion', 'n')},
        'matchesPublished': not drift,
        'drift': drift,
        'note': (
            'perNodule is the published figure. perPatch is closer to how a single marked '
            'slice is served and its interval is optimistic by construction (five slices of '
            'one lesion are five correlated cases).'
        ),
    }
    with open(OUT, 'w') as f:
        json.dump(report, f, indent=2)
        f.write('\n')
    print(json.dumps(report, indent=2))

    if drift:
        print(f'\nDOES NOT MATCH lung_nodule_training.json: {drift}', file=sys.stderr)
        raise SystemExit(1)
    print('\nMatches the published per-nodule figures at the deployed operating point.', file=sys.stderr)


if __name__ == '__main__':
    main()
