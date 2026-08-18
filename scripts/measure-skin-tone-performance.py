#!/usr/bin/env python3
"""Measures skin classifier performance across skin tones.

    python scripts/measure-skin-tone-performance.py

WHY THIS EXISTS

The model card has said "performance across skin tones is unknown" since the
model was retrained. That is honest but incomplete, and it is the one gap that
matters most: if sensitivity is materially lower on darker skin, the system
under-detects melanoma in exactly the population already facing worse outcomes,
while looking like it works.

The dataset carries no Fitzpatrick labels, so they are estimated from the images.

THE METHOD

Individual Typology Angle (ITA), the standard proxy used in dermatology-AI
fairness work when labels are absent:

    ITA = arctan((L* - 50) / b*) in degrees

computed on the *healthy skin around* the lesion, not the lesion itself. Lesions
are typically central, so a border ring is sampled and pixels that are obviously
not skin — near-black (vignetting, dermoscope aperture, hair) and specular
highlights — are discarded before taking the median.

Bins follow the usual Chardon / Del Bino cut points.

WHAT ITA IS NOT

It is a proxy, not a Fitzpatrick score. It is sensitive to lighting, white
balance, and dermoscopy artefacts, and a suntanned light-skinned person can read
as darker than they are. It is a defensible way to detect a large disparity; it
is not a substitute for labelled data. Bins with few images are reported with
their counts so a reader can see when an estimate is not worth much.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
import tensorflow as tf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_PATH = os.path.join(ROOT, 'dataset', 'data', 'resnet50v2_skin_cancer_model.h5')
TEST_DIR = os.path.join(ROOT, 'dataset', 'dataset', 'data', 'test')
OUT = os.path.join(ROOT, 'dataset', 'data', 'skin_tone_performance.json')

CLASSES = ['benign', 'malignant']  # index 0, 1
IMG_SIZE = (224, 224)
# The service bands the malignant probability; ">0.30" is where a result stops
# being an outright benign, which is the number that matters clinically.
BENIGN_BAND_MAX = 0.30

# Chardon / Del Bino ITA cut points, darkest first.
TONE_BINS = [
    ('dark',         -np.inf, -30.0),
    ('brown',        -30.0,    10.0),
    ('tan',           10.0,    28.0),
    ('intermediate',  28.0,    41.0),
    ('light',         41.0,    55.0),
    ('very_light',    55.0,    np.inf),
]


def srgb_to_lab(rgb):
    """sRGB (0-255) to CIELab under a D65 white point."""
    c = rgb.astype(np.float64) / 255.0
    linear = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

    # sRGB D65 primaries
    m = np.array([
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ])
    xyz = linear @ m.T * 100.0

    white = np.array([95.047, 100.000, 108.883])
    t = xyz / white
    delta = 6.0 / 29.0
    f = np.where(t > delta ** 3, np.cbrt(t), t / (3 * delta ** 2) + 4.0 / 29.0)

    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def estimate_ita(image):
    """ITA of the healthy skin surrounding a centred lesion.

    Returns None when too little usable skin is visible to judge.
    """
    arr = np.array(image.convert('RGB'), dtype=np.uint8)
    h, w = arr.shape[:2]

    # Border ring: the outer 18% on each side. Lesions sit centrally in both
    # dermoscopic and clinical framing, so this is mostly perilesional skin.
    margin_h, margin_w = int(h * 0.18), int(w * 0.18)
    mask = np.zeros((h, w), dtype=bool)
    mask[:margin_h, :] = mask[-margin_h:, :] = True
    mask[:, :margin_w] = mask[:, -margin_w:] = True

    pixels = arr[mask]

    # Drop what is plainly not skin: dermoscope vignetting and hair at the dark
    # end, specular highlights and blown-out white at the bright end.
    value = pixels.max(axis=1)
    keep = (value > 45) & (value < 245)
    pixels = pixels[keep]

    if len(pixels) < 200:
        return None

    lab = srgb_to_lab(pixels)
    L = np.median(lab[:, 0])
    b = np.median(lab[:, 2])

    # Skin is always yellow-positive on b*. A non-positive b* means the sampled
    # ring is not skin — a blue-grey background, ink marking, or gel — and the
    # arctan would flip sign and produce a plausible-looking but meaningless
    # angle. Refuse rather than bin it wrongly.
    if b <= 1.0:
        return None

    # Plain arctan, giving the conventional -90..+90 range. atan2 was used first
    # and produced values beyond ±90 for exactly the non-skin patches above.
    return float(np.degrees(np.arctan((L - 50.0) / b)))


def tone_bin(ita):
    for name, low, high in TONE_BINS:
        if low < ita <= high:
            return name
    return 'unclassified'


def wilson(k, n, z=1.96):
    if n == 0:
        return None, (None, None)
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return p, (max(0.0, centre - half), min(1.0, centre + half))


def self_test():
    """ITA must order known patches correctly, darkest to lightest."""
    samples = [
        ('very light', np.array([[240, 220, 205]], dtype=np.uint8)),
        ('mid', np.array([[198, 160, 130]], dtype=np.uint8)),
        ('deep', np.array([[95, 65, 48]], dtype=np.uint8)),
    ]
    values = []
    for label, patch in samples:
        lab = srgb_to_lab(patch)
        ita = float(np.degrees(np.arctan((lab[0, 0] - 50.0) / lab[0, 2])))
        values.append((label, round(ita, 1)))
    print('  ITA self-test (should decrease):', values, file=sys.stderr)
    assert values[0][1] > values[1][1] > values[2][1], 'ITA ordering is wrong'


def main():
    self_test()

    model = tf.keras.models.load_model(MODEL_PATH)

    records = []
    for label, cls in enumerate(CLASSES):
        directory = os.path.join(TEST_DIR, cls)
        names = sorted(
            f for f in os.listdir(directory)
            if f.lower().endswith(('.jpg', '.jpeg', '.png'))
        )
        print(f'  {cls}: {len(names)} images', file=sys.stderr)

        batch, meta = [], []
        for name in names:
            try:
                original = Image.open(os.path.join(directory, name))
            except Exception:
                continue
            ita = estimate_ita(original)
            batch.append(np.array(original.convert('RGB').resize(IMG_SIZE), dtype=np.float32))
            meta.append((name, label, ita))

        probs = model.predict(np.array(batch), verbose=0, batch_size=16)
        for (name, lab, ita), p in zip(meta, probs):
            records.append({
                'file': name, 'label': lab, 'ita': ita,
                'malignantProb': float(p[1]),
            })

    usable = [r for r in records if r['ita'] is not None]
    print(f'\nITA estimated for {len(usable)}/{len(records)} images', file=sys.stderr)
    itas = np.array([r['ita'] for r in usable])
    print(f'  range {itas.min():.1f}° to {itas.max():.1f}°, median {np.median(itas):.1f}°',
          file=sys.stderr)

    groups = {}
    for record in usable:
        groups.setdefault(tone_bin(record['ita']), []).append(record)

    print(f"\n{'tone':<14}{'n':>5}{'malig':>7}{'sens':>8}{'spec':>8}{'balAcc':>8}"
          f"{'outright benign':>18}", file=sys.stderr)
    print('  ' + '-' * 66, file=sys.stderr)

    report_bins = {}
    for name, _low, _high in TONE_BINS:
        rows = groups.get(name, [])
        if not rows:
            continue

        malignant = [r for r in rows if r['label'] == 1]
        benign = [r for r in rows if r['label'] == 0]

        tp = sum(1 for r in malignant if r['malignantProb'] > 0.5)
        tn = sum(1 for r in benign if r['malignantProb'] <= 0.5)
        # The clinically important failure: a malignant lesion told it is benign.
        missed = sum(1 for r in malignant if r['malignantProb'] <= BENIGN_BAND_MAX)

        sens, sens_ci = wilson(tp, len(malignant))
        spec, spec_ci = wilson(tn, len(benign))
        bal = (sens + spec) / 2 if sens is not None and spec is not None else None

        report_bins[name] = {
            'n': len(rows),
            'nMalignant': len(malignant),
            'nBenign': len(benign),
            'sensitivity': round(sens, 4) if sens is not None else None,
            'sensitivityCI': [round(c, 4) for c in sens_ci] if sens_ci[0] is not None else None,
            'specificity': round(spec, 4) if spec is not None else None,
            'specificityCI': [round(c, 4) for c in spec_ci] if spec_ci[0] is not None else None,
            'balancedAccuracy': round(bal, 4) if bal is not None else None,
            'outrightBenignOnMalignant': missed,
            'outrightBenignRate': round(missed / len(malignant), 4) if malignant else None,
            'reliable': len(malignant) >= 30 and len(benign) >= 30,
        }

        print(f"{name:<14}{len(rows):>5}{len(malignant):>7}"
              f"{(f'{sens:.3f}' if sens is not None else '   -'):>8}"
              f"{(f'{spec:.3f}' if spec is not None else '   -'):>8}"
              f"{(f'{bal:.3f}' if bal is not None else '   -'):>8}"
              f"{(f'{missed}/{len(malignant)}' if malignant else '-'):>18}", file=sys.stderr)

    reliable = [n for n, v in report_bins.items() if v['reliable']]
    sens_values = {n: v['sensitivity'] for n, v in report_bins.items()
                   if v['reliable'] and v['sensitivity'] is not None}
    spread = (max(sens_values.values()) - min(sens_values.values())) if len(sens_values) > 1 else None

    report = {
        'model': os.path.basename(MODEL_PATH),
        'method': 'Individual Typology Angle from perilesional skin (border ring, '
                  'non-skin pixels excluded), binned on Chardon/Del Bino cut points',
        'operatingPoint': 'argmax for sensitivity/specificity; outright-benign uses '
                          f'the service band (malignant probability <= {BENIGN_BAND_MAX})',
        'imagesTotal': len(records),
        'imagesWithItaEstimate': len(usable),
        'itaRange': [round(float(itas.min()), 1), round(float(itas.max()), 1)],
        'itaMedian': round(float(np.median(itas)), 1),
        'bins': report_bins,
        'binsConsideredReliable': reliable,
        'sensitivitySpreadAcrossReliableBins': round(spread, 4) if spread is not None else None,
        'limitations': [
            'ITA is a proxy for skin tone, not a Fitzpatrick score. It is affected by '
            'lighting, white balance and dermoscopy artefacts, and tanning shifts it.',
            'A bin is marked reliable only with at least 30 malignant and 30 benign '
            'images; below that the interval is too wide to act on.',
            'Absence of a disparity in these numbers is not evidence of fairness if '
            'the darker bins are small or empty — it means the dataset cannot answer '
            'the question.',
        ],
    }

    with open(OUT, 'w') as f:
        json.dump(report, f, indent=2)
        f.write('\n')
    print(f'\nWrote {OUT}', file=sys.stderr)


if __name__ == '__main__':
    main()
