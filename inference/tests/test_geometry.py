"""
inference/geometry.py: voxel indices to patient millimetres and back.

Three coordinate frames meet in a detection pipeline — voxel indices, patient
LPS millimetres, and pixel coordinates within one rendered slice — and every
number in all three is a small plausible-looking float. A candidate stored in
one frame and read back as another lands somewhere else in the patient with
nothing to indicate it.

The round trip is the assertion that matters. Everything else here is about
refusing to build a frame from geometry that cannot support one.
"""
from __future__ import annotations

import math

import pytest

from conftest import make_ct_series

from geometry import (
    ORTHOGONALITY_TOLERANCE,
    SeriesFrame,
    normalise,
    validate_orientation,
    validate_pixel_spacing,
    validate_position,
    validate_series_geometry,
)
from series import order_slices, read_instance_metadata

# Sub-micron. The conversion is exact arithmetic on orthonormal vectors, so
# the only error is float rounding; anything larger is a real defect, and a
# looser tolerance would hide one.
TOLERANCE_MM = 1e-9
TOLERANCE_VOXEL = 1e-9


def metas(datasets):
    return [read_instance_metadata(ds, index) for index, ds in enumerate(datasets)]


def frame_for(datasets):
    result = order_slices(metas(datasets))
    return SeriesFrame.from_instances(result.ordered, result.normal), result


def codes(problems):
    return {p.code for p in problems}


# ── 1. valid geometry ──────────────────────────────────────────────────────

def test_a_standard_series_produces_a_frame():
    frame, result = frame_for(make_ct_series(count=20, spacing=2.5))

    assert frame.slice_count == 20
    assert frame.row_cosine == pytest.approx((1.0, 0.0, 0.0))
    assert frame.column_cosine == pytest.approx((0.0, 1.0, 0.0))
    assert frame.normal == pytest.approx((0.0, 0.0, 1.0))
    assert frame.row_spacing_mm == pytest.approx(0.7)
    assert frame.column_spacing_mm == pytest.approx(0.7)
    assert validate_series_geometry(result.ordered) == []


# ── 2-7. what a frame refuses to be built from ─────────────────────────────

def test_missing_image_orientation_is_reported():
    assert "missing_image_orientation" in codes(validate_orientation(None))


def test_malformed_image_orientation_is_reported():
    assert "malformed_image_orientation" in codes(validate_orientation((1, 0, 0)))
    assert "malformed_image_orientation" in codes(
        validate_orientation((1, 0, 0, 0, 1, float("nan")))
    )


def test_a_non_unit_direction_cosine_is_reported():
    problems = validate_orientation((2, 0, 0, 0, 1, 0))
    assert "non_unit_image_orientation" in codes(problems)


def test_non_orthogonal_direction_cosines_are_reported():
    """Two cosines 45 degrees apart describe no image plane."""
    s = math.sqrt(0.5)
    problems = validate_orientation((1, 0, 0, s, s, 0))
    assert "non_orthogonal_image_orientation" in codes(problems)


def test_a_real_acquisition_rounding_is_tolerated():
    """Scanners write six decimals, not exact zeros. Refusing that would
    refuse legitimate studies."""
    problems = validate_orientation((1.0, 0.000001, 0.0, -0.000001, 1.0, 0.0))
    assert problems == [], [p.code for p in problems]


def test_missing_pixel_spacing_is_reported():
    assert "missing_pixel_spacing" in codes(validate_pixel_spacing(None))


def test_a_single_pixel_spacing_value_is_not_enough():
    """A scalar cannot place a pixel on an anisotropic acquisition, which is
    exactly the shape the previous schema persisted."""
    assert "malformed_pixel_spacing" in codes(validate_pixel_spacing((0.7,)))


def test_non_positive_pixel_spacing_is_reported():
    assert "malformed_pixel_spacing" in codes(validate_pixel_spacing((0.7, 0.0)))
    assert "malformed_pixel_spacing" in codes(validate_pixel_spacing((-0.7, 0.7)))


def test_missing_and_malformed_image_position_are_reported():
    assert "missing_image_position" in codes(validate_position(None))
    assert "malformed_image_position" in codes(validate_position((0.0, 1.0)))
    assert "malformed_image_position" in codes(
        validate_position((0.0, 1.0, float("inf")))
    )


def test_a_series_missing_positions_cannot_carry_a_frame():
    series = make_ct_series(count=10)
    for ds in series:
        del ds.ImagePositionPatient
    problems = validate_series_geometry(metas(series))
    assert "incomplete_image_positions" in codes(problems)


def test_a_series_with_mixed_orientations_cannot_carry_one_frame():
    series = make_ct_series(count=10)
    series[4].ImageOrientationPatient = [0, 1, 0, 0, 0, 1]
    assert "mixed_orientation" in codes(validate_series_geometry(metas(series)))


def test_building_a_frame_from_invalid_geometry_raises_rather_than_guessing():
    series = make_ct_series(count=10)
    for ds in series:
        del ds.PixelSpacing
    with pytest.raises(ValueError) as raised:
        SeriesFrame.from_instances(metas(series), (0.0, 0.0, 1.0))
    assert "missing_pixel_spacing" in str(raised.value)


# ── 9-11. conversion and the round trip ────────────────────────────────────

def test_voxel_origin_maps_to_the_slice_origin():
    frame, _ = frame_for(make_ct_series(count=20, spacing=2.5, start_z=-300.0))

    assert frame.voxel_to_patient(0, 0, 0) == pytest.approx(frame.origins[0], abs=TOLERANCE_MM)
    assert frame.voxel_to_patient(0, 0, 19) == pytest.approx(frame.origins[19], abs=TOLERANCE_MM)


def test_voxel_to_patient_moves_along_the_right_axes():
    """i indexes columns and moves along the row cosine; j indexes rows and
    moves along the column cosine. Swapping them is silent on square pixels."""
    frame, _ = frame_for(make_ct_series(count=5, spacing=2.5))
    origin = frame.origins[0]

    moved_i = frame.voxel_to_patient(10, 0, 0)
    assert moved_i[0] - origin[0] == pytest.approx(10 * frame.column_spacing_mm)
    assert moved_i[1] - origin[1] == pytest.approx(0.0, abs=TOLERANCE_MM)

    moved_j = frame.voxel_to_patient(0, 10, 0)
    assert moved_j[1] - origin[1] == pytest.approx(10 * frame.row_spacing_mm)
    assert moved_j[0] - origin[0] == pytest.approx(0.0, abs=TOLERANCE_MM)


def test_patient_to_voxel_inverts_voxel_to_patient():
    frame, _ = frame_for(make_ct_series(count=20, spacing=2.5))

    for i, j, k in [(0, 0, 0), (100, 200, 5), (511, 511, 19), (37, 412, 12)]:
        point = frame.voxel_to_patient(i, j, k)
        back_i, back_j, back_k = frame.patient_to_voxel(point)
        assert back_i == pytest.approx(i, abs=TOLERANCE_VOXEL)
        assert back_j == pytest.approx(j, abs=TOLERANCE_VOXEL)
        assert back_k == k


def test_the_round_trip_holds_on_sub_voxel_positions():
    """Coordinates are not silently rounded, so a fractional position has to
    survive the trip."""
    frame, _ = frame_for(make_ct_series(count=10, spacing=2.5))

    for i, j in [(10.5, 20.25), (0.125, 511.875), (256.0625, 256.0625)]:
        point = frame.voxel_to_patient(i, j, 3)
        back_i, back_j, back_k = frame.patient_to_voxel(point)
        assert back_i == pytest.approx(i, abs=TOLERANCE_VOXEL)
        assert back_j == pytest.approx(j, abs=TOLERANCE_VOXEL)
        assert back_k == 3


# ── 12-13. many slices, anisotropic spacing ────────────────────────────────

def test_the_round_trip_holds_on_every_slice_of_a_long_series():
    frame, _ = frame_for(make_ct_series(count=120, spacing=1.25))

    for k in range(frame.slice_count):
        point = frame.voxel_to_patient(128, 256, k)
        back_i, back_j, back_k = frame.patient_to_voxel(point)
        assert back_k == k, f"slice {k} resolved to {back_k}"
        assert back_i == pytest.approx(128, abs=TOLERANCE_VOXEL)
        assert back_j == pytest.approx(256, abs=TOLERANCE_VOXEL)


def test_anisotropic_row_and_column_spacing_are_not_interchangeable():
    """The case a single persisted scalar could not represent."""
    series = make_ct_series(count=10, spacing=2.5)
    for ds in series:
        ds.PixelSpacing = [0.5, 0.8]  # row spacing, column spacing

    frame, _ = frame_for(series)
    assert frame.row_spacing_mm == pytest.approx(0.5)
    assert frame.column_spacing_mm == pytest.approx(0.8)

    origin = frame.origins[0]
    assert frame.voxel_to_patient(1, 0, 0)[0] - origin[0] == pytest.approx(0.8)
    assert frame.voxel_to_patient(0, 1, 0)[1] - origin[1] == pytest.approx(0.5)

    point = frame.voxel_to_patient(64, 32, 4)
    i, j, k = frame.patient_to_voxel(point)
    assert (i, j, k) == pytest.approx((64, 32, 4), abs=TOLERANCE_VOXEL)


def test_irregular_slice_spacing_still_resolves_to_the_right_slice():
    """The origins are used per slice rather than extrapolated from slice 0,
    so a series the gate tolerates does not accumulate positional error."""
    series = make_ct_series(count=10, spacing=2.5)
    for index, ds in enumerate(series):
        jitter = 0.03 if index % 2 else -0.03
        ds.ImagePositionPatient = [0.0, 0.0, -300.0 + index * 2.5 + jitter]

    frame, _ = frame_for(series)
    for k in range(frame.slice_count):
        point = frame.voxel_to_patient(0, 0, k)
        assert frame.patient_to_voxel(point)[2] == k


# ── 8. ordering direction ──────────────────────────────────────────────────

def test_a_reversed_series_yields_a_frame_in_the_normalised_direction():
    """The frame is built from the ordered slices, so the polarity convention
    carries into the coordinate system: +k runs towards the head."""
    series = make_ct_series(count=20, spacing=2.5, orientation=(0, 1, 0, 1, 0, 0))
    frame, result = frame_for(series)

    assert result.polarity_normalised is True
    z_first = frame.voxel_to_patient(0, 0, 0)[2]
    z_last = frame.voxel_to_patient(0, 0, frame.slice_count - 1)[2]
    assert z_first < z_last, "+k goes towards the head"


# ── 15. determinism ────────────────────────────────────────────────────────

def test_the_frame_is_identical_across_repeated_builds():
    series = make_ct_series(count=20, spacing=2.5)
    frames = [frame_for(series)[0] for _ in range(4)]

    assert len({f.normal for f in frames}) == 1
    assert len({f.row_cosine for f in frames}) == 1
    assert len({tuple(f.origins) for f in frames}) == 1

    points = [tuple(f.voxel_to_patient(123, 45, 6)) for f in frames]
    assert len(set(points)) == 1, "the same voxel maps to one point, every time"


def test_normalise_refuses_a_zero_vector_rather_than_dividing_by_zero():
    with pytest.raises(ValueError):
        normalise((0.0, 0.0, 0.0))


def test_the_orthogonality_tolerance_is_tight_enough_to_mean_something():
    """A tolerance loose enough to admit a genuinely skewed plane would make
    the check decorative."""
    assert ORTHOGONALITY_TOLERANCE <= 1e-3
