#!/usr/bin/env python3
"""
Every location a radiologist marked, so negative samples can stay away from it.

    python scripts/lidc_build_annotation_exclusions.py "TCIA Folder" dataset/lidc-annotation-exclusions.csv

── Why the label table is not enough ──────────────────────────────────────

`dataset/lidc-labels.csv` is a *malignancy* label table. To serve that
purpose it leaves out three kinds of annotation on purpose:

  - nodules >= 3 mm whose median malignancy rating is exactly 3 — excluded as
    indeterminate by scripts/lidc_build_labels.py (267 of them among the
    measured nodules alone);
  - nodules < 3 mm, which LIDC readers mark but do not rate;
  - non-nodules >= 3 mm, which readers mark as "not a nodule".

A candidate detector answers a different question — would a radiologist have
marked something here — and for that question all three are places where a
reader looked and drew something. Sampling a "no nodule" training example on
top of an indeterminate nodule would teach the detector that a real nodule is
background. So negatives are kept away from every marked location, not only
from the labelled ones.

── What this does NOT change ──────────────────────────────────────────────

It does not add positives. Whether indeterminate or sub-3 mm nodules should be
detection *targets* is a dataset decision, and making it here would silently
change the dataset definition the split was built on. They become an ignore
zone: neither positive nor negative. docs/P2_TRAINING_READINESS.md records the
open question.

It does not cluster readings. Every ROI on every slice each reader drew is a
separate point, which over-covers a nodule rather than risk under-covering it.

── Output ─────────────────────────────────────────────────────────────────

One row per marked point: source series UID, SOP instance UID, the slice's
z position, the pixel (x, y) and the kind of mark. Source identifiers from a
public research collection, gitignored with the rest of dataset/, and never
the platform's salted UIDs.
"""
from __future__ import annotations

import argparse
import collections
import csv
import glob
import os
import sys
import xml.etree.ElementTree as ET

KIND_RATED = "nodule_rated"
KIND_SMALL = "nodule_small"
KIND_NON_NODULE = "non_nodule"

FIELDNAMES = ["series_uid", "sop_uid", "z", "x", "y", "kind"]


def _local(tag: str) -> str:
    """The tag without its namespace. LIDC files use more than one namespace."""
    return tag.rsplit("}", 1)[-1]


def _child(node, name):
    for child in node:
        if _local(child.tag) == name:
            return child
    return None


def _children(node, name):
    return [child for child in node if _local(child.tag) == name]


def _text(node, name) -> str:
    found = _child(node, name)
    return (found.text or "").strip() if found is not None and found.text else ""


def _number(value: str):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse(path: str):
    """(series_uid, [points]) for one XML file. Unparseable files yield nothing."""
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        return "", []

    header = _child(root, "ResponseHeader")
    series_uid = _text(header, "SeriesInstanceUid") if header is not None else ""
    points = []

    for session in _children(root, "readingSession"):
        for nodule in _children(session, "unblindedReadNodule"):
            rated = _child(nodule, "characteristics") is not None
            kind = KIND_RATED if rated else KIND_SMALL
            for roi in _children(nodule, "roi"):
                z = _number(_text(roi, "imageZposition"))
                sop = _text(roi, "imageSOP_UID")
                xs, ys = [], []
                for edge in _children(roi, "edgeMap"):
                    x, y = _number(_text(edge, "xCoord")), _number(_text(edge, "yCoord"))
                    if x is not None and y is not None:
                        xs.append(x)
                        ys.append(y)
                if z is None or not sop or not xs:
                    continue
                points.append({
                    "series_uid": series_uid, "sop_uid": sop, "z": z,
                    "x": round(sum(xs) / len(xs), 2), "y": round(sum(ys) / len(ys), 2),
                    "kind": kind,
                })

        for mark in _children(session, "nonNodule"):
            z = _number(_text(mark, "imageZposition"))
            sop = _text(mark, "imageSOP_UID")
            locus = _child(mark, "locus")
            if z is None or not sop or locus is None:
                continue
            x, y = _number(_text(locus, "xCoord")), _number(_text(locus, "yCoord"))
            if x is None or y is None:
                continue
            points.append({
                "series_uid": series_uid, "sop_uid": sop, "z": z,
                "x": x, "y": y, "kind": KIND_NON_NODULE,
            })

    return series_uid, points


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tcia_folder")
    parser.add_argument("out_csv")
    args = parser.parse_args()

    files = sorted(glob.glob(os.path.join(args.tcia_folder, "**", "*.xml"), recursive=True))
    if not files:
        print("no XML under %s" % args.tcia_folder, file=sys.stderr)
        return 1

    rows = []
    kinds = collections.Counter()
    series = set()
    for path in files:
        series_uid, points = parse(path)
        if not series_uid:
            continue
        for point in points:
            rows.append(point)
            kinds[point["kind"]] += 1
            series.add(series_uid)

    # Deterministic order, so the file hash — which goes into every dataset
    # fingerprint — depends on the annotations and not on directory listing.
    rows.sort(key=lambda r: (r["series_uid"], r["sop_uid"], r["kind"], r["x"], r["y"]))

    os.makedirs(os.path.dirname(args.out_csv) or ".", exist_ok=True)
    with open(args.out_csv, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)

    print("%d XML files -> %d marked points across %d series" % (len(files), len(rows), len(series)),
          file=sys.stderr)
    for kind in (KIND_RATED, KIND_SMALL, KIND_NON_NODULE):
        print("  %-14s %d" % (kind, kinds[kind]), file=sys.stderr)
    print("  written -> %s" % args.out_csv, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
