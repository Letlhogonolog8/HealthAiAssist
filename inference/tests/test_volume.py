"""
inference/volume.py: a stack of slices becoming a volume, or refusing to.

The refusals are the point. A volume built from a series whose ordering or
polarity is unknown is not obviously broken — it is a well-formed array of
plausible numbers with the anatomy scrambled or mirrored, and no downstream
check can see it. So every case where something is unknown is a named refusal,
and these tests are mostly assertions that it refuses.

The HU assertions rest on the synthetic fixture's known ramp: stored values
run -1000 to +1000 HU down the rows after the rescale, so what each row must
contain is arithmetic, not a clinical claim.
"""
from __future__ import annotations

import numpy as np
import pytest

from conftest import make_ct_series

from geometry import SeriesFrame
from quality_gate import evaluate_ct_series
from series import assemble, order_slices, read_instance_metadata
from volume import MIN_SLICE_SPACING_MM, CtVolume, VolumeRefused, build_volume


def prepared(datasets):
    """The (ordered metas, ordering, datasets-in-that-order) a builder takes."""
    metas = [read_instance_metadata(ds, index) for index, ds in enumerate(datasets)]
    members, _report = assemble(metas)
    ordering = order_slices(members)
    in_order = [datasets[m.source_index] for m in ordering.ordered]
    return ordering.ordered, ordering, in_order


def build(datasets, **kwargs):
    ordered, ordering, in_order = prepared(datasets)
    return build_volume(ordered, ordering, in_order, **kwargs)


# ── the ordinary case ──────────────────────────────────────────────────────

def test_a_valid_series_becomes_a_volume():
    volume = build(make_ct_series(count=20, spacing=2.5, rows=64, columns=64))

    assert isinstance(volume, CtVolume)
    assert volume.shape == (20, 64, 64), "(slices, rows, columns)"
    assert volume.array.dtype == np.float32
    assert volume.slice_spacing_mm == pytest.approx(2.5)
    assert volume.spacing_is_uniform is True
    assert volume.polarity == "feet_to_head"


def test_the_volume_is_in_hounsfield_units_not_rendered_bytes():
    """The fixture's ramp runs -1000 HU at row 0 to +1000 at the last row.
    An 8-bit render would be 0..255 and air would not be negative."""
    volume = build(make_ct_series(count=10, rows=64, columns=64))

    assert volume.array.min() == pytest.approx(-1000.0, abs=1.0)
    assert volume.array.max() == pytest.approx(1000.0, abs=1.0)
    assert volume.array[0, 0, 0] == pytest.approx(-1000.0, abs=1.0), "air is negative"
    assert volume.array.max() > 255, "not an 8-bit render"


def test_the_voxel_spacing_is_anisotropic_and_ordered_slice_row_column():
    series = make_ct_series(count=10, spacing=2.5, rows=64, columns=64)
    for ds in series:
        ds.PixelSpacing = [0.5, 0.8]
    volume = build(series)

    assert volume.voxel_spacing_mm == pytest.approx((2.5, 0.5, 0.8))


def test_the_volume_carries_a_frame_that_places_its_voxels():
    volume = build(make_ct_series(count=12, spacing=2.5, rows=64, columns=64))

    assert isinstance(volume.frame, SeriesFrame)
    for k in (0, 5, 11):
        point = volume.voxel_to_patient(10, 20, k)
        i, j, back_k = volume.patient_to_voxel(point)
        assert (i, j, back_k) == pytest.approx((10, 20, k), abs=1e-9)


def test_slice_zero_is_the_most_inferior_slice_of_the_array():
    """The polarity convention has to survive into the array, or the volume's
    +k is not the patient's head."""
    volume = build(make_ct_series(count=15, spacing=2.5, rows=64, columns=64))

    first_z = volume.voxel_to_patient(0, 0, 0)[2]
    last_z = volume.voxel_to_patient(0, 0, volume.shape[0] - 1)[2]
    assert first_z < last_z


def test_a_reversed_acquisition_produces_the_same_anatomical_stack():
    """Two descriptions of one acquisition must give the same volume."""
    forward = make_ct_series(count=12, spacing=2.5, rows=64, columns=64)
    reversed_desc = make_ct_series(
        count=12, spacing=2.5, rows=64, columns=64, orientation=(0, 1, 0, 1, 0, 0)
    )
    for source, target in zip(forward, reversed_desc):
        target.ImagePositionPatient = list(source.ImagePositionPatient)

    a, b = build(forward), build(reversed_desc)
    a_z = [a.voxel_to_patient(0, 0, k)[2] for k in range(a.shape[0])]
    b_z = [b.voxel_to_patient(0, 0, k)[2] for k in range(b.shape[0])]
    assert a_z == pytest.approx(b_z)


def test_shuffled_input_gives_an_identical_volume():
    import random

    series = make_ct_series(count=16, spacing=2.5, rows=64, columns=64)
    shuffled = series[:]
    random.Random(21).shuffle(shuffled)

    assert np.array_equal(build(series).array, build(shuffled).array)


def test_repeated_builds_are_identical():
    series = make_ct_series(count=10, spacing=2.5, rows=64, columns=64)
    volumes = [build(series) for _ in range(3)]
    for other in volumes[1:]:
        assert np.array_equal(volumes[0].array, other.array)
        assert volumes[0].slice_spacing_mm == other.slice_spacing_mm


# ── the refusals ───────────────────────────────────────────────────────────

def refusal(datasets, **kwargs):
    with pytest.raises(VolumeRefused) as raised:
        build(datasets, **kwargs)
    return raised.value


def test_a_failed_quality_gate_refuses():
    error = refusal(make_ct_series(count=10, rows=64, columns=64), gate_passed=False)
    assert error.code == "quality_gate_failed"


def test_untrusted_ordering_refuses():
    series = make_ct_series(count=20, rows=64, columns=64)
    series[9].ImageOrientationPatient = [0, 1, 0, 0, 0, 1]
    assert refusal(series).code == "untrusted_ordering"


def test_a_non_geometric_ordering_refuses():
    """SliceLocation orders reproducibly and is not derived from the
    acquisition geometry, so it cannot carry a volume."""
    series = make_ct_series(count=20, rows=64, columns=64)
    for ds in series:
        del ds.ImageOrientationPatient
    assert refusal(series).code == "ordering_not_geometric"


def test_an_indeterminate_polarity_refuses_by_default():
    """A coronal acquisition orders fine and has no head end."""
    series = make_ct_series(count=20, rows=64, columns=64, orientation=(1, 0, 0, 0, 0, 1))
    for index, ds in enumerate(series):
        ds.ImagePositionPatient = [0.0, index * 2.5, 0.0]

    error = refusal(series)
    assert error.code == "indeterminate_polarity"
    assert error.detail["polarity"] == "indeterminate"


def test_the_polarity_requirement_can_be_waived_only_deliberately():
    """The escape hatch exists so a future non-axial consumer opts out in
    writing rather than by accident."""
    series = make_ct_series(count=20, rows=64, columns=64, orientation=(1, 0, 0, 0, 0, 1))
    for index, ds in enumerate(series):
        ds.ImagePositionPatient = [0.0, index * 2.5, 0.0]

    volume = build(series, require_polarity=False)
    assert volume.polarity == "indeterminate"


def test_duplicate_slice_positions_refuse():
    series = make_ct_series(count=20, spacing=2.5, rows=64, columns=64)
    series[10].ImagePositionPatient = list(series[9].ImagePositionPatient)
    # The ordering flags this too; assert the volume refuses on its own terms
    # by checking the code is one of the two guards, not a crash.
    assert refusal(series).code in ("untrusted_ordering", "duplicate_slice_position")


def test_a_single_slice_is_not_a_volume():
    ordered, ordering, in_order = prepared(make_ct_series(count=1, rows=64, columns=64))
    with pytest.raises(VolumeRefused) as raised:
        build_volume(ordered, ordering, in_order)
    assert raised.value.code in ("single_slice_series", "untrusted_ordering")


def test_an_empty_series_refuses():
    from series import OrderingResult

    with pytest.raises(VolumeRefused) as raised:
        build_volume([], OrderingResult([], "image_position_patient", True), [])
    assert raised.value.code == "empty_series"


def test_mismatched_slice_and_dataset_counts_refuse():
    ordered, ordering, in_order = prepared(make_ct_series(count=10, rows=64, columns=64))
    with pytest.raises(VolumeRefused) as raised:
        build_volume(ordered, ordering, in_order[:-1])
    assert raised.value.code == "slice_dataset_mismatch"


def test_a_missing_rescale_refuses_rather_than_assuming_identity():
    """Without the modality LUT the values are stored numbers, and treating
    them as HU would put air at 0 instead of -1000."""
    series = make_ct_series(count=10, rows=64, columns=64)
    for ds in series:
        del ds.RescaleIntercept
    # The gate catches this first in the real pipeline; here the builder is
    # given a passing gate so its own guard is what is under test.
    ordered, ordering, in_order = prepared(series)
    with pytest.raises(VolumeRefused) as raised:
        build_volume(ordered, ordering, in_order)
    assert raised.value.code == "missing_rescale"


def test_an_inconsistent_matrix_refuses():
    series = make_ct_series(count=10, rows=64, columns=64)
    series[4].Rows, series[4].Columns = 32, 32
    import numpy as _np

    hu = _np.linspace(-1000, 1000, 32, dtype=_np.float64)[:, None].repeat(32, axis=1)
    series[4].PixelData = _np.round(hu + 1024).astype(_np.int16).tobytes()

    error = refusal(series)
    assert error.code in ("inconsistent_matrix", "untrusted_ordering", "invalid_geometry")


def test_invalid_geometry_refuses_with_the_failing_checks_named():
    series = make_ct_series(count=10, spacing=2.5, rows=64, columns=64)
    for ds in series:
        del ds.PixelSpacing
    error = refusal(series)
    assert error.code == "invalid_geometry"
    assert any("pixel_spacing" in p["code"] for p in error.detail["problems"])


def test_a_refusal_carries_a_code_and_a_sentence_somebody_can_act_on():
    error = refusal(make_ct_series(count=10, rows=64, columns=64), gate_passed=False)
    assert error.code.islower()
    assert len(error.message) > 40
    assert "code" in error.as_dict()


# ── irregular spacing is recorded, not repaired ────────────────────────────

def test_irregular_spacing_is_reported_rather_than_smoothed_over():
    series = make_ct_series(count=20, spacing=2.5, rows=64, columns=64)
    # A 5 mm step where a slice is missing. The gate decides whether that is
    # acceptable; the volume records that it is not a regular grid.
    for index, ds in enumerate(series):
        offset = 2.5 if index >= 10 else 0.0
        ds.ImagePositionPatient = [0.0, 0.0, -300.0 + index * 2.5 + offset]

    volume = build(series)
    assert volume.spacing_is_uniform is False
    assert any("not a regular grid" in w for w in volume.warnings)


def test_small_reconstruction_jitter_still_counts_as_uniform():
    series = make_ct_series(count=20, spacing=2.5, rows=64, columns=64)
    for index, ds in enumerate(series):
        jitter = 0.004 if index % 2 else 0.0
        ds.ImagePositionPatient = [0.0, 0.0, -300.0 + index * 2.5 + jitter]

    assert build(series).spacing_is_uniform is True


def test_the_gate_and_the_volume_agree_on_a_good_series():
    """The two guards are independent; a series the gate passes must not then
    be refused by the builder, or nothing could ever be built."""
    series = make_ct_series(count=45, spacing=2.5, rows=64, columns=64)
    ordered, ordering, in_order = prepared(series)
    gate = evaluate_ct_series(ordering.ordered, ordering)
    # 64x64 fails the matrix bar by design, so only the ordering half is
    # compared here; what matters is that the builder does not add a refusal.
    volume = build_volume(ordered, ordering, in_order, gate_passed=True)
    assert volume.shape[0] == 45
    assert ordering.trusted
    assert gate.measurements["orderingTrusted"] is True


def test_the_minimum_spacing_guard_is_tighter_than_any_real_acquisition():
    assert MIN_SLICE_SPACING_MM < 0.01
