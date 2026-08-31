#!/usr/bin/env python3
"""Trains the lung *nodule characteriser* on LIDC-IDRI patches.

    python scripts/lidc_extract_patches.py <dicom_root> \
        dataset/lidc-labels.csv dataset/lidc-ct --slices-per-nodule 5
    python scripts/train-lung-nodule-model.py

── What this model answers, and what it does not ──────────────────────────

Input: a 64 px crop of a chest CT centred on a nodule somebody has already
pointed at, windowed by `inference/dicom_ingest.py`.
Output: the probability that a radiologist would rate that nodule malignant.

That is a **different question** from the one the deployed chest model answers,
and it is deliberately the smaller one. It is route (1) of the two written down
in `scripts/lidc_extract_patches.py`: a clinician marks the nodule and asks for
a characterisation. There is no nodule detector here and this model must never
be given a whole slice — it would meet a distribution it never trained on, which
is the exact defect that made the previous lung model refuse every real DICOM.

Three limits that belong in the model card, not in a footnote:

  * A LIDC malignancy rating is a **radiologist's impression**, not a
    histological diagnosis. LIDC's diagnosis file covers only a small subset of
    the collection. This model predicts what a radiologist would say, and the
    ceiling on that is inter-reader agreement, not truth.
  * The held-out set holds roughly 30 malignant *nodules*. Every figure this
    prints carries an interval about that wide, and the intervals are printed
    next to the point estimates for that reason.
  * LIDC records almost no demographics — sex for 29% of patients, age 20%,
    ethnic group 4%. There is **no equivalent of the skin model's skin-tone
    analysis**, and for a South African entry that is a real gap rather than an
    oversight. It cannot be closed with this dataset.

── Why the evaluation is per nodule ───────────────────────────────────────

Five patches from one nodule are five neighbouring slices of the same lesion in
the same chest on the same scanner. Scoring them as five independent test cases
inflates the apparent sample size fivefold and tightens every confidence
interval by more than a factor of two, for free, incorrectly. Patch-level
figures are printed as well, and labelled as the optimistic ones they are.

Mirrors scripts/train-lung-cancer-model.py: frozen ResNet50V2 trunk, trained
head, preprocessing fused into the saved graph so inference cannot disagree with
training about normalisation.

Writes a NEW artifact. Nothing is promoted; the deployed lung model is untouched
until somebody reads these numbers and decides.
"""
import collections
import csv
import json
import math
import os

import numpy as np
from PIL import Image
import tensorflow as tf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATCH_ROOT = os.path.join(ROOT, 'dataset', 'lidc-ct')
MANIFEST = os.path.join(PATCH_ROOT, 'patches.csv')
OUT_DIR = os.path.join(ROOT, 'dataset', 'lung_nodule_model')
OUT_MODEL = os.path.join(OUT_DIR, 'resnet50v2_lung_nodule_model.h5')
OUT_META = os.path.join(OUT_DIR, 'lung_nodule_training.json')
CACHE = os.path.join(OUT_DIR, '.feature_cache')

IMG_SIZE = (224, 224)
# Index order matches the chest model so the serving code needs no special case:
# 0 = cancer (malignant), 1 = no_cancer (benign).
CLASSES = ['cancer', 'no_cancer']
SEED = 4242
EXTRACT_BATCH = 32
AUG_ROUNDS = 2


def wilson(successes, total, z=1.96):
    """Wilson score interval — the one that stays sane at small n.

    The normal approximation is what most papers print and it is wrong here:
    with ~30 malignant nodules and a proportion near 0.9 it produces intervals
    that run past 1.0. Wilson does not.
    """
    if total == 0:
        return (0.0, 0.0, 1.0)
    p = successes / total
    d = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / d
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d
    return (round(p, 4), round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4))


def read_manifest():
    if not os.path.exists(MANIFEST):
        raise SystemExit(
            f'No manifest at {MANIFEST}.\n'
            'Run scripts/lidc_extract_patches.py first — it writes patches.csv '
            'alongside the images, and this script reads the split and the nodule\n'
            'identity from it rather than re-deriving them from filenames.')

    rows = list(csv.DictReader(open(MANIFEST, encoding='utf-8')))
    for row in rows:
        row['abs_path'] = os.path.join(PATCH_ROOT, row['path'].replace('/', os.sep))
        row['y'] = CLASSES.index(row['label'])
    return rows


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
    """Flips in both axes and small shifts.

    Unlike a whole chest image, a crop centred on a nodule has no canonical
    orientation — left and right lung look alike at this scale and the crop
    carries no laterality. So vertical flip is legitimate here where it is not
    in scripts/train-lung-cancer-model.py.

    Shifts stay small: the label says "this nodule", and a shift large enough to
    move the lesion off-centre would teach the model to read the surrounding
    parenchyma instead.
    """
    if np.random.rand() < 0.5:
        arr = arr[:, ::-1, :]
    if np.random.rand() < 0.5:
        arr = arr[::-1, :, :]
    shift = np.random.randint(-8, 9, size=2)
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


def by_nodule(rows, prob_cancer):
    """Mean malignancy probability per nodule, with its label.

    Mean rather than max: max over five slices is a "flag if any slice looks
    suspicious" rule, which raises sensitivity by construction and would be a
    choice about the operating point smuggled into the aggregation step. The
    operating point belongs in the threshold sweep below, where it is visible.
    """
    grouped = collections.defaultdict(list)
    labels = {}
    for row, p in zip(rows, prob_cancer):
        grouped[row['nodule_id']].append(p)
        labels[row['nodule_id']] = row['y']
    ids = sorted(grouped)
    return (ids,
            np.array([float(np.mean(grouped[i])) for i in ids]),
            np.array([labels[i] for i in ids]))


def score(y_true, prob_cancer, threshold):
    """Sensitivity and specificity with intervals. Positive class is cancer (0)."""
    flagged = prob_cancer >= threshold
    is_cancer = y_true == 0
    tp = int((is_cancer & flagged).sum())
    fn = int((is_cancer & ~flagged).sum())
    tn = int((~is_cancer & ~flagged).sum())
    fp = int((~is_cancer & flagged).sum())

    sens, sens_lo, sens_hi = wilson(tp, tp + fn)
    spec, spec_lo, spec_hi = wilson(tn, tn + fp)
    return {
        'threshold': round(float(threshold), 3),
        'sensitivity': sens, 'sensitivityCI95': [sens_lo, sens_hi],
        'specificity': spec, 'specificityCI95': [spec_lo, spec_hi],
        'balancedAccuracy': round((sens + spec) / 2, 4),
        'confusion': {'TP': tp, 'FN': fn, 'TN': tn, 'FP': fp},
        'n': int(len(y_true)),
    }


def show(title, m):
    print(f'  {title:<26} sens {m["sensitivity"]:.3f} '
          f'[{m["sensitivityCI95"][0]:.3f}-{m["sensitivityCI95"][1]:.3f}]   '
          f'spec {m["specificity"]:.3f} '
          f'[{m["specificityCI95"][0]:.3f}-{m["specificityCI95"][1]:.3f}]   '
          f'bal {m["balancedAccuracy"]:.3f}   (n={m["n"]})', flush=True)


def main():
    np.random.seed(SEED)
    tf.keras.utils.set_random_seed(SEED)
    os.makedirs(OUT_DIR, exist_ok=True)

    rows = read_manifest()
    split_rows = {s: [r for r in rows if r['split'] == s] for s in ('train', 'val', 'test')}

    print('patches and nodules per split (the split was decided by patient, '
          'before extraction):', flush=True)
    for split, group in split_rows.items():
        nodules = {r['nodule_id'] for r in group}
        mal = {r['nodule_id'] for r in group if r['label'] == 'cancer'}
        patients = {r['patient'] for r in group}
        print(f'  {split:<6} {len(group):>6} patches   {len(nodules):>4} nodules '
              f'({len(mal)} malignant)   {len(patients)} patients', flush=True)
        if not group:
            raise SystemExit(f'Split "{split}" is empty — nothing to train or evaluate on.')

    overlap = ({r['patient'] for r in split_rows['train']}
               & {r['patient'] for r in split_rows['test']})
    if overlap:
        raise SystemExit(f'{len(overlap)} patients appear in both train and test. '
                         'The split is broken and every figure below would be meaningless.')

    feature_model, trunk = build_backbone()

    print('\nExtracting features...', flush=True)
    x_train = extract(feature_model, [r['abs_path'] for r in split_rows['train']],
                      'train', AUG_ROUNDS)
    y_train = np.tile(np.array([r['y'] for r in split_rows['train']]), AUG_ROUNDS + 1)
    x_val = extract(feature_model, [r['abs_path'] for r in split_rows['val']], 'val')
    y_val = np.array([r['y'] for r in split_rows['val']])
    x_test = extract(feature_model, [r['abs_path'] for r in split_rows['test']], 'test')
    y_test = np.array([r['y'] for r in split_rows['test']])

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
    print(f'\nclass_weight={class_weight}', flush=True)

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

    p_val = head.predict(x_val, verbose=0)[:, 0]
    p_test = head.predict(x_test, verbose=0)[:, 0]

    _, val_nod_p, val_nod_y = by_nodule(split_rows['val'], p_val)
    _, test_nod_p, test_nod_y = by_nodule(split_rows['test'], p_test)

    # The operating point is chosen on validation. The test split is scored once,
    # at whatever that sweep picked, and never revisited — otherwise it stops
    # being held out and the intervals below become decoration.
    print('\nThreshold sweep — VALIDATION nodules only:', flush=True)
    sweep = []
    for t in np.arange(0.10, 0.91, 0.05):
        m = score(val_nod_y, val_nod_p, t)
        sweep.append(m)
        show(f'threshold {t:.2f}', m)

    argmax_point = score(val_nod_y, val_nod_p, 0.5)

    # Screening bias: among thresholds reaching 0.85 sensitivity, take the most
    # specific. A missed malignancy costs more than a follow-up CT, and this is
    # a triage aid with a clinician downstream in every path.
    #
    # Ties are broken by taking the MIDDLE of the tied band, not the first entry.
    # With ~30 validation nodules a wide band of thresholds routinely scores
    # identically, and picking the first is picking the most aggressive edge of
    # that band for no reason - one nodule's probability drifting by 0.01 in
    # production would then change the operating point. The midpoint is the
    # choice with margin on both sides.
    eligible = [m for m in sweep if m['sensitivity'] >= 0.85]
    pool = eligible or sweep
    key = ((lambda m: (m['specificity'], m['sensitivity'])) if eligible
           else (lambda m: (m['balancedAccuracy'], m['sensitivity'])))
    best = max(key(m) for m in pool)
    tied = sorted(m['threshold'] for m in pool if key(m) == best)
    threshold = tied[len(tied) // 2]
    chosen = next(m for m in pool if m['threshold'] == threshold)
    if len(tied) > 1:
        print(f'\n  {len(tied)} thresholds tied ({tied[0]:.2f}-{tied[-1]:.2f}); took the '
              f'midpoint {threshold:.2f} rather than an edge of the band.', flush=True)
    if not eligible:
        print('\n  No threshold reached 0.85 sensitivity on validation. Fell back to '
              'best balanced accuracy — say so in the model card rather than '
              'presenting the operating point as a screening choice.', flush=True)

    print(f'\nOperating point chosen on validation: {threshold:.2f}', flush=True)

    print('\nHELD-OUT TEST — per nodule (this is the figure to publish):', flush=True)
    test_nodule = score(test_nod_y, test_nod_p, threshold)
    show(f'threshold {threshold:.2f}', test_nodule)
    test_nodule_argmax = score(test_nod_y, test_nod_p, 0.5)
    show('argmax (0.50)', test_nodule_argmax)

    print('\nHELD-OUT TEST — per patch (OPTIMISTIC, do not publish alone):', flush=True)
    test_patch = score(y_test, p_test, threshold)
    show(f'threshold {threshold:.2f}', test_patch)
    print('  Five patches per nodule are the same lesion. The interval above is '
          'roughly half as wide as the evidence supports.', flush=True)

    inputs = tf.keras.Input(shape=(*IMG_SIZE, 3), name='raw_rgb_0_255')
    x = tf.keras.layers.Rescaling(1.0 / 127.5, offset=-1.0, name='resnet_v2_preprocess')(inputs)
    full = tf.keras.Model(inputs, head(trunk(x, training=False)),
                          name='resnet50v2_lung_nodule')
    full.save(OUT_MODEL)
    print(f'\nSaved {OUT_MODEL}', flush=True)

    with open(OUT_META, 'w') as f:
        json.dump({
            'answers': 'Probability that a radiologist would rate THIS marked nodule '
                       'malignant, given a 64px crop of a chest CT centred on it.',
            'doesNotAnswer': 'Whether a chest CT contains cancer. There is no nodule '
                             'detector. A whole slice is out of distribution for this '
                             'model and must be refused, not classified.',
            'route': 'Route 1 — clinician marks the nodule and requests a '
                     'characterisation. See scripts/lidc_extract_patches.py.',
            'dataset': 'LIDC-IDRI (TCIA), CC BY 3.0. Labels are the median malignancy '
                       'rating across up to four radiologists; median exactly 3 excluded. '
                       'A rating is an impression, not a histological diagnosis.',
            'citation': 'Armato III, S. G., McLennan, G., Bidaut, L., et al. Data From '
                        'LIDC-IDRI. The Cancer Imaging Archive. '
                        'https://doi.org/10.7937/K9/TCIA.2015.LO9QL9SX',
            'classes': CLASSES,
            'classIndexOrder': {c: i for i, c in enumerate(CLASSES)},
            'inputRange': 'raw RGB 0-255 (preprocessing fused into the model)',
            'imageSize': list(IMG_SIZE),
            'windowing': 'inference/dicom_ingest.py _window — the same code the serving '
                         'path uses. Training and serving cannot drift.',
            'backbone': 'ResNet50V2 ImageNet, frozen',
            'seed': SEED,
            'split': 'By patient, before any patch was written. No patient appears in '
                     'two splits.',
            'splitCounts': {
                s: {
                    'patches': len(g),
                    'nodules': len({r['nodule_id'] for r in g}),
                    'malignantNodules': len({r['nodule_id'] for r in g
                                             if r['label'] == 'cancer'}),
                    'patients': len({r['patient'] for r in g}),
                } for s, g in split_rows.items()
            },
            'operatingPoint': {
                'threshold': threshold,
                'chosenOn': 'validation nodules',
                'rule': 'most specific threshold reaching 0.85 sensitivity; '
                        'ties broken by the midpoint of the tied band',
                'tiedBand': tied,
                'reachedTarget': bool(eligible),
            },
            'validationSweep': sweep,
            'validationArgmax': argmax_point,
            'test': {
                'perNodule': test_nodule,
                'perNoduleArgmax': test_nodule_argmax,
                'perPatch': test_patch,
                'note': 'Publish perNodule. perPatch counts five slices of one lesion as '
                        'five cases and its interval is too tight by construction.',
            },
            'knownGaps': [
                'No demographic breakdown is possible: LIDC records sex for 29% of '
                'patients, age for 20%, ethnic group for 4%. There is no equivalent of '
                'the skin model\'s skin-tone analysis and this dataset cannot provide one.',
                'The ceiling is inter-reader agreement, not histology.',
                'Not calibrated yet — run scripts/calibrate-model.py before any '
                'probability is shown to a user as a percentage.',
                'No OOD reference built yet — run scripts/build-ood-reference.py so a '
                'whole slice, or a non-CT crop, is refused rather than scored.',
                'Nothing is promoted. The deployed lung model is unchanged.',
            ],
        }, f, indent=2)
    print(f'Saved {OUT_META}', flush=True)

    print('\nBefore this artifact goes anywhere near the serving path:', flush=True)
    print('  1. scripts/calibrate-model.py  — the head is uncalibrated', flush=True)
    print('  2. scripts/build-ood-reference.py — so whole slices are refused', flush=True)
    print('  3. Read the per-nodule interval. If it spans more than ~0.25, the honest '
          'claim is "promising on a small held-out set", not a headline figure.',
          flush=True)


if __name__ == '__main__':
    main()
