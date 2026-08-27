"""
Turns downloaded LIDC-IDRI CT series into labelled 2-D training patches.

    python scripts/lidc_extract_patches.py \
        <dicom_root> dataset/lidc-labels.csv dataset/lidc-ct \
        --slices-per-nodule 5

── The design decision this encodes, stated up front ──────────────────────

This produces **crops centred on an annotated nodule**, not whole slices. That
is the standard approach for LIDC malignancy work and it is the only one the
labels support: a whole slice containing one 4 mm benign nodule is, to a
classifier, almost entirely normal lung, and labelling the slice "benign"
teaches nothing about the nodule.

**It also changes what the lung modality is.** The deployed model today takes a
chest image and answers cancer / no cancer. A patch classifier answers "is THIS
nodule malignant", which needs somebody or something to point at the nodule
first. Two honest ways to ship that:

  1. A clinician marks the nodule and asks for a characterisation. A real
     workflow, and the smaller claim.
  2. A detector finds candidate nodules and this classifies them. More useful,
     considerably more work, and a second model to validate.

What is NOT honest is training on crops and deploying on whole images. The model
would see, at inference, a distribution it never trained on — which is precisely
the defect that made the current lung model refuse real DICOM in the first
place. Whichever route is taken, the model card has to say which one.

── Windowing is imported, not reimplemented ───────────────────────────────

Patches are windowed by `inference/dicom_ingest.py`, the same code the serving
path uses. Training and inference windowing that drift apart produce a model
that scores well offline and fails in the field, and it is invisible in every
metric until it reaches a patient. One implementation, imported by both.
"""
from __future__ import annotations

import argparse
import collections
import csv
import os
import random
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "inference"))
from dicom_ingest import _window  # noqa: E402  same windowing as the serving path


def index_series(dicom_root):
    """SOPInstanceUID -> file path, and SeriesInstanceUID -> [(z, path)].

    LIDC arrives as LIDC-IDRI-XXXX/<study>/<series>/*.dcm, but the directory
    names are UIDs that do not always match what the annotations reference, so
    the index is built by reading tags rather than by trusting the layout.
    """
    import pydicom

    by_sop = {}
    by_series = collections.defaultdict(list)
    scanned = 0

    for root, _dirs, files in os.walk(dicom_root):
        for name in files:
            if not name.lower().endswith(".dcm"):
                continue
            path = os.path.join(root, name)
            try:
                # stop_before_pixels: this pass only needs the identifiers, and
                # reading pixel data for every file in a 20 GB collection would
                # take hours to build an index.
                ds = pydicom.dcmread(path, stop_before_pixels=True, force=True)
            except Exception:
                continue
            scanned += 1
            sop = getattr(ds, "SOPInstanceUID", None)
            series = getattr(ds, "SeriesInstanceUID", None)
            if sop:
                by_sop[sop] = path
            if series:
                try:
                    z = float(getattr(ds, "ImagePositionPatient", [0, 0, 0])[2])
                except Exception:
                    z = 0.0
                by_series[series].append((z, path))

    for series in by_series:
        by_series[series].sort(key=lambda pair: pair[0])

    return by_sop, by_series, scanned


def crop(frame, cx, cy, size):
    """A square crop centred on (cx, cy), zero-padded at the edges.

    Padding rather than shifting the centre: a nodule near the chest wall is
    exactly the case where moving the crop would put the lesion off-centre and
    teach the model that malignancy lives at the edge of the frame.
    """
    half = size // 2
    padded = np.pad(frame, half, mode="constant", constant_values=0)
    cx, cy = int(round(cx)) + half, int(round(cy)) + half
    return padded[cy - half:cy + half, cx - half:cx + half]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dicom_root")
    parser.add_argument("labels_csv")
    parser.add_argument("out_dir")
    parser.add_argument("--patch-px", type=int, default=64,
                        help="native-resolution crop before resizing to 224")
    parser.add_argument("--slices-per-nodule", type=int, default=5,
                        help="centre slice plus neighbours either side")
    parser.add_argument("--seed", type=int, default=4242)
    args = parser.parse_args()

    import pydicom
    from PIL import Image

    rows = [r for r in csv.DictReader(open(args.labels_csv, encoding="utf-8")) if r["sop_uid"]]
    print(f"labelled nodules with a centre slice: {len(rows)}")

    print("indexing DICOM (tags only)...")
    by_sop, by_series, scanned = index_series(args.dicom_root)
    print(f"  {scanned} files, {len(by_sop)} SOP UIDs, {len(by_series)} series")

    # Patient-level split, decided before a single patch is written.
    #
    # Nodules from one patient must never straddle the split. Two nodules in the
    # same chest share anatomy, scanner, reconstruction kernel and dose, and a
    # model that has seen one has partial knowledge of the other. That is the
    # exact flaw that made the previous lung model's figures optimistic, and it
    # is unfixable after the fact because you cannot tell from the metrics.
    patients = sorted({r["patient"] for r in rows})
    random.Random(args.seed).shuffle(patients)
    n = len(patients)
    split_of = {}
    for i, patient in enumerate(patients):
        split_of[patient] = "train" if i < int(n * 0.70) else "val" if i < int(n * 0.85) else "test"

    counts = collections.Counter()
    missing = 0

    for row in rows:
        path = by_sop.get(row["sop_uid"])
        if not path:
            missing += 1
            continue

        series_slices = by_series.get(row["series_uid"], [])
        centre = next((i for i, (_z, p) in enumerate(series_slices) if p == path), None)
        if centre is None:
            missing += 1
            continue

        span = args.slices_per_nodule // 2
        chosen = series_slices[max(0, centre - span): centre + span + 1]

        label = "cancer" if row["positive"] == "1" else "no_cancer"
        split = split_of[row["patient"]]
        target = os.path.join(args.out_dir, split, label)
        os.makedirs(target, exist_ok=True)

        for offset, (_z, slice_path) in enumerate(chosen):
            try:
                ds = pydicom.dcmread(slice_path, force=True)
                frame = _window(ds.pixel_array.astype(np.float64), ds)
            except Exception:
                continue

            patch = crop(frame, float(row["cx"]), float(row["cy"]), args.patch_px)
            if patch.shape != (args.patch_px, args.patch_px):
                continue

            image = Image.fromarray(patch).convert("RGB").resize((224, 224), Image.BICUBIC)
            name = f"{row['patient']}_{row['nodule_index']}_{offset}.png"
            image.save(os.path.join(target, name), optimize=True)
            counts[(split, label)] += 1

    print(f"\nnodules whose centre slice was not in the download: {missing}")
    print("\npatches written:")
    for split in ("train", "val", "test"):
        cancer = counts[(split, "cancer")]
        benign = counts[(split, "no_cancer")]
        share = sum(1 for p in patients if split_of[p] == split)
        print(f"  {split:<6} {cancer:>6} cancer  {benign:>6} no_cancer   ({share} patients)")

    total_test = counts[("test", "cancer")]
    if total_test:
        # Wilson half-width at 95%, p=0.8 — the honest precision of what the
        # held-out set will be able to say about sensitivity.
        z, p = 1.96, 0.8
        half = z * ((p * (1 - p) / total_test) ** 0.5)
        print(f"\n  Test set has {total_test} malignant patches. A sensitivity around 0.80")
        print(f"  would carry a 95% interval of roughly +/-{half:.2f} — and patches from")
        print("  one nodule are NOT independent, so the true interval is wider still.")
        print("  Report the interval, not the point estimate.")


if __name__ == "__main__":
    main()
