#!/usr/bin/env python3
"""Skin outcomes at the banded thresholds the service actually uses.

    python scripts/measure-skin-bands.py

WHY THIS EXISTS SEPARATELY FROM evaluate-model.py

evaluate-model.py scores at argmax. The skin service does not use argmax: it
bands the malignant probability into benign (<=0.30), uncertain (0.30-0.70) and
malignant (>0.70). The clinically important number lives in that scheme and not
in the argmax matrix — how many malignant lesions receive an *outright benign*
result, which is the one outcome that actively reassures someone who has cancer.

Reproduces the three figures quoted in MODEL_CARDS.md and
docs/CLINICIAN_BRIEFING.md, so a clinician-facing claim is checkable rather than
inherited.
"""
import json, os
import numpy as np
from PIL import Image
import tensorflow as tf

ROOT = os.getcwd()
MODEL = os.path.join(ROOT, 'dataset', 'data', 'resnet50v2_skin_cancer_model.h5')
TEST = os.path.join(ROOT, 'dataset', 'dataset', 'data', 'test')
CLASSES = ['benign', 'malignant']  # index 0, 1
BENIGN_MAX, MALIGNANT_MIN = 0.30, 0.70

model = tf.keras.models.load_model(MODEL)
out = {}
for label, cls in enumerate(CLASSES):
    d = os.path.join(TEST, cls)
    names = sorted(f for f in os.listdir(d) if f.lower().endswith(('.jpg', '.jpeg', '.png')))
    batch = np.array([np.array(Image.open(os.path.join(d, n)).convert('RGB').resize((224, 224)),
                               dtype=np.float32) for n in names])
    p = model.predict(batch, verbose=0)[:, 1]  # P(malignant)
    out[cls] = p

mal = out['malignant']
ben = out['benign']
total = len(mal) + len(ben)
uncertain = int(((mal > BENIGN_MAX) & (mal < MALIGNANT_MIN)).sum() +
                ((ben > BENIGN_MAX) & (ben < MALIGNANT_MIN)).sum())
print(json.dumps({
    'nMalignant': len(mal),
    'nBenign': len(ben),
    'malignantGivenOutrightBenign': int((mal <= BENIGN_MAX).sum()),
    'malignantFlaggedOrEscalated': int((mal > BENIGN_MAX).sum()),
    'pctMalignantEscalated': round(float((mal > BENIGN_MAX).mean()) * 100, 1),
    'allScansInUncertainBand': uncertain,
    'pctAllScansUncertain': round(uncertain / total * 100, 1),
}, indent=2))
