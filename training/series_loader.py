"""
One LIDC series on disk to a validated HU volume, its lung mask, and its
labelled nodule locations in voxel and patient coordinates.

── The same path the service takes ────────────────────────────────────────

Every step is the service's own code, imported rather than copied:

    pydicom objects
      -> series.read_instance_metadata / assemble / order_slices
      -> quality_gate.evaluate_ct_series
      -> volume.build_volume          (HU, validated frame, refuses on doubt)
      -> lung_mask.build_lung_mask    (the search constraint)

A detector trained on volumes built any other way would meet a different
distribution the day it served, which is the defect that withdrew the legacy
lung model. So there is no second loader, no PNG path, and no 8-bit render.

── Refusal is reported, never absorbed ────────────────────────────────────

A series whose volume, gate or lung mask is refused raises
`SeriesUnavailable` with the service's own reason code. The dataset builder
counts those by code and reports them; it never swaps in another series and
never moves a patient to fill the gap.

── Label identity fails closed ────────────────────────────────────────────

A label row names a slice by SOPInstanceUID and a point by pixel (cx, cy),
with the slice's z recorded from the XML. It resolves to voxel (i, j, k) only
if the SOP is in the ordered series *and* the ordered slice's own z agrees
with the recorded z. Either failing means the row's identity is ambiguous, and
the row is reported as unresolved rather than placed at a guessed location.
"""
from __future__ import annotations

import csv
import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from training import _paths

_paths.ensure_inference_on_path()

from lung_mask import LungMask, LungMaskUnavailable, build_lung_mask  # noqa: E402
from quality_gate import evaluate_ct_series  # noqa: E402
from series import SeriesRejected, assemble, order_slices, read_instance_metadata  # noqa: E402
from volume import CtVolume, VolumeRefused, build_volume  # noqa: E402

# A label's recorded z and the resolved slice's z may differ by rounding in the
# label table (two decimals) and nothing else. Anything more means the SOP UID
# and the position disagree, and the row is not trusted.
LABEL_Z_TOLERANCE_MM = 0.51


class SeriesUnavailable(Exception):
    """This series cannot contribute to training, and why."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class NoduleTarget:
    """A labelled nodule location. A place a radiologist marked — not a diagnosis."""

    key: str            # opaque "<series-ordinal>:<nodule_index>", never a UID
    i: float
    j: float
    k: int
    x_mm: float
    y_mm: float
    z_mm: float


@dataclass
class LoadedSeries:
    series_uid: str
    volume: CtVolume
    lung_mask: LungMask
    targets: List[NoduleTarget]
    exclusion_points_mm: np.ndarray        # (N, 3), every marked location
    unresolved_labels: List[str] = field(default_factory=list)
    unresolved_exclusions: int = 0
    gate: Dict[str, Any] = field(default_factory=dict)


# ── finding series on disk ─────────────────────────────────────────────────

def build_series_index(dicom_root: str) -> Dict[str, str]:
    """SeriesInstanceUID -> directory, from one header per directory."""
    import pydicom

    index: Dict[str, str] = {}
    for dirpath, _dirnames, filenames in os.walk(dicom_root):
        objects = sorted(f for f in filenames if f.lower().endswith(".dcm"))
        if not objects:
            continue
        dataset = pydicom.dcmread(os.path.join(dirpath, objects[0]), stop_before_pixels=True, force=True)
        uid = getattr(dataset, "SeriesInstanceUID", None)
        if uid:
            index[str(uid)] = dirpath
    return index


def cached_series_index(dicom_root: str, cache_path: str, rebuild: bool = False) -> Dict[str, str]:
    """The index, cached under the gitignored artifact tree."""
    if not rebuild and os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as handle:
            cached = json.load(handle)
        if cached.get("root") == os.path.abspath(dicom_root):
            return cached["index"]
    index = build_series_index(dicom_root)
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as handle:
        json.dump({"root": os.path.abspath(dicom_root), "index": index}, handle)
    return index


def load_exclusions(path: str) -> Dict[str, List[Dict[str, str]]]:
    """series_uid -> marked points. Absence fails closed: no index, no negatives."""
    if not os.path.exists(path):
        raise SeriesUnavailable(
            "exclusions_missing",
            "The annotation exclusion index %s does not exist. Without it negatives could be "
            "sampled on top of indeterminate or sub-3 mm nodules. Build it with "
            "scripts/lidc_build_annotation_exclusions.py." % path,
        )
    by_series: Dict[str, List[Dict[str, str]]] = {}
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            by_series.setdefault(row["series_uid"], []).append(row)
    return by_series


# ── one series ─────────────────────────────────────────────────────────────

def load_datasets(directory: str) -> List[Any]:
    import pydicom

    files = sorted(f for f in os.listdir(directory) if f.lower().endswith(".dcm"))
    return [pydicom.dcmread(os.path.join(directory, name), force=True) for name in files]


def volume_from_datasets(datasets: List[Any]) -> Tuple[CtVolume, Any, Dict[str, Any]]:
    """The service's chain, end to end. Raises SeriesUnavailable on any refusal."""
    metas = [read_instance_metadata(ds, index) for index, ds in enumerate(datasets)]
    try:
        members, _assembly = assemble(metas)
    except SeriesRejected as exc:
        raise SeriesUnavailable("series_rejected:" + exc.code, exc.message)

    ordering = order_slices(members)
    gate = evaluate_ct_series(ordering.ordered, ordering)
    if not gate.passed:
        codes = ",".join(sorted(f.get("code", "?") for f in gate.failures))
        raise SeriesUnavailable("quality_gate:" + codes, "the series failed the CT quality gate")

    in_order = [datasets[m.source_index] for m in ordering.ordered]
    try:
        volume = build_volume(ordering.ordered, ordering, in_order, gate_passed=gate.passed)
    except VolumeRefused as exc:
        raise SeriesUnavailable("volume_refused:" + exc.code, exc.message)
    return volume, ordering, gate.as_dict()


def resolve_point(
    ordering: Any, volume: CtVolume, sop_uid: str, x_px: float, y_px: float, z_mm: Optional[float]
) -> Optional[Tuple[float, float, int]]:
    """(i, j, k) for a marked point, or None when its identity does not hold."""
    position = None
    for k, meta in enumerate(ordering.ordered):
        if meta.sop_instance_uid == sop_uid:
            position = k
            break
    if position is None:
        return None
    if z_mm is not None:
        slice_z = volume.frame.origins[position][2]
        if abs(slice_z - z_mm) > LABEL_Z_TOLERANCE_MM:
            return None
    rows, columns = volume.shape[1], volume.shape[2]
    if not (0 <= x_px < columns and 0 <= y_px < rows):
        return None
    return float(x_px), float(y_px), int(position)


def load_series(
    series_uid: str,
    directory: str,
    label_rows: List[Dict[str, str]],
    exclusion_rows: List[Dict[str, str]],
    ordinal: int,
) -> LoadedSeries:
    """Volume, mask, targets and exclusion points for one series."""
    datasets = load_datasets(directory)
    if not datasets:
        raise SeriesUnavailable("no_objects", "no DICOM objects in the series directory")
    volume, ordering, gate = volume_from_datasets(datasets)
    # The pixel-bearing objects are no longer needed once the HU volume exists.
    # Holding both roughly doubles peak memory on a 250-slice series, which is
    # enough to kill the process on an 8 GB machine.
    del datasets

    try:
        mask = build_lung_mask(volume)
    except LungMaskUnavailable as exc:
        raise SeriesUnavailable("lung_mask_unavailable:" + exc.code, exc.message)

    targets: List[NoduleTarget] = []
    unresolved: List[str] = []
    for row in label_rows:
        key = "%d:%s" % (ordinal, row["nodule_index"])
        z_value = float(row["z"]) if row.get("z") not in (None, "") else None
        point = resolve_point(ordering, volume, row["sop_uid"], float(row["cx"]), float(row["cy"]), z_value)
        if point is None:
            unresolved.append(key)
            continue
        i, j, k = point
        x_mm, y_mm, z_mm = volume.voxel_to_patient(i, j, k)
        targets.append(NoduleTarget(key=key, i=i, j=j, k=k, x_mm=x_mm, y_mm=y_mm, z_mm=z_mm))

    points_mm: List[Tuple[float, float, float]] = []
    unresolved_exclusions = 0
    for row in exclusion_rows:
        point = resolve_point(ordering, volume, row["sop_uid"], float(row["x"]), float(row["y"]),
                              float(row["z"]) if row.get("z") else None)
        if point is None:
            unresolved_exclusions += 1
            continue
        points_mm.append(volume.voxel_to_patient(*point))
    # Every labelled target is also an exclusion point, whatever the index says.
    points_mm.extend((t.x_mm, t.y_mm, t.z_mm) for t in targets)

    return LoadedSeries(
        series_uid=series_uid,
        volume=volume,
        lung_mask=mask,
        targets=targets,
        exclusion_points_mm=np.asarray(points_mm, dtype=np.float64).reshape(-1, 3),
        unresolved_labels=unresolved,
        unresolved_exclusions=unresolved_exclusions,
        gate=gate,
    )
