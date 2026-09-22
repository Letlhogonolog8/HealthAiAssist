#!/usr/bin/env python3
"""Finds a labelled LIDC-IDRI nodule and the DICOM slice it sits on.

    python scripts/lidc_find_nodule_slice.py            # first held-out malignant nodule
    python scripts/lidc_find_nodule_slice.py --split test --label no_cancer
    python scripts/lidc_find_nodule_slice.py --nodule LIDC-IDRI-0334_4dd414_4

Prints one JSON object: the .dcm path, the nodule's centre in pixels of the
rendered frame (the coordinates the characteriser takes as cx, cy), its
identity, split, label and median rating, and the PatientName / PatientID the
original object carries — so a test can assert those values are absent from
whatever the platform stored.

Used by tests/lung-nodule.test.ts and by the demo script to pick an object to
upload. Reads the label table and the patch manifest the training pipeline
wrote; it does not decide anything itself.
"""
import argparse
import csv
import glob
import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABELS = os.path.join(ROOT, 'dataset', 'lidc-labels.csv')
MANIFEST = os.path.join(ROOT, 'dataset', 'lidc-ct', 'patches.csv')
DICOM_ROOT = os.path.join(ROOT, 'dataset', 'manifest-1600709154662', 'LIDC-IDRI')


def nodule_id(row):
    series = hashlib.sha256(row['series_uid'].encode()).hexdigest()[:6]
    return f"{row['patient']}_{series}_{row['nodule_index']}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--split', default='test')
    parser.add_argument('--label', default='cancer', choices=['cancer', 'no_cancer'])
    parser.add_argument('--nodule', default=None, help='a specific nodule_id')
    args = parser.parse_args()

    for required in (LABELS, MANIFEST, DICOM_ROOT):
        if not os.path.exists(required):
            print(json.dumps({'error': f'missing {required}'}))
            sys.exit(2)

    import pydicom

    manifest = list(csv.DictReader(open(MANIFEST, encoding='utf-8')))
    wanted = {m['nodule_id'] for m in manifest if m['split'] == args.split and m['label'] == args.label}
    if args.nodule:
        wanted = {args.nodule}

    rows = [r for r in csv.DictReader(open(LABELS, encoding='utf-8')) if r['sop_uid']]
    for row in rows:
        nid = nodule_id(row)
        if nid not in wanted:
            continue
        patient_dir = os.path.join(DICOM_ROOT, row['patient'])
        for path in glob.glob(os.path.join(patient_dir, '**', '*.dcm'), recursive=True):
            try:
                ds = pydicom.dcmread(path, stop_before_pixels=True, force=True)
            except Exception:
                continue
            if ds.get('SOPInstanceUID') != row['sop_uid']:
                continue
            print(json.dumps({
                'path': os.path.relpath(path, ROOT).replace(os.sep, '/'),
                'cx': float(row['cx']),
                'cy': float(row['cy']),
                'noduleId': nid,
                'split': args.split,
                'label': args.label,
                'medianMalignancy': row['median_malignancy'],
                'patientName': str(ds.get('PatientName', '')),
                'patientId': str(ds.get('PatientID', '')),
                'seriesInstanceUid': str(ds.get('SeriesInstanceUID', '')),
            }))
            return
    print(json.dumps({'error': 'no matching nodule with a downloaded centre slice'}))
    sys.exit(3)


if __name__ == '__main__':
    main()
