"""
Whether an assembled CT series is one this pipeline should accept.

── What the gate is for ───────────────────────────────────────────────────

"Technically readable" and "suitable for the lung pipeline" are different
questions, and conflating them is how a system ends up scoring an abdominal CT
with a model trained on chests. This gate answers the second question, and it
answers it before anything is stored.

It **fails closed**. A check that cannot be evaluated because the metadata it
needs is absent is a failure, not a pass — with one deliberate exception,
stated below, where the metadata is advisory rather than load-bearing.

── Where the numbers come from ────────────────────────────────────────────

Measured on 2026-09-22 over 30 randomly sampled LIDC-IDRI series — the
collection the nodule characteriser was trained on — rather than chosen:

    slice count      109 - 351      median 133
    slice thickness  1.0 - 3.0 mm   median 2.5
    slice spacing    1.0 - 3.0 mm   uniform in 30 of 30 series
    pixel spacing    0.547 - 0.898 mm
    matrix           512 x 512 in 30 of 30
    body part        CHEST in 30 of 30
    orientation      axial, and IPP + IOP present, in 30 of 30

Every bar below sits outside that observed range, so no series resembling the
training data is refused by it. Each one states what it is protecting against;
a threshold without a reason is a number somebody will later move.

── The one advisory check ─────────────────────────────────────────────────

`BodyPartExamined` is absent from a great many real exports. Failing on its
absence would refuse legitimate chest CT, so an absent value is recorded as
`anatomyVerified: false` with a warning and the series is accepted. An absent
value is therefore visible in the result rather than silently treated as
correct — which is what "not silently accepting" requires. A value that is
*present and wrong* is a hard failure.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from series import InstanceMeta, OrderingResult

# --- Bars, with the observed range each one sits outside -------------------

# A chest CT covers roughly 25-35 cm. Forty slices at the 3 mm upper bound is
# 12 cm: too little to be a chest study, and too little for a nodule anywhere
# outside the sampled band to be present at all. Observed minimum: 109.
MIN_SLICES = 40

# Above 5 mm a 4 mm nodule can fall entirely inside one slice's partial volume
# and never appear as a distinct structure. Observed maximum: 3.0 mm.
MAX_SLICE_THICKNESS_MM = 5.0
# Below this a value is not a thickness, it is a units error.
MIN_SLICE_THICKNESS_MM = 0.4

# The crop the characteriser takes is 64 px at native scale. At 2 mm/px that
# is 128 mm of chest in a 64 px box — the model was trained at 0.55-0.90
# mm/px, so anything approaching 2 is a different physical field of view.
MIN_PIXEL_SPACING_MM = 0.2
MAX_PIXEL_SPACING_MM = 2.0

# A 128 x 128 chest CT — pydicom's bundled CT_small.dcm is one — cannot supply
# a 64 px crop at a scale resembling the training data. Observed: 512 x 512.
MIN_MATRIX = 256

# A gap this far from the series median is a missing slice or a change of
# protocol part-way through, not reconstruction jitter. Observed deviation
# across 30 series: under 0.01 mm.
def _spacing_tolerance(median: float) -> float:
    return max(0.5, abs(median) * 0.25)


SUITABLE_BODY_PARTS = ("CHEST", "THORAX", "LUNG")


@dataclass
class GateResult:
    """Structured enough to render, specific enough to act on."""

    passed: bool
    failures: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    measurements: dict = field(default_factory=dict)
    anatomy_verified: bool = False

    def as_dict(self) -> dict:
        return {
            "passed": self.passed,
            "failures": self.failures,
            "warnings": self.warnings,
            "measurements": self.measurements,
            "anatomyVerified": self.anatomy_verified,
        }


def _fail(failures: list[dict], code: str, message: str, **detail: Any) -> None:
    failures.append({"code": code, "message": message, **detail})


def evaluate_ct_series(instances: list[InstanceMeta], ordering: OrderingResult) -> GateResult:
    """Run every check. All of them, always — a caller fixing one problem
    should not have to resubmit to discover the next."""
    failures: list[dict] = []
    warnings: list[str] = []
    first = instances[0] if instances else None

    if not instances or first is None:
        _fail(failures, "empty_series", "The series contains no instances.")
        return GateResult(False, failures, warnings)

    # --- modality ----------------------------------------------------------
    modality = first.modality
    if modality != "CT":
        _fail(
            failures,
            "wrong_modality",
            f"This pipeline ingests CT. The series reports modality "
            f"{modality or 'none'}.",
            modality=modality,
        )

    # --- burned-in annotation ---------------------------------------------
    burned = [i.source_index for i in instances if i.burned_in_annotation == "YES"]
    if burned:
        _fail(
            failures,
            "burned_in_annotation",
            f"{len(burned)} object(s) declare burned-in annotation, which may render patient "
            "identifiers into the pixel data. No tag edit can remove those.",
            count=len(burned),
        )

    # --- multi-frame -------------------------------------------------------
    multiframe = [i.source_index for i in instances if i.frames > 1]
    if multiframe:
        _fail(
            failures,
            "multi_frame_object",
            f"{len(multiframe)} object(s) are multi-frame. Series ingestion expects one frame "
            "per object; an enhanced multi-frame CT needs its own handling and does not have "
            "it yet.",
            count=len(multiframe),
        )

    # --- slice count -------------------------------------------------------
    count = len(instances)
    if count < MIN_SLICES:
        _fail(
            failures,
            "too_few_slices",
            f"{count} slice(s): below the {MIN_SLICES} needed for a chest study. At the "
            "thickest accepted slice this covers under 12 cm.",
            sliceCount=count,
            minimum=MIN_SLICES,
        )

    # --- ordering ----------------------------------------------------------
    if not ordering.trusted:
        _fail(
            failures,
            "untrusted_ordering",
            "The slices cannot be placed in a trustworthy anatomical order: "
            + " ".join(ordering.problems),
            orderingMethod=ordering.method,
            problems=ordering.problems,
        )
    elif ordering.method != "image_position_patient":
        warnings.append(
            f"Ordered by {ordering.method} rather than ImagePositionPatient. "
            + " ".join(ordering.warnings)
        )

    # --- required geometry, per instance ----------------------------------
    missing_position = [i.source_index for i in instances if i.image_position is None]
    missing_orientation = [i.source_index for i in instances if i.image_orientation is None]
    if missing_position:
        _fail(
            failures,
            "missing_image_position",
            f"{len(missing_position)} slice(s) carry no ImagePositionPatient. Without it a "
            "slice has no location and no volume can be built.",
            count=len(missing_position),
        )
    if missing_orientation:
        _fail(
            failures,
            "missing_image_orientation",
            f"{len(missing_orientation)} slice(s) carry no ImageOrientationPatient. Without it "
            "the through-plane axis is unknown.",
            count=len(missing_orientation),
        )

    # --- rescale: the modality LUT that turns stored values into HU --------
    missing_rescale = [
        i.source_index
        for i in instances
        if i.rescale_slope is None or i.rescale_intercept is None
    ]
    if modality == "CT" and missing_rescale:
        _fail(
            failures,
            "missing_rescale",
            f"{len(missing_rescale)} slice(s) carry no RescaleSlope/RescaleIntercept. Without "
            "them stored values cannot be converted to Hounsfield units, and the lung window "
            "the model was trained at is defined in Hounsfield units.",
            count=len(missing_rescale),
        )

    # --- matrix ------------------------------------------------------------
    matrices = {(i.rows, i.columns) for i in instances}
    if len(matrices) > 1:
        _fail(
            failures,
            "inconsistent_matrix",
            f"Slices disagree about the image matrix ({sorted(matrices)}).",
            matrices=sorted(f"{r}x{c}" for r, c in matrices),
        )
    rows, columns = first.rows, first.columns
    if min(rows, columns) < MIN_MATRIX:
        _fail(
            failures,
            "matrix_too_small",
            f"{rows}x{columns} is below the {MIN_MATRIX}x{MIN_MATRIX} minimum. The 64-pixel "
            "crop this pipeline takes would cover a far larger physical area than the model "
            "was trained on.",
            rows=rows,
            columns=columns,
            minimum=MIN_MATRIX,
        )

    # --- pixel spacing -----------------------------------------------------
    spacings = {i.pixel_spacing for i in instances if i.pixel_spacing is not None}
    if len(spacings) != 1 or any(i.pixel_spacing is None for i in instances):
        if any(i.pixel_spacing is None for i in instances):
            _fail(
                failures,
                "missing_pixel_spacing",
                "Slice(s) carry no PixelSpacing, so the physical size of the crop this "
                "pipeline takes is unknown.",
            )
        else:
            _fail(
                failures,
                "inconsistent_pixel_spacing",
                f"Slices disagree about PixelSpacing ({sorted(spacings)}).",
            )
    else:
        pixel_spacing = next(iter(spacings))
        if not (MIN_PIXEL_SPACING_MM <= pixel_spacing[0] <= MAX_PIXEL_SPACING_MM):
            _fail(
                failures,
                "pixel_spacing_out_of_range",
                f"PixelSpacing {pixel_spacing[0]:.3f} mm is outside the "
                f"{MIN_PIXEL_SPACING_MM}-{MAX_PIXEL_SPACING_MM} mm this pipeline accepts.",
                pixelSpacingMm=pixel_spacing[0],
            )

    # --- slice thickness ---------------------------------------------------
    thicknesses = {i.slice_thickness for i in instances}
    if None in thicknesses:
        _fail(
            failures,
            "missing_slice_thickness",
            "Slice(s) carry no SliceThickness, so whether a nodule could be resolved at all "
            "cannot be established.",
        )
    else:
        worst = max(thicknesses)  # type: ignore[type-var]
        thinnest = min(thicknesses)  # type: ignore[type-var]
        if worst > MAX_SLICE_THICKNESS_MM:
            _fail(
                failures,
                "slice_too_thick",
                f"Slice thickness {worst:.2f} mm exceeds the {MAX_SLICE_THICKNESS_MM} mm "
                "maximum. A small nodule can be lost entirely to partial volume at this "
                "thickness.",
                sliceThicknessMm=worst,
                maximum=MAX_SLICE_THICKNESS_MM,
            )
        if thinnest < MIN_SLICE_THICKNESS_MM:
            _fail(
                failures,
                "slice_too_thin",
                f"Slice thickness {thinnest:.3f} mm is below {MIN_SLICE_THICKNESS_MM} mm, "
                "which is a units error rather than an acquisition.",
                sliceThicknessMm=thinnest,
            )
        if len(thicknesses) > 1:
            _fail(
                failures,
                "inconsistent_slice_thickness",
                f"Slices disagree about SliceThickness ({sorted(thicknesses)}).",  # type: ignore[type-var]
            )

    # --- inter-slice spacing ----------------------------------------------
    if ordering.median_spacing is not None and ordering.spacings:
        median = ordering.median_spacing
        tolerance = _spacing_tolerance(median)
        outliers = [s for s in ordering.spacings if abs(abs(s) - abs(median)) > tolerance]
        if outliers:
            _fail(
                failures,
                "irregular_slice_spacing",
                f"{len(outliers)} gap(s) between consecutive slices differ from the series "
                f"median of {abs(median):.2f} mm by more than {tolerance:.2f} mm, which means "
                "missing slices or a protocol change part-way through.",
                medianSpacingMm=round(abs(median), 3),
                toleranceMm=round(tolerance, 3),
                outlierCount=len(outliers),
                worstGapMm=round(max(abs(s) for s in outliers), 3),
            )
    elif len(instances) >= 2 and ordering.trusted:
        _fail(
            failures,
            "no_spacing",
            "No inter-slice spacing could be computed, so the series geometry is unknown.",
        )

    # --- anatomy: advisory, see the module docstring -----------------------
    body_parts = {i.body_part for i in instances if i.body_part}
    anatomy_verified = False
    if not body_parts:
        warnings.append(
            "No slice states BodyPartExamined, so the anatomy could not be verified. The "
            "series was accepted on its other properties; a clinician reviewing it should "
            "confirm it is a chest study."
        )
    else:
        suitable = {b for b in body_parts if any(part in b for part in SUITABLE_BODY_PARTS)}
        if suitable and len(body_parts) == len(suitable):
            anatomy_verified = True
        else:
            _fail(
                failures,
                "unsupported_anatomy",
                f"BodyPartExamined is {', '.join(sorted(body_parts))}. This pipeline is for "
                f"chest CT ({', '.join(SUITABLE_BODY_PARTS)}).",
                bodyPart=sorted(body_parts),
            )

    measurements = {
        "sliceCount": count,
        "modality": modality,
        "matrix": f"{rows}x{columns}",
        "pixelSpacingMm": first.pixel_spacing[0] if first.pixel_spacing else None,
        "sliceThicknessMm": first.slice_thickness,
        "medianSpacingMm": round(abs(ordering.median_spacing), 3) if ordering.median_spacing else None,
        "orderingMethod": ordering.method,
        "orderingTrusted": ordering.trusted,
        "bodyPart": sorted(body_parts) or None,
        "manufacturer": first.manufacturer,
        "manufacturerModel": first.manufacturer_model,
        "convolutionKernel": first.convolution_kernel,
        "coverageMm": (
            round(abs(ordering.median_spacing) * (count - 1), 1)
            if ordering.median_spacing and count > 1
            else None
        ),
    }

    return GateResult(
        passed=not failures,
        failures=failures,
        warnings=warnings,
        measurements=measurements,
        anatomy_verified=anatomy_verified,
    )
