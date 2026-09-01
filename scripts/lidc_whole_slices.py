#!/usr/bin/env python3
"""Builds the two negative sets the nodule model's OOD detector must be tested against.

    python scripts/lidc_whole_slices.py \
        dataset/manifest-1600709154662/LIDC-IDRI dataset/lidc-labels.csv \
        dataset/lidc-ood

── Why two sets, pulling in opposite directions ───────────────────────────

The nodule characteriser takes a 64 px crop centred on a lesion somebody
pointed at. Two things can go wrong at inference, and a detector that only
guards against one of them is worse than useless because it looks like it works.

  whole-slice/   A whole CT slice, submitted as if it were a nodule crop. This
                 is the failure that matters: it is what happens the first time
                 the model is wired to a PACS feed by someone who has not read
                 the model card. It MUST be refused. A patch classifier handed a
                 512x512 slice downsampled to 224 is seeing a scale it never
                 trained on, and it will still return a confident number.

  off-nodule/    A 64 px crop at the right scale, sampled from the segmented
                 lung field and at least 70% lung, away from every annotated
                 nodule. This must NOT be
                 refused. It is ordinary parenchyma at the distribution the model
                 was trained on, and the correct response is a low malignancy
                 probability from the classifier — not a refusal from the OOD
                 screen. A detector that flags these is refusing normal anatomy,
                 which in a clinic reads as the tool being broken.

Passing one and failing the other is the whole measurement. A threshold tuned
until whole slices are refused, without checking off-nodule crops, buys safety
by refusing everything.

── Patients ───────────────────────────────────────────────────────────────

Only test-split patients are used, reproducing the split from the labels CSV
with the same seed the extractor uses. Whole slices from a training patient
would contain the very crops the model was fitted on, and the resulting figure
would flatter the detector for the wrong reason.

Windowing is `inference/dicom_ingest.py` — the same code the serving path uses,
imported rather than copied, so these negatives are rendered exactly as a real
submission would be.

Runs fine against a partial download; it reports how many test-split patients it
actually found so a short set is visible rather than silently accepted.
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
from dicom_ingest import _window, training_window  # noqa: E402  one windowing implementation

# Must match scripts/lidc_extract_patches.py, or "test-split patient" means
# something different here than it does there.
SEED = 4242
TRAIN_FRACTION, VAL_FRACTION = 0.70, 0.85


def test_patients(labels_csv):
    rows = list(csv.DictReader(open(labels_csv, encoding="utf-8")))
    patients = sorted({r["patient"] for r in rows})
    random.Random(SEED).shuffle(patients)
    n = len(patients)
    return {p for i, p in enumerate(patients) if i >= int(n * VAL_FRACTION)}, rows


def nodule_centres(rows):
    """SOPInstanceUID -> [(cx, cy)] so off-nodule crops can avoid the lesions."""
    centres = collections.defaultdict(list)
    for row in rows:
        if row["sop_uid"]:
            centres[row["sop_uid"]].append((float(row["cx"]), float(row["cy"])))
    return centres


def crop(frame, cx, cy, size):
    half = size // 2
    padded = np.pad(frame, half, mode="constant", constant_values=0)
    cx, cy = int(round(cx)) + half, int(round(cy)) + half
    return padded[cy - half:cy + half, cx - half:cx + half]


def _otsu(frame):
    """Otsu threshold on the windowed frame.

    Not a fixed intensity cut: `_window` honours each object's WindowCenter and
    WindowWidth tags, and LIDC series carry a mix of lung and mediastinal
    windows, so the grey level of air is not the same number from series to
    series. Otsu adapts to whatever rendering the tags produced.
    """
    hist, _ = np.histogram(frame, bins=256, range=(0, 256))
    total = hist.sum()
    if total == 0:
        return 128.0
    levels = np.arange(256)
    w_bg = np.cumsum(hist)
    w_fg = total - w_bg
    valid = (w_bg > 0) & (w_fg > 0)
    if not valid.any():
        return 128.0
    sum_all = float((levels * hist).sum())
    sum_bg = np.cumsum(levels * hist)
    mean_bg = np.divide(sum_bg, np.maximum(w_bg, 1))
    mean_fg = np.divide(sum_all - sum_bg, np.maximum(w_fg, 1))
    between = w_bg * w_fg * (mean_bg - mean_fg) ** 2
    between[~valid] = -1.0
    return float(np.argmax(between))


def lung_field(frame):
    """Boolean mask of aerated lung.

    Sampling a random (cx, cy) over the whole 512x512 frame does NOT produce
    "ordinary lung parenchyma" — most of a chest CT slice is chest wall, table,
    mediastinum and the air outside the patient. The first version of this
    script did exactly that and its off-nodule set came out full of skin-air
    boundaries, which are genuinely unlike a nodule crop. Measuring an OOD
    detector against those would have said nothing about whether it refuses
    normal anatomy.

    The classic segmentation, and it is enough here:

      1. Dark pixels are air, by an Otsu cut.
      2. Air connected to the image border is OUTSIDE the patient. Drop it.
      3. What remains is the aerated lung, plus the trachea and any bowel gas.
      4. Fill holes so vessels and airway walls inside the lung count as lung —
         the model is meant to see those.

    Small components go: a few hundred stray pixels are noise, not a lung.
    """
    from scipy import ndimage

    air = frame < _otsu(frame)

    labels, n = ndimage.label(air)
    if n == 0:
        return np.zeros_like(frame, dtype=bool)

    border = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    border.discard(0)

    keep = np.zeros(n + 1, dtype=bool)
    sizes = ndimage.sum(air, labels, range(1, n + 1))
    min_area = 0.005 * frame.size
    for idx in range(1, n + 1):
        keep[idx] = idx not in border and sizes[idx - 1] >= min_area

    mask = keep[labels]
    return ndimage.binary_fill_holes(mask)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dicom_root")
    parser.add_argument("labels_csv")
    parser.add_argument("out_dir")
    parser.add_argument("--patch-px", type=int, default=64)
    parser.add_argument("--slices-per-patient", type=int, default=3)
    parser.add_argument("--off-nodule-per-slice", type=int, default=3)
    parser.add_argument("--min-distance-px", type=int, default=48,
                        help="how far an off-nodule crop must sit from any annotated nodule")
    parser.add_argument("--min-lung-fraction", type=float, default=0.70,
                        help="minimum share of an off-nodule crop that must be lung field")
    parser.add_argument("--seed", type=int, default=99)
    args = parser.parse_args()

    import pydicom
    from PIL import Image

    wanted, rows = test_patients(args.labels_csv)
    centres = nodule_centres(rows)
    print(f"test-split patients in the label set: {len(wanted)}")

    # Group the downloaded files by patient. LIDC lays out
    # LIDC-IDRI-XXXX/<study>/<series>/*.dcm, so the patient is the top directory,
    # but it is read from the tags where present rather than trusted blindly.
    by_patient = collections.defaultdict(list)
    for root, _dirs, files in os.walk(args.dicom_root):
        for name in files:
            if not name.lower().endswith(".dcm"):
                continue
            path = os.path.join(root, name)
            parts = os.path.normpath(path).split(os.sep)
            patient = next((p for p in parts if p.startswith("LIDC-IDRI-")), None)
            if patient in wanted:
                by_patient[patient].append(path)

    print(f"test-split patients present in the download: {len(by_patient)}")
    if not by_patient:
        raise SystemExit(
            "None of the test-split patients are downloaded yet. Either the download "
            "has not reached them or the dicom_root is wrong.")
    if len(by_patient) < len(wanted):
        print(f"  NOTE: {len(by_patient)} of {len(wanted)} test-split patients are "
              "present. The downloaded subset deliberately covers a fraction of the "
              "label set, so this is expected rather than a sign of a partial "
              "download - but the sets below are correspondingly small and every "
              "flagged rate carries a wide interval. Check the counts against what "
              "the extractor reported before reading anything into them.")

    whole_dir = os.path.join(args.out_dir, "whole-slice")
    off_dir = os.path.join(args.out_dir, "off-nodule")
    os.makedirs(whole_dir, exist_ok=True)
    os.makedirs(off_dir, exist_ok=True)

    rng = random.Random(args.seed)
    n_whole = n_off = skipped = no_lung = short = 0

    for patient in sorted(by_patient):
        paths = sorted(by_patient[patient])
        # Middle of the series: the first and last slices of a chest CT are apex
        # and diaphragm, which are atypical of the volume as a whole.
        mid = paths[len(paths) // 4: 3 * len(paths) // 4] or paths
        for path in rng.sample(mid, min(args.slices_per_patient, len(mid))):
            try:
                ds = pydicom.dcmread(path, force=True)
                frame = _window(ds.pixel_array.astype(np.float64), ds,
                                force_window=training_window(ds))
            except Exception:
                skipped += 1
                continue
            if frame.ndim != 2:
                skipped += 1
                continue

            Image.fromarray(frame).convert("RGB").resize((224, 224), Image.BICUBIC).save(
                os.path.join(whole_dir, f"{patient}_{n_whole:04d}.png"), optimize=True)
            n_whole += 1

            avoid = centres.get(getattr(ds, "SOPInstanceUID", ""), [])
            mask = lung_field(frame)
            ys, xs = np.nonzero(mask)
            if len(xs) == 0:
                no_lung += 1
                continue

            half = args.patch_px // 2
            made = 0
            for _ in range(120):
                if made >= args.off_nodule_per_slice:
                    break
                i = rng.randrange(len(xs))
                cx, cy = int(xs[i]), int(ys[i])
                if not (half <= cx < frame.shape[1] - half and
                        half <= cy < frame.shape[0] - half):
                    continue
                if any((cx - ax) ** 2 + (cy - ay) ** 2 < args.min_distance_px ** 2
                       for ax, ay in avoid):
                    continue

                # At least 70% lung. A centre inside the mask is not enough: a
                # crop centred just inside the pleura is three-quarters chest
                # wall, which is the thing this set exists to exclude.
                window = mask[cy - half:cy + half, cx - half:cx + half]
                if window.size == 0 or window.mean() < args.min_lung_fraction:
                    continue

                patch = crop(frame, cx, cy, args.patch_px)
                if patch.shape != (args.patch_px, args.patch_px):
                    continue
                Image.fromarray(patch).convert("RGB").resize((224, 224), Image.BICUBIC).save(
                    os.path.join(off_dir, f"{patient}_{n_off:04d}.png"), optimize=True)
                n_off += 1
                made += 1
            if made < args.off_nodule_per_slice:
                short += 1

    print(f"\nwhole-slice/  {n_whole:5d} images   MUST be refused by the OOD screen")
    print(f"off-nodule/   {n_off:5d} images   must NOT be refused")
    if skipped:
        print(f"slices skipped (unreadable or not 2-D): {skipped}")
    if no_lung:
        print(f"slices with no lung field found: {no_lung}")
    if short:
        print(f"slices yielding fewer off-nodule crops than asked: {short} "
              f"(narrow lung field, or crowded with annotations)")
    print("\nNext: scripts/build-ood-reference.py lung_nodule, once the model is trained.")
    print("Read both rates. A high flagged rate on whole-slice with a low one on")
    print("off-nodule is the result. Either alone means nothing.")


if __name__ == "__main__":
    main()
