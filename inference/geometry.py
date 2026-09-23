"""
The geometry that turns a stack of slices into a coordinate system.

── Why this exists ────────────────────────────────────────────────────────

A detection candidate is a point. A point is meaningless without the frame it
is expressed in, and there are three frames in play that are easy to confuse:

    voxel        (column i, row j, slice k) — indices into the built volume
    patient LPS  (x, y, z) millimetres — DICOM PS3.3 C.7.6.2.1.1, +x left,
                 +y posterior, +z superior
    pixel        (cx, cy) within one rendered slice — what the nodule
                 characteriser already takes

Conflating them is not a subtle bug. A candidate stored in voxel indices and
read back as millimetres lands somewhere else in the patient entirely, and
every individual number involved looks plausible.

── What this module does and does not assume ──────────────────────────────

The conversion uses the *per-slice* ImagePositionPatient rather than
extrapolating slice 0 by a uniform spacing. Real series are not perfectly
uniform, the quality gate already tolerates a little jitter, and extrapolating
turns that tolerance into a positional error that grows with k. The origins
are persisted per instance for exactly this reason.

Nothing here builds a volume, resamples, or reads pixels. It is the frame, not
the image.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Sequence

# Two direction cosines that are not perpendicular do not describe a plane a
# coordinate system can be built on. Real acquisitions carry rounding in the
# sixth decimal, so this is a tolerance on |row . column| rather than equality
# with zero; 1e-4 is far tighter than any real deviation and far looser than
# float noise.
ORTHOGONALITY_TOLERANCE = 1e-4

# A direction cosine vector is by definition a unit vector. A magnitude further
# than this from 1.0 means the tag is not what it claims to be, rather than
# that it was rounded.
UNIT_TOLERANCE = 1e-3


def cross(a: Sequence[float], b: Sequence[float]) -> tuple[float, float, float]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def magnitude(a: Sequence[float]) -> float:
    return math.sqrt(dot(a, a))


def normalise(a: Sequence[float]) -> tuple[float, float, float]:
    """A unit vector in the same direction.

    Deterministic: the same input always gives the same output, with no
    rounding applied here — callers that need a storable value round once, at
    the point of storage, so that a value read back compares equal.
    """
    m = magnitude(a)
    if m <= 0:
        raise ValueError("Cannot normalise a zero-length vector")
    return (a[0] / m, a[1] / m, a[2] / m)


@dataclass
class GeometryProblem:
    """One reason a series cannot carry a coordinate system."""

    code: str
    message: str
    detail: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, **self.detail}


def validate_orientation(iop: Sequence[float] | None) -> list[GeometryProblem]:
    """Whether an ImageOrientationPatient can define a plane.

    Checks the three things that have to hold, and says which one failed
    rather than returning a bare False: the tag has six usable numbers, each
    direction cosine is a unit vector, and the two are perpendicular.
    """
    problems: list[GeometryProblem] = []

    if iop is None:
        problems.append(
            GeometryProblem(
                "missing_image_orientation",
                "ImageOrientationPatient is absent, so the slice plane is unknown and no "
                "coordinate system can be built.",
            )
        )
        return problems

    if len(iop) != 6:
        problems.append(
            GeometryProblem(
                "malformed_image_orientation",
                f"ImageOrientationPatient has {len(iop)} values; the standard defines six "
                "(two direction cosines).",
                {"valueCount": len(iop)},
            )
        )
        return problems

    if any(not math.isfinite(v) for v in iop):
        problems.append(
            GeometryProblem(
                "malformed_image_orientation",
                "ImageOrientationPatient contains a value that is not a finite number.",
            )
        )
        return problems

    row, column = tuple(iop[0:3]), tuple(iop[3:6])

    for name, vector in (("row", row), ("column", column)):
        m = magnitude(vector)
        if m <= 0:
            problems.append(
                GeometryProblem(
                    "degenerate_image_orientation",
                    f"The {name} direction cosine has zero length, so it points nowhere.",
                    {"axis": name},
                )
            )
        elif abs(m - 1.0) > UNIT_TOLERANCE:
            problems.append(
                GeometryProblem(
                    "non_unit_image_orientation",
                    f"The {name} direction cosine has length {m:.6f}. Direction cosines are "
                    "unit vectors by definition; a value this far from 1 means the tag does "
                    "not hold what it claims to.",
                    {"axis": name, "magnitude": round(m, 6)},
                )
            )

    if not problems:
        error = abs(dot(normalise(row), normalise(column)))
        if error > ORTHOGONALITY_TOLERANCE:
            problems.append(
                GeometryProblem(
                    "non_orthogonal_image_orientation",
                    f"The two direction cosines are not perpendicular (|row . column| = "
                    f"{error:.6f}). They cannot describe an image plane, so pixel indices "
                    "would not map to distinct positions.",
                    {"orthogonalityError": round(error, 9)},
                )
            )

    return problems


def validate_pixel_spacing(spacing: Sequence[float] | None) -> list[GeometryProblem]:
    """Both spacings, both positive. Row and column spacing differ on plenty of
    real acquisitions, so a single scalar is not enough to place a pixel."""
    if spacing is None:
        return [
            GeometryProblem(
                "missing_pixel_spacing",
                "PixelSpacing is absent, so a pixel index cannot be converted to "
                "millimetres.",
            )
        ]
    if len(spacing) != 2:
        return [
            GeometryProblem(
                "malformed_pixel_spacing",
                f"PixelSpacing has {len(spacing)} values; the standard defines two, "
                "row spacing then column spacing.",
                {"valueCount": len(spacing)},
            )
        ]
    if any(not math.isfinite(v) or v <= 0 for v in spacing):
        return [
            GeometryProblem(
                "malformed_pixel_spacing",
                f"PixelSpacing is {list(spacing)}. Both values must be finite and positive.",
                {"pixelSpacing": [float(v) for v in spacing]},
            )
        ]
    return []


def validate_position(position: Sequence[float] | None) -> list[GeometryProblem]:
    if position is None:
        return [
            GeometryProblem(
                "missing_image_position",
                "ImagePositionPatient is absent, so this slice has no location in the "
                "patient.",
            )
        ]
    if len(position) != 3:
        return [
            GeometryProblem(
                "malformed_image_position",
                f"ImagePositionPatient has {len(position)} values; the standard defines "
                "three.",
                {"valueCount": len(position)},
            )
        ]
    if any(not math.isfinite(v) for v in position):
        return [
            GeometryProblem(
                "malformed_image_position",
                "ImagePositionPatient contains a value that is not a finite number.",
            )
        ]
    return []


def validate_series_geometry(instances: Sequence[Any]) -> list[GeometryProblem]:
    """Every check the whole series has to pass to carry a coordinate system.

    Takes InstanceMeta-shaped objects. Deliberately does not look at patient
    identity: this module maps points, and which patient a series belongs to
    is enforced where the series is stored, not here.
    """
    problems: list[GeometryProblem] = []
    if not instances:
        return [
            GeometryProblem("empty_series", "There are no instances to derive geometry from.")
        ]

    first = instances[0]
    problems.extend(validate_orientation(first.image_orientation))
    problems.extend(validate_pixel_spacing(first.pixel_spacing))

    missing_positions = [
        i.source_index for i in instances if validate_position(i.image_position)
    ]
    if missing_positions:
        problems.append(
            GeometryProblem(
                "incomplete_image_positions",
                f"{len(missing_positions)} slice(s) carry no usable ImagePositionPatient, so "
                "the series cannot be placed in the patient.",
                {"count": len(missing_positions)},
            )
        )

    # One series, one plane. Mixed orientations are already a problem the
    # ordering reports; repeated here because a coordinate system built on the
    # first slice's plane would be wrong for the others.
    if first.image_orientation is not None:
        differing = [
            i.source_index
            for i in instances
            if i.image_orientation is not None
            and max(abs(a - b) for a, b in zip(i.image_orientation, first.image_orientation))
            > 1e-3
        ]
        if differing:
            problems.append(
                GeometryProblem(
                    "mixed_orientation",
                    f"{len(differing)} slice(s) describe a different image plane from the "
                    "first. One coordinate system cannot describe two planes.",
                    {"count": len(differing)},
                )
            )

    return problems


@dataclass
class SeriesFrame:
    """The coordinate system of one ordered series.

    `origins` are the per-slice ImagePositionPatient values, in the ordered
    slice order, so `origins[k]` is the patient-space position of voxel
    (0, 0, k). `normal` is the volume's +z, already oriented by the polarity
    convention in inference/series.py.
    """

    origins: list[tuple[float, float, float]]
    row_cosine: tuple[float, float, float]
    column_cosine: tuple[float, float, float]
    normal: tuple[float, float, float]
    row_spacing_mm: float
    column_spacing_mm: float

    @property
    def slice_count(self) -> int:
        return len(self.origins)

    @classmethod
    def from_instances(cls, ordered: Sequence[Any], normal: Sequence[float]) -> "SeriesFrame":
        """Builds the frame from ordered InstanceMeta objects.

        Raises rather than guessing: a caller that has not run
        validate_series_geometry first should fail loudly here.
        """
        problems = validate_series_geometry(ordered)
        if problems:
            raise ValueError(
                "Cannot build a coordinate frame: " + "; ".join(p.code for p in problems)
            )

        first = ordered[0]
        iop = first.image_orientation
        # PixelSpacing is (between rows, between columns) — the first value is
        # the vertical step, which belongs to the *column* cosine. Getting this
        # pair the wrong way round is silent on a square pixel and wrong on
        # every anisotropic one.
        row_spacing, column_spacing = float(first.pixel_spacing[0]), float(first.pixel_spacing[1])
        return cls(
            origins=[tuple(float(v) for v in i.image_position) for i in ordered],  # type: ignore[misc]
            row_cosine=normalise(iop[0:3]),
            column_cosine=normalise(iop[3:6]),
            normal=normalise(normal),
            row_spacing_mm=row_spacing,
            column_spacing_mm=column_spacing,
        )

    def voxel_to_patient(self, i: float, j: float, k: int) -> tuple[float, float, float]:
        """Voxel (column i, row j, slice k) to patient LPS millimetres.

        PS3.3 C.7.6.2.1.1:

            P = S + i * column_spacing * row_cosine
                  + j * row_spacing    * column_cosine

        with S the slice's own ImagePositionPatient. `i` indexes columns and
        moves along the row cosine; `j` indexes rows and moves along the column
        cosine. The naming in the standard is a well-known trap and the reason
        this is written out rather than inlined at call sites.
        """
        if not 0 <= k < self.slice_count:
            raise IndexError(f"Slice {k} is outside the series (0..{self.slice_count - 1})")
        origin = self.origins[k]
        return tuple(  # type: ignore[return-value]
            origin[axis]
            + i * self.column_spacing_mm * self.row_cosine[axis]
            + j * self.row_spacing_mm * self.column_cosine[axis]
            for axis in range(3)
        )

    def nearest_slice(self, point: Sequence[float]) -> int:
        """The ordered slice index whose plane the point lies closest to.

        Chosen by projection onto the normal against the actual slice origins,
        not by dividing by a nominal spacing, so an irregular series still
        resolves to the slice a reader would open.
        """
        projections = [dot(origin, self.normal) for origin in self.origins]
        target = dot(point, self.normal)
        best, best_distance = 0, abs(target - projections[0])
        for index, projection in enumerate(projections[1:], start=1):
            distance = abs(target - projection)
            if distance < best_distance:
                best, best_distance = index, distance
        return best

    def patient_to_voxel(self, point: Sequence[float]) -> tuple[float, float, int]:
        """Patient LPS millimetres to voxel (column i, row j, slice k).

        The inverse of voxel_to_patient, exact because the two cosines and the
        normal are orthonormal. `i` and `j` are returned unrounded: rounding
        here would throw away sub-pixel position that a caller may legitimately
        want, and a caller that needs an index can round once, knowingly.
        """
        k = self.nearest_slice(point)
        origin = self.origins[k]
        offset = tuple(point[axis] - origin[axis] for axis in range(3))
        i = dot(offset, self.row_cosine) / self.column_spacing_mm
        j = dot(offset, self.column_cosine) / self.row_spacing_mm
        return i, j, k
