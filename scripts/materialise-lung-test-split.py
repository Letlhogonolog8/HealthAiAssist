#!/usr/bin/env python3
"""Rebuilds the lung held-out test split from the recorded manifest.

    python scripts/materialise-lung-test-split.py

WHY THIS EXISTS

MODEL_REGISTRY publishes the lung figures against a "held-out test split, 554
images (282 cancer / 272 no_cancer)", and /api/models/cards publishes a
reproduce command alongside them. That command did not work: no test/ directory
existed. The images were never lost — they live in the original train/ and
validate/ directories, and dataset/lung_cancer_MRI_dataset/lung_splits.json
records exactly which 554 of them were held out — but nothing assembled them
into a form the evaluator could read.

So the figures were unverifiable in this working copy, and the measurement
binding in server/model-governance.ts was recorded as
`asserted_at_introduction` rather than `re_measured`. This closes that.

WHAT IT DOES NOT ESTABLISH

The manifest asserts that the test entries "were used only for final
evaluation". Nothing on disk proves that: the train and val lists are not
recorded, so the exclusion cannot be checked by intersection. What can be
checked, and is, is that the manifest's counts match the published ones exactly
and that every file it names exists.

Copies rather than links, so that the resulting directory is a plain readable
tree on any filesystem and nothing about it depends on this script having run
recently.
"""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPLITS = os.path.join(ROOT, 'dataset', 'lung_cancer_MRI_dataset', 'lung_splits.json')
OUT_DIR = os.path.join(ROOT, 'dataset', 'lung_cancer_MRI_dataset', 'test')

BACKSLASH = chr(92)


def main():
    with open(SPLITS) as f:
        splits = json.load(f)

    classes = splits['classes']
    entries = splits['test']
    expected = splits['counts']['test']

    if len(entries) != expected:
        raise SystemExit(
            f'Manifest disagrees with itself: counts.test={expected}, '
            f'test list holds {len(entries)}'
        )

    for cls in classes:
        os.makedirs(os.path.join(OUT_DIR, cls), exist_ok=True)

    written = {c: 0 for c in classes}
    missing = []

    for recorded in entries:
        rel = recorded.replace(BACKSLASH, os.sep).replace('/', os.sep)
        source = os.path.join(ROOT, rel) if not os.path.isabs(rel) else rel

        if not os.path.exists(source):
            missing.append(rel)
            continue

        # The class is the directory the file sits in, which is how the
        # manifest encodes the label.
        parts = rel.split(os.sep)
        cls = next((c for c in classes if c in parts), None)
        if cls is None:
            missing.append(rel)
            continue

        # Names collide across train/ and validate/, so the source split is
        # folded into the destination name. Without this the copy silently
        # drops files and the counts come out short.
        origin = 'train' if 'train' in parts else 'validate'
        dest = os.path.join(OUT_DIR, cls, f'{origin}__{os.path.basename(rel)}')

        shutil.copyfile(source, dest)
        written[cls] += 1

    if missing:
        raise SystemExit(
            f'{len(missing)} manifest entries could not be resolved; '
            f'first: {missing[:3]}'
        )

    total = sum(written.values())
    print(f'Wrote {total} images to {OUT_DIR}', file=sys.stderr)
    for cls in classes:
        print(f'  {cls}: {written[cls]}', file=sys.stderr)

    if total != expected:
        raise SystemExit(f'Expected {expected} images, wrote {total}')

    print('\nEvaluate with:', file=sys.stderr)
    print(
        '  python scripts/evaluate-model.py '
        'dataset/lung_cancer_MRI_dataset/resnet50v2_lung_cancer_model.h5 '
        f'dataset/lung_cancer_MRI_dataset/test {classes[0]} {classes[1]} raw_0_255',
        file=sys.stderr,
    )
    print(
        '\nNote: index 0 is cancer for this model, so the evaluator reports\n'
        '"sensitivity" as recall on no_cancer and "specificity" as recall on\n'
        'cancer — the reverse of the clinical convention. Read the confusion\n'
        'matrix, not the labels.',
        file=sys.stderr,
    )


if __name__ == '__main__':
    main()
