#!/usr/bin/env python3
"""Finds one LIDC-IDRI CT series and prints what a test needs to use it.

    python scripts/lidc_find_series.py                  # the first usable series
    python scripts/lidc_find_series.py --max-files 60   # cap the file list

Prints one JSON object: the directory, the ordered file list, the instance
count, and the ORIGINAL StudyInstanceUID / SeriesInstanceUID / SOPInstanceUID
and PatientID of the first object.

Those original identifiers are printed on purpose and for one purpose: a test
asserts they are absent from every API response and from every stored byte.
This script reads the gitignored dataset directly and is never part of the
serving path.

Companion to scripts/lidc_find_nodule_slice.py, which finds a single slice.
"""
import argparse
import collections
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DICOM_ROOT = os.path.join(ROOT, "dataset", "manifest-1600709154662", "LIDC-IDRI")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--patient", default=None)
    parser.add_argument("--max-files", type=int, default=0, help="0 means every file")
    parser.add_argument("--min-files", type=int, default=40)
    args = parser.parse_args()

    if not os.path.isdir(DICOM_ROOT):
        print(json.dumps({"error": f"missing {DICOM_ROOT}"}))
        sys.exit(2)

    import pydicom

    patients = (
        [args.patient]
        if args.patient
        else sorted(p for p in os.listdir(DICOM_ROOT) if p.startswith("LIDC-IDRI-"))
    )

    for patient in patients:
        by_series = collections.defaultdict(list)
        for path in glob.glob(os.path.join(DICOM_ROOT, patient, "**", "*.dcm"), recursive=True):
            try:
                ds = pydicom.dcmread(path, stop_before_pixels=True, force=True)
            except Exception:
                continue
            if str(getattr(ds, "Modality", "")) != "CT":
                continue
            try:
                z = float(ds.ImagePositionPatient[2])
            except Exception:
                continue
            by_series[str(ds.SeriesInstanceUID)].append((z, path, ds))

        for series_uid, members in by_series.items():
            if len(members) < args.min_files:
                continue
            members.sort(key=lambda item: item[0])
            if args.max_files:
                # Keep a contiguous run, so the spacing stays uniform and the
                # series still passes the gate.
                members = members[: args.max_files]
            first = members[0][2]
            print(json.dumps({
                "patient": patient,
                "directory": os.path.relpath(os.path.dirname(members[0][1]), ROOT).replace(os.sep, "/"),
                "files": [os.path.relpath(p, ROOT).replace(os.sep, "/") for _z, p, _d in members],
                "instanceCount": len(members),
                "originalSeriesInstanceUid": series_uid,
                "originalStudyInstanceUid": str(first.StudyInstanceUID),
                "originalSopInstanceUid": str(first.SOPInstanceUID),
                "originalPatientId": str(getattr(first, "PatientID", "")),
                "rows": int(first.Rows),
                "columns": int(first.Columns),
                "sliceThicknessMm": float(getattr(first, "SliceThickness", 0) or 0),
            }))
            return

    print(json.dumps({"error": "no CT series with enough downloaded instances"}))
    sys.exit(3)


if __name__ == "__main__":
    main()
