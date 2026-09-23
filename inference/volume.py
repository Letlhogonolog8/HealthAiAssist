"""
An ordered CT series to a Hounsfield-unit volume.

── What a volume is, here ─────────────────────────────────────────────────

A stack of slices is not a volume. A volume is a stack plus a coordinate
system: it has to know which end is the patient's head, how far apart the
slices are, and where voxel (0, 0, 0) sits in the patient. Everything this
module refuses to build is a case where one of those is unknown.

The refusals matter more than the construction. A volume assembled from a
series with untrustworthy ordering, or with the polarity undetermined, is not
obviously broken — it is a well-formed array of plausible numbers in which the
anatomy is scrambled or mirrored. Nothing downstream can detect that, and a
detection candidate reported against it points at the wrong part of the
patient. So this refuses rather than repairs, and says which check failed.

── Hounsfield units, not a rendered image ─────────────────────────────────

`inference/dicom_ingest.py` renders slices to 8-bit through the lung window
for the nodule characteriser, which was trained that way. This does something
different on purpose: it applies the modality LUT and stops, leaving real HU.

Reusing the 8-bit render here would repeat the defect that withdrew the legacy
lung model — a model meeting a distribution it was never measured on — one
level down, and it would discard the physical units every downstream
measurement depends on. The two paths are deliberately separate, and
`inference/detection_preprocess.py` is where HU becomes model input.

── What this does not do ──────────────────────────────────────────────────

No resampling, no windowing, no normalisation, no interpolation. Those are
preprocessing decisions that belong to whatever model consumes the volume,
and baking them in here would make the volume mean different things to
different consumers. This produces the volume the acquisition describes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

import numpy as np

from geometry import SeriesFrame, validate_series_geometry
from series import POLARITY_FEET_TO_HEAD, OrderingResult

# Below this, two adjacent slices are at the same place and the stack has no
# through-plane extent to speak of. Matches series.DUPLICATE_POSITION_MM.
MIN_SLICE_SPACING_MM = 1e-3


class VolumeRefused(Exception):
    """A volume cannot be built from this series, with the reason why.

    An exception rather than a null return: a caller that forgets to check a
    return value gets a volume-shaped nothing, and this is precisely the place
    where that failure would be silent.
    """

    def __init__(self, code: str, message: str, detail: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, **self.detail}


@dataclass
class CtVolume:
    """A HU volume and the frame that places it in the patient.

    `array` is indexed [k, j, i] — slice, row, column — which is the numpy
    convention and the reverse of the (i, j, k) argument order the geometry
    helpers use. The two orders are written out at every boundary rather than
    left to memory.
    """

    array: np.ndarray
    frame: SeriesFrame
    polarity: str
    slice_spacing_mm: float
    spacing_is_uniform: bool
    series_uid: str = ""
    warnings: list[str] = field(default_factory=list)

    @property
    def shape(self) -> tuple[int, int, int]:
        """(slices, rows, columns)."""
        return self.array.shape  # type: ignore[return-value]

    @property
    def voxel_spacing_mm(self) -> tuple[float, float, float]:
        """(slice, row, column) spacing in millimetres.

        Anisotropic on every CT this pipeline has seen: roughly 0.7 mm in
        plane against 1.25-3.0 mm through plane. Any consumer that assumes
        isotropy is wrong by a factor of two to four on one axis.
        """
        return (self.slice_spacing_mm, self.frame.row_spacing_mm, self.frame.column_spacing_mm)

    def voxel_to_patient(self, i: float, j: float, k: int) -> tuple[float, float, float]:
        return self.frame.voxel_to_patient(i, j, k)

    def patient_to_voxel(self, point: Sequence[float]) -> tuple[float, float, int]:
        return self.frame.patient_to_voxel(point)


def _slice_hu(dataset: Any) -> np.ndarray:
    """One slice's pixels in Hounsfield units.

    The modality LUT — `stored * RescaleSlope + RescaleIntercept` — and
    nothing else. Its absence is a refusal rather than an assumed identity
    transform: without it the numbers are scanner-specific stored values, and
    treating them as HU would put air at 0 instead of -1000.
    """
    slope = getattr(dataset, "RescaleSlope", None)
    intercept = getattr(dataset, "RescaleIntercept", None)
    if slope is None or intercept is None:
        raise VolumeRefused(
            "missing_rescale",
            "A slice carries no RescaleSlope/RescaleIntercept, so its stored values cannot "
            "be converted to Hounsfield units. Without that the numbers are scanner-specific "
            "and not comparable with anything.",
        )
    pixels = dataset.pixel_array
    if pixels.ndim != 2:
        raise VolumeRefused(
            "multi_frame_slice",
            f"A slice holds a {pixels.ndim}-dimensional pixel array. Volume construction "
            "expects one frame per object.",
            {"ndim": int(pixels.ndim)},
        )
    return pixels.astype(np.float32) * float(slope) + float(intercept)


def build_volume(
    ordered: Sequence[Any],
    ordering: OrderingResult,
    datasets: Sequence[Any],
    *,
    require_polarity: bool = True,
    gate_passed: bool = True,
    spacing_tolerance_mm: float = 0.5,
) -> CtVolume:
    """The volume, or a refusal naming the check that failed.

    `ordered` are the InstanceMeta in anatomical order; `datasets` are the
    corresponding pydicom datasets in the *same* order. They are passed
    separately because this module does no file handling — the caller owns
    where bytes come from.

    `require_polarity` exists so a future non-axial consumer can opt out
    deliberately and in writing. It defaults to refusing, because a detector
    that reasons about superior and inferior cannot be handed a volume whose
    z direction is unknown.
    """
    if not ordered:
        raise VolumeRefused("empty_series", "There are no slices to build a volume from.")
    if len(ordered) != len(datasets):
        raise VolumeRefused(
            "slice_dataset_mismatch",
            f"{len(ordered)} ordered slices against {len(datasets)} datasets. The two must "
            "correspond one to one and in the same order.",
            {"ordered": len(ordered), "datasets": len(datasets)},
        )

    # ── the series has to be one this pipeline trusts ──────────────────────
    if not gate_passed:
        raise VolumeRefused(
            "quality_gate_failed",
            "The series did not pass the CT quality gate. A volume built from it would be "
            "outside the range the pipeline was measured on.",
        )
    if not ordering.trusted:
        raise VolumeRefused(
            "untrusted_ordering",
            "The slice ordering is not trustworthy: " + "; ".join(ordering.problems),
            {"problems": ordering.problems, "method": ordering.method},
        )
    if ordering.method != "image_position_patient":
        raise VolumeRefused(
            "ordering_not_geometric",
            f"The series was ordered by {ordering.method}, which is not derived from the "
            "acquisition geometry. Only ImagePositionPatient gives an ordering a volume can "
            "be built on.",
            {"method": ordering.method},
        )
    if require_polarity and ordering.polarity != POLARITY_FEET_TO_HEAD:
        raise VolumeRefused(
            "indeterminate_polarity",
            "The anatomical direction of the slice order could not be determined, so the "
            "volume would not know which end of its z axis is the patient's head. A volume "
            "built anyway would be a superior-inferior mirror in which every slice is "
            "individually valid.",
            {"polarity": ordering.polarity},
        )
    if ordering.normal is None:
        raise VolumeRefused(
            "no_slice_normal",
            "No slice normal was resolved, so the volume has no through-plane axis.",
        )

    # ── the geometry has to support a coordinate system ────────────────────
    problems = validate_series_geometry(ordered)
    if problems:
        raise VolumeRefused(
            "invalid_geometry",
            "The series geometry cannot carry a coordinate system: "
            + "; ".join(p.code for p in problems),
            {"problems": [p.as_dict() for p in problems]},
        )

    frame = SeriesFrame.from_instances(ordered, ordering.normal)

    # ── through-plane spacing ──────────────────────────────────────────────
    positions = [m.projected_position for m in ordered]
    if any(p is None for p in positions):
        raise VolumeRefused(
            "missing_projected_position",
            "A slice has no position along the slice normal, so its place in the stack is "
            "unknown.",
        )
    gaps = [b - a for a, b in zip(positions, positions[1:])]  # type: ignore[operator]
    warnings: list[str] = []
    spacing_is_uniform = True

    if gaps:
        if min(gaps) < MIN_SLICE_SPACING_MM:
            raise VolumeRefused(
                "duplicate_slice_position",
                "Two slices occupy the same position along the slice normal, so the stack "
                "has no single value at that depth.",
                {"smallestGapMm": round(float(min(gaps)), 6)},
            )
        slice_spacing = float(np.median(gaps))
        worst = max(abs(g - slice_spacing) for g in gaps)
        if worst > spacing_tolerance_mm:
            # Not a refusal here: the quality gate already decides whether a
            # gap is a missing slice. This records that a consumer assuming a
            # regular grid would be wrong, and by how much.
            spacing_is_uniform = False
            warnings.append(
                f"Slice spacing varies by up to {worst:.2f} mm from the median "
                f"{slice_spacing:.2f} mm. The volume is not a regular grid; anything "
                "resampling it must use the per-slice positions."
            )
    else:
        raise VolumeRefused(
            "single_slice_series",
            "A single slice has no through-plane extent and is not a volume.",
        )

    # ── the pixels ─────────────────────────────────────────────────────────
    rows, columns = ordered[0].rows, ordered[0].columns
    array = np.empty((len(ordered), rows, columns), dtype=np.float32)
    for index, dataset in enumerate(datasets):
        hu = _slice_hu(dataset)
        if hu.shape != (rows, columns):
            raise VolumeRefused(
                "inconsistent_matrix",
                f"Slice {index} is {hu.shape[0]}x{hu.shape[1]} against the series' "
                f"{rows}x{columns}. A volume cannot have slices of two sizes.",
                {"sliceIndex": index},
            )
        array[index] = hu

    return CtVolume(
        array=array,
        frame=frame,
        polarity=ordering.polarity,
        slice_spacing_mm=slice_spacing,
        spacing_is_uniform=spacing_is_uniform,
        series_uid=getattr(ordered[0], "series_instance_uid", "") or "",
        warnings=warnings + list(ordering.warnings),
    )
