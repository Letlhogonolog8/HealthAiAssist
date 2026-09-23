#!/usr/bin/env python3
"""
Per-nodule size, derived from the reader contours already in the LIDC XML.

    python scripts/lidc_extract_diameters.py "TCIA Folder" dataset/lidc-diameters.csv
    python scripts/lidc_extract_diameters.py "TCIA Folder" out.csv \
        --dicom-root dataset/manifest-1600709154662/LIDC-IDRI \
        --labels dataset/lidc-labels.csv

── Why this exists ────────────────────────────────────────────────────────

`dataset/lidc-labels.csv` carries a centroid per nodule and no size.
`scripts/lidc_build_labels.py` reads every `edgeMap` in the XML — the full
per-slice boundary each radiologist drew — and reduces it to that centroid,
discarding the boundary. So the information needed for a size is already on
disk and nothing needs downloading.

Size matters for detection evaluation because the conventional way to decide
whether a detected candidate *is* a given reference nodule is whether the
candidate's centre falls within that nodule's radius. Without a radius there
is no localisation tolerance, and a sensitivity figure quoted without one is
not interpretable. See docs/ML_CHANGE_PROCESS.md.

── What this measures, exactly ────────────────────────────────────────────

Two numbers per nodule, because they fail differently:

  max_in_plane_diameter   The largest distance between any two points on one
                          reader's boundary, taken over every slice of that
                          nodule. This is the longest axis a reader drew. It
                          is sensitive to a single stray boundary point.

  equivalent_area_diameter  The diameter of a circle with the same area as the
                          largest contour that reader drew, area by the
                          shoelace formula. Robust to a stray point, and
                          smaller than the max for any non-circular shape.

Also recorded: `slice_span_mm`, the through-plane extent, which is not a
diameter and is not interchangeable with one.

── What this is NOT ───────────────────────────────────────────────────────

**Reader-derived measurement, not segmentation-derived ground truth.** These
numbers come from boundaries radiologists drew by eye on a workstation. They
are not the output of a validated segmentation, they carry inter-reader
variation, and they must never be described as a measured nodule volume or as
ground truth for a segmentation model. P3 is where a validated segmentation
and its Dice would come from; this is not that.

A diameter is also not a radius, not a bounding box, and not a volume. The
column names say which is which and no column is derived from another.

── Aggregation across readers ─────────────────────────────────────────────

Up to four radiologists contour the same nodule and they disagree. The
per-reader values are kept in the output, and the aggregate is the **median**
across readers — the same convention `scripts/lidc_build_labels.py` already
uses for malignancy ratings, for the same reason: it is the convention in the
literature and it does not let one outlying reader carry the value.

Disagreement is not collapsed silently. `n_readers_measured` and the
per-reader list are both emitted, so a wide spread is visible rather than
hidden inside an average.

── Units ──────────────────────────────────────────────────────────────────

Contour coordinates are pixel indices. Millimetres require PixelSpacing,
which lives in the DICOM and not in the XML, so:

  * pixel measurements are always emitted;
  * millimetre measurements are emitted only when `--dicom-root` is given and
    the series is found. Otherwise the mm columns are blank.

They are never estimated from an assumed spacing. LIDC in-plane spacing runs
roughly 0.5-0.9 mm and assuming a value would put a 30% error into the one
number the localisation tolerance depends on.

Row and column spacing are applied separately, so a non-square pixel gives a
correct distance rather than one scaled by whichever value was picked.
"""
from __future__ import annotations

import argparse
import collections
import csv
import glob
import importlib.util
import math
import os
import statistics
import sys
import xml.etree.ElementTree as ET

NS = "{http://www.nih.gov}"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# A nodule smaller than 3 mm is marked in LIDC as a single point rather than a
# boundary, and a "diameter" from one point is zero. Those are recorded as
# unmeasurable rather than as zero, because zero is a number somebody will
# later average.
MIN_CONTOUR_POINTS = 3


def _load_label_pipeline():
    """The existing label module, imported by path and not modified.

    Nodule identity has to match `dataset/lidc-labels.csv` exactly or the two
    tables cannot be joined, so the clustering is reused rather than
    reimplemented. The file has a hyphenless name but lives outside a package,
    hence importlib.
    """
    path = os.path.join(ROOT, "scripts", "lidc_build_labels.py")
    spec = importlib.util.spec_from_file_location("lidc_build_labels", path)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _text(node, tag):
    found = node.find(f"{NS}{tag}")
    return (found.text or "").strip() if found is not None else ""


def polygon_area_px(points):
    """Shoelace area of a closed contour, in square pixels.

    Absolute value, so the winding direction a reader happened to draw in does
    not change the sign.
    """
    if len(points) < MIN_CONTOUR_POINTS:
        return 0.0
    total = 0.0
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def max_pairwise_distance(points, row_mm=1.0, col_mm=1.0):
    """The longest chord of a contour.

    `row_mm` and `col_mm` scale the two axes independently, so an anisotropic
    pixel gives a true distance. With both at 1.0 the result is in pixels.

    O(n^2) on purpose: LIDC contours are tens of points, and a convex-hull
    rotating-caliper version would be faster and harder to check.
    """
    if len(points) < 2:
        return 0.0
    longest = 0.0
    for index, (x1, y1) in enumerate(points):
        for x2, y2 in points[index + 1:]:
            dx = (x2 - x1) * col_mm
            dy = (y2 - y1) * row_mm
            longest = max(longest, math.hypot(dx, dy))
    return longest


def parse_contour_readings(path):
    """Every nodule reading in one XML, with its contours kept.

    Deliberately a second parser rather than a change to
    `parse_reading_sessions`: that function is part of a verified pipeline and
    the instruction for this work is not to modify it. The filters below
    mirror it exactly — same malignancy range, same skip on missing
    characteristics — so the readings come out in the same order and the
    reused clustering assigns the same nodule_index.
    """
    tree = ET.parse(path)
    root = tree.getroot()

    header = root.find(f"{NS}ResponseHeader")
    series_uid = _text(header, "SeriesInstanceUid") if header is not None else ""

    readings = []
    for session in root.findall(f"{NS}readingSession"):
        for nodule in session.findall(f"{NS}unblindedReadNodule"):
            characteristics = nodule.find(f"{NS}characteristics")
            if characteristics is None:
                continue
            raw = _text(characteristics, "malignancy")
            if not raw.isdigit():
                continue
            malignancy = int(raw)
            if not 1 <= malignancy <= 5:
                continue

            xs, ys, zs, slices, contours = [], [], [], [], []
            for roi in nodule.findall(f"{NS}roi"):
                z = _text(roi, "imageZposition")
                sop = _text(roi, "imageSOP_UID")
                edges = roi.findall(f"{NS}edgeMap")
                if not edges:
                    continue
                points = []
                for edge in edges:
                    ex, ey = _text(edge, "xCoord"), _text(edge, "yCoord")
                    if ex.lstrip("-").isdigit() and ey.lstrip("-").isdigit():
                        points.append((int(ex), int(ey)))
                if not points:
                    continue
                xs.append(sum(p[0] for p in points) / len(points))
                ys.append(sum(p[1] for p in points) / len(points))
                z_value = None
                if z:
                    try:
                        z_value = float(z)
                        zs.append(z_value)
                    except ValueError:
                        pass
                if sop:
                    slices.append((z_value or 0.0, sop,
                                   sum(p[0] for p in points) / len(points),
                                   sum(p[1] for p in points) / len(points)))
                contours.append({"z": z_value, "points": points})

            if not xs or not zs:
                continue

            readings.append({
                "malignancy": malignancy,
                "cx": sum(xs) / len(xs),
                "cy": sum(ys) / len(ys),
                "cz": sum(zs) / len(zs),
                "slices": slices,
                "contours": contours,
            })

    return series_uid, readings


def measure_reading(reading, row_mm=None, col_mm=None):
    """One reader's size measurements for one nodule.

    Returns None when that reader drew nothing measurable — a single-point
    mark, or boundaries too short to enclose an area. None is not zero, and
    the caller keeps it out of the aggregate rather than averaging it in.
    """
    usable = [c for c in reading["contours"] if len(c["points"]) >= MIN_CONTOUR_POINTS]
    if not usable:
        return None

    scale_row = row_mm if row_mm else 1.0
    scale_col = col_mm if col_mm else 1.0

    max_chord_px = max(max_pairwise_distance(c["points"]) for c in usable)
    max_chord_mm = (
        max(max_pairwise_distance(c["points"], scale_row, scale_col) for c in usable)
        if row_mm and col_mm
        else None
    )

    areas_px = [polygon_area_px(c["points"]) for c in usable]
    largest_area_px = max(areas_px)
    if largest_area_px <= 0:
        return None

    equivalent_px = 2.0 * math.sqrt(largest_area_px / math.pi)
    equivalent_mm = (
        2.0 * math.sqrt((largest_area_px * scale_row * scale_col) / math.pi)
        if row_mm and col_mm
        else None
    )

    z_values = sorted({c["z"] for c in usable if c["z"] is not None})
    span_mm = round(z_values[-1] - z_values[0], 3) if len(z_values) >= 2 else 0.0

    return {
        "max_in_plane_diameter_px": round(max_chord_px, 3),
        "max_in_plane_diameter_mm": round(max_chord_mm, 3) if max_chord_mm is not None else None,
        "equivalent_area_diameter_px": round(equivalent_px, 3),
        "equivalent_area_diameter_mm": round(equivalent_mm, 3) if equivalent_mm is not None else None,
        "slice_span_mm": span_mm,
        "contour_slices": len(usable),
    }


def aggregate(measurements, key):
    """Median across readers, the convention this project already uses."""
    values = [m[key] for m in measurements if m.get(key) is not None]
    if not values:
        return None
    return round(statistics.median(values), 3)


def pixel_spacing_for_series(dicom_root, series_uid):
    """(row_mm, col_mm) for a series, read from one of its objects.

    Returns (None, None) when the series is not on disk, so the caller emits
    pixel measurements and leaves millimetres blank rather than assuming a
    spacing.
    """
    if not dicom_root or not os.path.isdir(dicom_root):
        return None, None
    try:
        import pydicom
    except ImportError:  # pragma: no cover - pydicom is a project dependency
        return None, None

    for path in glob.iglob(os.path.join(dicom_root, "**", "*.dcm"), recursive=True):
        try:
            ds = pydicom.dcmread(path, stop_before_pixels=True, force=True)
        except Exception:  # noqa: BLE001
            continue
        if str(getattr(ds, "SeriesInstanceUID", "")) != series_uid:
            continue
        spacing = getattr(ds, "PixelSpacing", None)
        if spacing is None or len(spacing) != 2:
            return None, None
        try:
            return float(spacing[0]), float(spacing[1])
        except (TypeError, ValueError):
            return None, None
    return None, None


def load_label_index(path):
    """(series_uid, nodule_index) -> row, for cross-checking identity."""
    if not path or not os.path.exists(path):
        return {}
    index = {}
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            index[(row["series_uid"], int(row["nodule_index"]))] = row
    return index


FIELDNAMES = [
    "patient",
    "series_uid",
    "nodule_index",
    "n_readers_measured",
    "max_in_plane_diameter_mm",
    "equivalent_area_diameter_mm",
    "max_in_plane_diameter_px",
    "equivalent_area_diameter_px",
    "slice_span_mm",
    "per_reader_max_in_plane_px",
    "pixel_spacing_row_mm",
    "pixel_spacing_col_mm",
    "measurement_source",
    "aggregation",
    "unmeasurable_reason",
]


def build_rows(chosen, digest, match_mm, dicom_root, cluster_fn):
    rows = []
    stats = collections.Counter()
    spacing_cache = {}

    for series_uid, (path, _canonical) in sorted(chosen.items()):
        _uid, readings = parse_contour_readings(path)
        if not readings:
            continue

        meta = digest.get(series_uid) if digest else None
        patient = meta["patient"] if meta else ""

        if series_uid not in spacing_cache:
            spacing_cache[series_uid] = pixel_spacing_for_series(dicom_root, series_uid)
        row_mm, col_mm = spacing_cache[series_uid]

        for position, group in enumerate(cluster_fn(readings, match_mm)):
            measurements = [m for m in (measure_reading(r, row_mm, col_mm) for r in group) if m]
            if not measurements:
                stats["unmeasurable"] += 1
                rows.append({
                    "patient": patient,
                    "series_uid": series_uid,
                    "nodule_index": position,
                    "n_readers_measured": 0,
                    "max_in_plane_diameter_mm": "",
                    "equivalent_area_diameter_mm": "",
                    "max_in_plane_diameter_px": "",
                    "equivalent_area_diameter_px": "",
                    "slice_span_mm": "",
                    "per_reader_max_in_plane_px": "",
                    "pixel_spacing_row_mm": row_mm if row_mm else "",
                    "pixel_spacing_col_mm": col_mm if col_mm else "",
                    "measurement_source": "reader_contour",
                    "aggregation": "median_across_readers",
                    "unmeasurable_reason": "no reader drew a contour of at least "
                                           f"{MIN_CONTOUR_POINTS} points",
                })
                continue

            stats["measured"] += 1
            rows.append({
                "patient": patient,
                "series_uid": series_uid,
                "nodule_index": position,
                "n_readers_measured": len(measurements),
                "max_in_plane_diameter_mm": aggregate(measurements, "max_in_plane_diameter_mm") or "",
                "equivalent_area_diameter_mm": aggregate(measurements, "equivalent_area_diameter_mm") or "",
                "max_in_plane_diameter_px": aggregate(measurements, "max_in_plane_diameter_px"),
                "equivalent_area_diameter_px": aggregate(measurements, "equivalent_area_diameter_px"),
                "slice_span_mm": aggregate(measurements, "slice_span_mm"),
                "per_reader_max_in_plane_px": "|".join(
                    str(m["max_in_plane_diameter_px"]) for m in measurements
                ),
                "pixel_spacing_row_mm": row_mm if row_mm else "",
                "pixel_spacing_col_mm": col_mm if col_mm else "",
                "measurement_source": "reader_contour",
                "aggregation": "median_across_readers",
                "unmeasurable_reason": "",
            })

    return rows, stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("tcia_folder")
    parser.add_argument("out_csv")
    parser.add_argument("--match-mm", type=float, default=12.0,
                        help="must match the value lidc_build_labels.py used, or the "
                             "nodule_index values will not line up")
    parser.add_argument("--dicom-root", default=None,
                        help="where the DICOM lives, for PixelSpacing. Without it the "
                             "millimetre columns are left blank rather than assumed.")
    parser.add_argument("--labels", default=None,
                        help="dataset/lidc-labels.csv, to cross-check nodule identity")
    args = parser.parse_args()

    pipeline = _load_label_pipeline()

    xml_files = glob.glob(os.path.join(args.tcia_folder, "**", "*.xml"), recursive=True)
    if not xml_files:
        print(f"no XML under {args.tcia_folder}", file=sys.stderr)
        raise SystemExit(1)

    parsed = collections.defaultdict(list)
    for path in xml_files:
        series_uid, readings = pipeline.parse_reading_sessions(path)
        if not readings:
            continue
        parsed[series_uid].append((path, readings))

    chosen, _notes = pipeline.choose_one_xml_per_series(parsed)
    try:
        digest = pipeline.load_digest(args.tcia_folder)
    except Exception as exc:  # noqa: BLE001
        print(f"digest unavailable ({exc}); patient column will be blank", file=sys.stderr)
        digest = {}

    rows, stats = build_rows(chosen, digest, args.match_mm, args.dicom_root, pipeline.cluster)

    labels = load_label_index(args.labels)
    if labels:
        produced = {(r["series_uid"], r["nodule_index"]) for r in rows}
        missing = [key for key in labels if key not in produced]
        print(f"identity cross-check: {len(labels)} labelled nodules, "
              f"{len(missing)} without a matching measurement row", file=sys.stderr)
        if missing:
            print("  (a labelled nodule with no row means the clustering diverged; "
                  "check --match-mm)", file=sys.stderr)

    rows.sort(key=lambda r: (r["series_uid"], r["nodule_index"]))
    with open(args.out_csv, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)

    print(f"{len(rows)} nodules -> {args.out_csv}", file=sys.stderr)
    for key, count in sorted(stats.items()):
        print(f"  {key}: {count}", file=sys.stderr)
    print("  measurements are reader-derived, not segmentation ground truth",
          file=sys.stderr)


if __name__ == "__main__":
    main()
