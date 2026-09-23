#!/usr/bin/env python3
"""
Which series in the split actually have pixel data on this machine.

    python scripts/lidc_series_availability.py
    python scripts/lidc_series_availability.py --check   # report, write nothing

── Why this is separate from the split ────────────────────────────────────

scripts/lidc_build_splits.py assigns every patient in the label table, all 740
of them, because the split has to be a property of the collection and not of
whatever happens to be downloaded today. Otherwise the assignment would move
every time somebody fetched another series, and two training runs would stop
being comparable.

But the label table names 748 series and this working copy holds far fewer.
Training and evaluation can only use what is here, so the usable size of each
split is a different number from its assigned size — and it is the smaller one
that determines how wide a confidence interval will be. Recording only the
assigned counts would overstate the evidence available by a factor of three.

── What it measures ───────────────────────────────────────────────────────

Every directory under the dataset manifest that contains DICOM, read one file
deep for its SeriesInstanceUID and Modality. A series counts as available when
the label table names it and its pixel data is on disk. Nothing is inferred
from directory names, which are not UIDs.

This is an inventory. It says nothing about image quality, geometry validity
or whether a series would survive the quality gate — inference/quality_gate.py
and inference/series.py decide that, per series, at the time it is used.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABELS = os.path.join(ROOT, "dataset", "lidc-labels.csv")
COLLECTION = os.path.join(ROOT, "dataset", "manifest-1600709154662")
SPLITS = os.path.join(ROOT, "docs", "splits", "lidc-split-v1.json")
OUT = os.path.join(ROOT, "docs", "splits", "lidc-availability.json")

SPLIT_ORDER = ("train", "validation", "calibration", "test")


def scan_collection(root: str) -> dict:
    """Read one header per directory. Directory names are not UIDs."""
    import pydicom  # imported here so --help works without it

    found = {}
    for dirpath, _dirnames, filenames in os.walk(root):
        objects = sorted(f for f in filenames if f.lower().endswith(".dcm"))
        if not objects:
            continue
        dataset = pydicom.dcmread(
            os.path.join(dirpath, objects[0]), stop_before_pixels=True, force=True
        )
        uid = getattr(dataset, "SeriesInstanceUID", None)
        if not uid:
            continue
        found[str(uid)] = {
            "objects": len(objects),
            "modality": str(getattr(dataset, "Modality", "") or ""),
        }
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true",
                        help="report and write nothing")
    parser.add_argument("--collection", default=COLLECTION)
    parser.add_argument("--out", default=OUT)
    args = parser.parse_args()

    if not os.path.isdir(args.collection):
        print("collection not found: %s" % args.collection, file=sys.stderr)
        return 2
    if not os.path.exists(SPLITS):
        print("split manifest not found: %s — run scripts/lidc_build_splits.py first"
              % SPLITS, file=sys.stderr)
        return 2

    with open(LABELS, newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    with open(SPLITS, encoding="utf-8") as handle:
        assignment = json.load(handle)["assignment"]

    on_disk = scan_collection(args.collection)
    series_patient = {}
    for row in rows:
        series_patient.setdefault(row["series_uid"], row["patient"])

    available = sorted(set(series_patient) & set(on_disk))
    non_ct = sorted(uid for uid in available if on_disk[uid]["modality"] != "CT")
    unlabelled = sorted(set(on_disk) - set(series_patient))

    per_split = {}
    for name in SPLIT_ORDER:
        per_split[name] = {
            "seriesAssigned": 0, "seriesAvailable": 0,
            "nodulesAssigned": 0, "nodulesAvailable": 0,
            "patientsAvailable": 0,
        }
    patients_seen = dict((name, set()) for name in SPLIT_ORDER)

    for uid, patient in series_patient.items():
        split = assignment.get(patient)
        if split not in per_split:
            continue
        per_split[split]["seriesAssigned"] += 1
        if uid in on_disk:
            per_split[split]["seriesAvailable"] += 1
            patients_seen[split].add(patient)
    for row in rows:
        split = assignment.get(row["patient"])
        if split not in per_split:
            continue
        per_split[split]["nodulesAssigned"] += 1
        if row["series_uid"] in on_disk:
            per_split[split]["nodulesAvailable"] += 1
    for name in SPLIT_ORDER:
        per_split[name]["patientsAvailable"] = len(patients_seen[name])

    report = {
        "version": "lidc-availability-v1",
        "splitManifest": os.path.relpath(SPLITS, ROOT).replace(os.sep, "/"),
        "splitFingerprint": json.load(open(SPLITS, encoding="utf-8"))["fingerprint"],
        "collection": os.path.relpath(args.collection, ROOT).replace(os.sep, "/"),
        "seriesNamedInLabelTable": len(series_patient),
        "seriesWithPixelDataOnDisk": len(on_disk),
        "seriesAvailable": len(available),
        "objectsOnDisk": sum(v["objects"] for v in on_disk.values()),
        "nonCtSeriesAvailable": non_ct,
        "seriesOnDiskNotInLabelTable": unlabelled,
        "perSplit": per_split,
        "availableSeries": available,
        "whatThisIsNot": (
            "An inventory of pixel data, not a statement that any series is usable. "
            "Geometry validity and the quality gate are decided per series at the time "
            "it is used, by inference/series.py and inference/quality_gate.py."
        ),
        "consequence": (
            "Evaluation interval width is set by the AVAILABLE counts, not the assigned "
            "ones. Quoting a split size that includes series with no pixel data on this "
            "machine would overstate the evidence."
        ),
    }

    print("series named in the label table:  %d" % report["seriesNamedInLabelTable"],
          file=sys.stderr)
    print("series with pixel data on disk:   %d (%d objects)"
          % (report["seriesWithPixelDataOnDisk"], report["objectsOnDisk"]), file=sys.stderr)
    print("of those, named in the labels:    %d" % report["seriesAvailable"], file=sys.stderr)
    if unlabelled:
        print("on disk but unlabelled:           %d" % len(unlabelled), file=sys.stderr)
    if non_ct:
        print("available but not CT:             %d" % len(non_ct), file=sys.stderr)
    print(file=sys.stderr)
    for name in SPLIT_ORDER:
        s = per_split[name]
        print("  %-12s series %3d assigned, %3d available   nodules %4d assigned, %4d available"
              % (name, s["seriesAssigned"], s["seriesAvailable"],
                 s["nodulesAssigned"], s["nodulesAvailable"]), file=sys.stderr)

    if args.check:
        return 0
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
    print("\n  written -> %s" % args.out, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
