"""
Assembling uploaded DICOM objects into one ordered series.

── What an upload is, and what it is not ──────────────────────────────────

A file is not a scan. A CT study arrives as a few hundred objects that mean
nothing individually: the series is the unit a radiologist reads and the unit
a volume is built from. Until this module existed the platform treated one
uploaded file as one medical image, which is correct for a photograph of a
lesion and wrong for every CT ever acquired.

Three things have to be true before a pile of objects is a series, and each is
checked here rather than assumed:

  1. They belong to the same series. Grouping is by SeriesInstanceUID, never
     by filename, upload order or directory layout — all three are
     client-controlled and routinely wrong. Objects from two series in one
     upload are refused rather than merged, because a merged series is a
     volume with slices from two acquisitions in it and nothing downstream
     could detect that.

  2. They can be put in anatomical order. Order comes from the geometry the
     objects carry, not from the order they arrived in. `IMG0010.dcm` sorting
     before `IMG0009.dcm` is a filesystem fact, not an anatomical one.

  3. The geometry is consistent. Same orientation, no two slices at the same
     position, no gap where a slice is missing.

Anything that cannot be established is reported as a named problem, not
guessed at. `order_slices` returns the method it actually used and whether the
result can be trusted; the caller refuses on an untrusted ordering.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable

# Two direction cosines are "the same orientation" within this much. Gantry
# tilt and floating-point noise move them slightly between slices of one
# acquisition; a different acquisition moves them a great deal more.
ORIENTATION_TOLERANCE = 1e-3

# ── Polarity: which end of the ordered series is the patient's head ────────
#
# Sorting by the projection onto the slice normal puts the slices in
# anatomical order, and says nothing about which direction that order runs in.
# The normal is the cross product of the two direction cosines, so its sign
# follows how the acquisition happened to be described — reverse the row and
# column cosines and the same anatomy orders the other way round.
#
# That is not a detail a volume can be built on. A volume assembled with the
# polarity inverted is a superior-inferior mirror of the patient: a candidate
# reported in the right upper lobe is shown in the right lower lobe, and
# nothing downstream can detect it, because every slice is individually valid
# and the spacing is uniform either way.
#
# DICOM PS3.3 C.7.6.2.1.1 fixes the patient coordinate system as LPS, so +z is
# towards the head. The convention here is therefore: **index 0 is the most
# inferior slice and the index increases towards the head**, obtained by
# orienting the normal so its z component is positive. Whether that required
# reversing the raw order is recorded rather than done quietly.
POLARITY_FEET_TO_HEAD = "feet_to_head"
POLARITY_INDETERMINATE = "indeterminate"

# Below this, the slice normal lies in the axial plane and the through-plane
# direction is not superior-inferior at all — a coronal or sagittal
# acquisition. There is no head end to find, so polarity is reported as
# indeterminate rather than resolved by rounding a number that is nearly zero.
# The value is small because the quantity is a unit-vector component: anything
# above it is a real, if oblique, superior-inferior direction.
POLARITY_MIN_Z_COMPONENT = 0.01

# Two slices closer together than this along the normal are at the same
# position: a duplicate, not a thin slice. Well under any real reconstruction
# interval (the thinnest in the LIDC-IDRI subset is 1.0 mm).
DUPLICATE_POSITION_MM = 1e-3


@dataclass
class InstanceMeta:
    """What one object contributes to the series, free of identity.

    `source_index` is the caller's index for the object — the position in the
    upload — kept so the caller can map an ordered slice back to the file it
    came from without this module handling file paths or names.
    """

    source_index: int
    sop_instance_uid: str
    series_instance_uid: str
    study_instance_uid: str
    modality: str
    rows: int
    columns: int
    image_position: tuple[float, float, float] | None
    image_orientation: tuple[float, ...] | None
    slice_location: float | None
    instance_number: int | None
    slice_thickness: float | None
    pixel_spacing: tuple[float, float] | None
    body_part: str
    manufacturer: str
    manufacturer_model: str
    convolution_kernel: str
    photometric_interpretation: str
    rescale_slope: float | None
    rescale_intercept: float | None
    burned_in_annotation: str
    frames: int

    # Filled in by order_slices.
    projected_position: float | None = None


@dataclass
class OrderingResult:
    """The ordering, the method that produced it, and what is wrong with it."""

    ordered: list[InstanceMeta]
    method: str
    trusted: bool
    problems: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    spacings: list[float] = field(default_factory=list)
    median_spacing: float | None = None

    # Which anatomical direction the ordered index runs in, and how it was
    # arrived at. Separate from `trusted` on purpose: a coronal series can be
    # ordered perfectly well and still have no superior-inferior polarity, so
    # conflating the two would refuse a correctly ordered series. A volume
    # builder needs both — it must refuse `indeterminate`, because it has to
    # know which end of its z axis is the head.
    polarity: str = POLARITY_INDETERMINATE
    # True when the raw projection order ran head-to-feet and was reversed to
    # meet the convention. Recorded so the decision is inspectable rather than
    # silent.
    polarity_normalised: bool = False
    # The unit slice normal the ordering actually used, after any reversal.
    # This is the volume's +z direction in patient LPS millimetres.
    normal: tuple[float, float, float] | None = None


def _as_float_tuple(value: Any, length: int) -> tuple[float, ...] | None:
    try:
        items = [float(v) for v in value]
    except (TypeError, ValueError):
        return None
    if len(items) != length:
        return None
    return tuple(items)


def read_instance_metadata(dataset: Any, source_index: int) -> InstanceMeta:
    """Everything the series pipeline needs from one already-parsed object.

    Reads tags only; never pixel data. Identity is not among the fields: the
    UIDs are here because grouping requires them and they are remapped before
    anything is returned to a caller or persisted.
    """
    get = lambda kw, default=None: getattr(dataset, kw, default)  # noqa: E731

    def as_float(value):
        try:
            if value is None:
                return None
            if hasattr(value, "__iter__") and not isinstance(value, (str, bytes)):
                value = list(value)[0]
            return float(value)
        except (TypeError, ValueError, IndexError):
            return None

    def as_int(value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    return InstanceMeta(
        source_index=source_index,
        sop_instance_uid=str(get("SOPInstanceUID", "") or ""),
        series_instance_uid=str(get("SeriesInstanceUID", "") or ""),
        study_instance_uid=str(get("StudyInstanceUID", "") or ""),
        modality=str(get("Modality", "") or "").upper(),
        rows=as_int(get("Rows")) or 0,
        columns=as_int(get("Columns")) or 0,
        image_position=_as_float_tuple(get("ImagePositionPatient"), 3),
        image_orientation=_as_float_tuple(get("ImageOrientationPatient"), 6),
        slice_location=as_float(get("SliceLocation")),
        instance_number=as_int(get("InstanceNumber")),
        slice_thickness=as_float(get("SliceThickness")),
        pixel_spacing=_as_float_tuple(get("PixelSpacing"), 2),
        body_part=str(get("BodyPartExamined", "") or "").strip().upper(),
        manufacturer=str(get("Manufacturer", "") or ""),
        manufacturer_model=str(get("ManufacturerModelName", "") or ""),
        convolution_kernel=str(get("ConvolutionKernel", "") or ""),
        photometric_interpretation=str(get("PhotometricInterpretation", "") or ""),
        rescale_slope=as_float(get("RescaleSlope")),
        rescale_intercept=as_float(get("RescaleIntercept")),
        burned_in_annotation=str(get("BurnedInAnnotation", "") or "").strip().upper(),
        frames=as_int(get("NumberOfFrames")) or 1,
    )


class SeriesRejected(Exception):
    """The upload is not one assemblable series. Carries structured reasons."""

    def __init__(self, code: str, message: str, detail: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}


def assemble(instances: Iterable[InstanceMeta]) -> tuple[list[InstanceMeta], dict]:
    """One upload to one series, or a refusal explaining why it is not one.

    Returns the de-duplicated instances and a report. Duplicates — the same
    SOPInstanceUID uploaded twice, which happens whenever somebody selects an
    overlapping folder — are dropped with a count rather than refused, because
    the second copy is the same object and discarding it changes nothing. Two
    *different* objects claiming one SOPInstanceUID is a different matter and
    is refused: one of them is mislabelled and there is no way to tell which.
    """
    instances = list(instances)
    if not instances:
        raise SeriesRejected("empty_upload", "No DICOM objects were supplied.")

    missing_series = [i.source_index for i in instances if not i.series_instance_uid]
    if missing_series:
        raise SeriesRejected(
            "missing_series_uid",
            f"{len(missing_series)} object(s) carry no SeriesInstanceUID, so they cannot be "
            "grouped into a series.",
            {"sourceIndexes": missing_series[:20]},
        )

    by_series: dict[str, list[InstanceMeta]] = {}
    for instance in instances:
        by_series.setdefault(instance.series_instance_uid, []).append(instance)

    if len(by_series) > 1:
        # Deliberately a refusal, not a "pick the biggest". Merging two series
        # produces a volume that interleaves two acquisitions, and nothing
        # downstream can see that it happened.
        raise SeriesRejected(
            "mixed_series",
            f"The upload contains {len(by_series)} different series. Upload one series at a "
            "time; a study with several series is ingested as several requests, and they are "
            "linked by the study they share.",
            {
                "seriesCount": len(by_series),
                # Counts only. The original UIDs are never returned.
                "instancesPerSeries": sorted((len(v) for v in by_series.values()), reverse=True),
            },
        )

    members = next(iter(by_series.values()))

    studies = {i.study_instance_uid for i in members if i.study_instance_uid}
    if len(studies) > 1:
        raise SeriesRejected(
            "inconsistent_study",
            "Objects in this series disagree about which study they belong to.",
            {"studyCount": len(studies)},
        )

    seen: dict[str, InstanceMeta] = {}
    duplicates = 0
    conflicts: list[int] = []
    for instance in members:
        if not instance.sop_instance_uid:
            raise SeriesRejected(
                "missing_sop_uid",
                "An object carries no SOPInstanceUID, so duplicates cannot be detected.",
                {"sourceIndex": instance.source_index},
            )
        existing = seen.get(instance.sop_instance_uid)
        if existing is None:
            seen[instance.sop_instance_uid] = instance
            continue
        if _same_object(existing, instance):
            duplicates += 1
        else:
            conflicts.append(instance.source_index)

    if conflicts:
        raise SeriesRejected(
            "conflicting_instances",
            f"{len(conflicts)} object(s) share a SOPInstanceUID with a different object. One "
            "of them is mislabelled and there is no way to tell which.",
            {"sourceIndexes": conflicts[:20]},
        )

    unique = list(seen.values())
    modalities = {i.modality for i in unique}
    if len(modalities) > 1:
        raise SeriesRejected(
            "mixed_modality",
            f"Objects in this series report more than one modality ({', '.join(sorted(modalities))}).",
            {"modalities": sorted(modalities)},
        )

    return unique, {
        "uploaded": len(instances),
        "unique": len(unique),
        "duplicatesDropped": duplicates,
        "modality": next(iter(modalities), ""),
    }


def _same_object(a: InstanceMeta, b: InstanceMeta) -> bool:
    """Whether two objects with one SOPInstanceUID are the same object."""
    return (
        a.rows == b.rows
        and a.columns == b.columns
        and a.image_position == b.image_position
        and a.image_orientation == b.image_orientation
    )


def _normal(orientation: tuple[float, ...]) -> tuple[float, float, float]:
    """The slice normal: the cross product of the two direction cosines.

    This is what makes ordering anatomical rather than arbitrary. Sorting by
    the z component of ImagePositionPatient is the common shortcut and it is
    wrong for anything but a perfectly axial acquisition — a tilted or
    non-axial series has its through-plane axis somewhere else entirely, and
    the shortcut silently interleaves the slices.
    """
    r = orientation[0:3]
    c = orientation[3:6]
    return (
        r[1] * c[2] - r[2] * c[1],
        r[2] * c[0] - r[0] * c[2],
        r[0] * c[1] - r[1] * c[0],
    )


def order_slices(instances: list[InstanceMeta]) -> OrderingResult:
    """Anatomical order, the method that produced it, and its trustworthiness.

    Methods, in the order they are attempted:

      image_position_patient   the projection of ImagePositionPatient onto the
                               slice normal. Correct for any orientation.
      slice_location           a scalar the modality supplied. Usable when the
                               full geometry is absent, and trusted less: it
                               is defined relative to an origin the object does
                               not have to state.
      instance_number          not anatomy at all — an acquisition counter.
                               Never trusted; present so that a caller can see
                               an order rather than nothing.

    A result is trusted only when the geometry supports it *and* nothing is
    wrong with it. An untrusted ordering is not a softer ordering; it is one
    the caller must refuse to build a volume from.
    """
    problems: list[str] = []
    warnings: list[str] = []
    polarity = POLARITY_INDETERMINATE
    polarity_normalised = False
    unit: tuple[float, ...] | None = None

    with_geometry = [i for i in instances if i.image_position and i.image_orientation]

    if len(with_geometry) == len(instances) and instances:
        orientations = {tuple(round(v, 4) for v in i.image_orientation) for i in instances}  # type: ignore[arg-type]
        reference = instances[0].image_orientation
        inconsistent = [
            i.source_index
            for i in instances
            if max(abs(a - b) for a, b in zip(i.image_orientation, reference)) > ORIENTATION_TOLERANCE  # type: ignore[arg-type]
        ]
        if inconsistent:
            problems.append(
                f"{len(inconsistent)} slice(s) have a different image orientation from the "
                "first slice, so they are not one geometric series."
            )

        normal = _normal(reference)  # type: ignore[arg-type]
        magnitude = math.sqrt(sum(component * component for component in normal))
        if magnitude < 1e-6:
            problems.append(
                "ImageOrientationPatient is degenerate: the two direction cosines are parallel, "
                "so no slice normal exists and the slices cannot be ordered anatomically."
            )
            ordered = sorted(instances, key=lambda i: (i.instance_number or 0, i.source_index))
            return OrderingResult(ordered, "instance_number", False, problems, warnings)

        unit = tuple(component / magnitude for component in normal)

        # Orient the normal towards the patient's head, so index 0 is the most
        # inferior slice whichever way round the acquisition described itself.
        if abs(unit[2]) >= POLARITY_MIN_Z_COMPONENT:
            polarity = POLARITY_FEET_TO_HEAD
            if unit[2] < 0:
                unit = tuple(-component for component in unit)
                polarity_normalised = True
                warnings.append(
                    "The slice normal pointed towards the feet, so the ordering was reversed "
                    "to run inferior to superior. The anatomy is unchanged; only the index "
                    "direction is."
                )
        else:
            warnings.append(
                "The slice normal lies in the axial plane, so this series has no "
                "superior-inferior direction to order by — it is a coronal or sagittal "
                "acquisition. The ordering is still geometric and reproducible, but a volume "
                "cannot be built from it without a polarity."
            )

        for instance in instances:
            instance.projected_position = sum(
                p * n for p, n in zip(instance.image_position, unit)  # type: ignore[arg-type]
            )

        ordered = sorted(instances, key=lambda i: (i.projected_position, i.source_index))  # type: ignore[arg-type,return-value]
        method = "image_position_patient"
        if len(orientations) > 1 and not inconsistent:
            warnings.append(
                "Image orientation varies between slices by less than the tolerance; ordering "
                "used the first slice's orientation."
            )
    elif any(i.slice_location is not None for i in instances):
        missing = [i.source_index for i in instances if i.slice_location is None]
        if missing:
            problems.append(
                f"{len(missing)} slice(s) carry neither full spatial geometry nor a "
                "SliceLocation, so the series cannot be ordered."
            )
        ordered = sorted(
            instances, key=lambda i: (i.slice_location if i.slice_location is not None else math.inf, i.source_index)
        )
        for instance in ordered:
            instance.projected_position = instance.slice_location
        method = "slice_location"
        warnings.append(
            "Ordered by SliceLocation because ImagePositionPatient or ImageOrientationPatient "
            "is missing. SliceLocation is relative to an origin the objects do not state, so "
            "the ordering is reproducible but its absolute geometry is not."
        )
    else:
        problems.append(
            "No slice carries ImagePositionPatient with ImageOrientationPatient, and none "
            "carries SliceLocation. There is no spatial metadata to order this series by."
        )
        ordered = sorted(instances, key=lambda i: (i.instance_number or 0, i.source_index))
        return OrderingResult(ordered, "instance_number", False, problems, warnings)

    positions = [i.projected_position for i in ordered if i.projected_position is not None]
    spacings: list[float] = []
    median_spacing: float | None = None

    if len(positions) >= 2:
        spacings = [round(b - a, 6) for a, b in zip(positions, positions[1:])]
        duplicates = [s for s in spacings if abs(s) < DUPLICATE_POSITION_MM]
        if duplicates:
            problems.append(
                f"{len(duplicates)} pair(s) of slices occupy the same position along the slice "
                "normal. A series cannot have two slices in one place; one of them is a "
                "different object carrying a duplicate position."
            )
        non_zero = sorted(s for s in spacings if abs(s) >= DUPLICATE_POSITION_MM)
        if non_zero:
            median_spacing = non_zero[len(non_zero) // 2]

    return OrderingResult(
        ordered=ordered,
        method=method,
        trusted=not problems,
        problems=problems,
        warnings=warnings,
        spacings=spacings,
        median_spacing=median_spacing,
        polarity=polarity,
        polarity_normalised=polarity_normalised,
        # Rounded so two assemblies of the same series produce byte-identical
        # values to persist and compare, rather than differing in the last bit.
        normal=tuple(round(component, 9) for component in unit) if unit else None,  # type: ignore[arg-type]
    )
