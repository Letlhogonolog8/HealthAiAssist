"""
inference/quality_gate.py: what this pipeline will and will not accept.

The gate fails closed, so most of these assert a refusal. The one that matters
most is the first: a series that looks exactly like the data the downstream
model was trained on must pass, or the gate is simply a way of rejecting
everything.
"""
from __future__ import annotations

import pytest

from conftest import make_ct_series, requires_lidc

from quality_gate import (
    MAX_SLICE_THICKNESS_MM,
    MIN_MATRIX,
    MIN_SLICES,
    evaluate_ct_series,
)
from series import assemble, order_slices, read_instance_metadata


def gate_for(datasets):
    instances = [read_instance_metadata(ds, i) for i, ds in enumerate(datasets)]
    members, _ = assemble(instances)
    ordering = order_slices(members)
    return evaluate_ct_series(ordering.ordered, ordering)


def codes(result):
    return {failure["code"] for failure in result.failures}


# ── the bars are where the data says they are ──────────────────────────────

def test_the_bars_sit_outside_the_measured_lidc_range():
    """Measured on 2026-09-22 over 30 LIDC-IDRI series: 109-351 slices,
    1.0-3.0 mm thickness, 512x512. A bar inside that range would refuse the
    collection the downstream model was trained on."""
    assert MIN_SLICES < 109
    assert MAX_SLICE_THICKNESS_MM > 3.0
    assert MIN_MATRIX <= 512


# ── C. the gate ────────────────────────────────────────────────────────────

def test_a_valid_chest_ct_series_passes():
    result = gate_for(make_ct_series(count=120, spacing=2.5, thickness=2.5))
    assert result.passed, result.failures
    assert result.anatomy_verified
    assert result.measurements["sliceCount"] == 120
    assert result.measurements["orderingMethod"] == "image_position_patient"
    assert result.measurements["orderingTrusted"] is True
    assert result.measurements["coverageMm"] == pytest.approx(297.5)


def test_the_wrong_modality_is_refused():
    result = gate_for(make_ct_series(count=120, modality="MR"))
    assert not result.passed
    assert "wrong_modality" in codes(result)


def test_too_few_slices_is_refused():
    result = gate_for(make_ct_series(count=MIN_SLICES - 1))
    assert not result.passed
    assert "too_few_slices" in codes(result)


def test_slices_that_are_too_thick_are_refused():
    result = gate_for(make_ct_series(count=120, thickness=MAX_SLICE_THICKNESS_MM + 1))
    assert not result.passed
    assert "slice_too_thick" in codes(result)


def test_a_thickness_that_is_a_units_error_is_refused():
    result = gate_for(make_ct_series(count=120, thickness=0.05))
    assert not result.passed
    assert "slice_too_thin" in codes(result)


def test_inconsistent_thickness_within_a_series_is_refused():
    series = make_ct_series(count=120, thickness=2.5)
    series[40].SliceThickness = 1.0
    result = gate_for(series)
    assert not result.passed
    assert "inconsistent_slice_thickness" in codes(result)


def test_a_missing_slice_is_refused_as_irregular_spacing():
    series = make_ct_series(count=120, spacing=2.5)
    del series[60]
    result = gate_for(series)
    assert not result.passed
    assert "irregular_slice_spacing" in codes(result)
    failure = next(f for f in result.failures if f["code"] == "irregular_slice_spacing")
    assert failure["worstGapMm"] == pytest.approx(5.0)
    assert failure["medianSpacingMm"] == pytest.approx(2.5)


def test_small_reconstruction_jitter_is_not_called_a_gap():
    """Real spacing is not exact to the micron; a gate that refuses on noise
    refuses everything."""
    series = make_ct_series(count=120, spacing=2.5)
    for index, ds in enumerate(series):
        ds.ImagePositionPatient = [0.0, 0.0, -300.0 + index * 2.5 + (0.004 if index % 2 else 0)]
    result = gate_for(series)
    assert result.passed, result.failures


def test_missing_required_metadata_is_refused():
    series = make_ct_series(count=120)
    for ds in series:
        del ds.PixelSpacing
    result = gate_for(series)
    assert not result.passed
    assert "missing_pixel_spacing" in codes(result)


def test_missing_rescale_is_refused_because_hounsfield_units_depend_on_it():
    series = make_ct_series(count=120)
    for ds in series:
        del ds.RescaleIntercept
    result = gate_for(series)
    assert not result.passed
    assert "missing_rescale" in codes(result)


def test_a_matrix_too_small_for_the_crop_is_refused():
    """pydicom's bundled CT_small.dcm is 128x128. A 64-pixel crop of that
    covers a different physical field of view entirely from the one the model
    was trained at — which is the shape of the mistake that withdrew the
    previous lung model."""
    result = gate_for(make_ct_series(count=120, rows=128, columns=128))
    assert not result.passed
    assert "matrix_too_small" in codes(result)


def test_an_inconsistent_matrix_within_a_series_is_refused():
    series = make_ct_series(count=120)
    series[70].Rows = 256
    series[70].Columns = 256
    result = gate_for(series)
    assert not result.passed
    assert "inconsistent_matrix" in codes(result)


def test_unsupported_anatomy_is_refused():
    result = gate_for(make_ct_series(count=120, body_part="HEAD"))
    assert not result.passed
    assert "unsupported_anatomy" in codes(result)
    assert not result.anatomy_verified


def test_absent_anatomy_is_a_warning_and_is_visible_in_the_result():
    """BodyPartExamined is absent from many real exports, so failing on its
    absence would refuse legitimate chest CT. It is recorded as unverified
    rather than assumed correct — the point is that it is never silent."""
    series = make_ct_series(count=120)
    for ds in series:
        del ds.BodyPartExamined
    result = gate_for(series)
    assert result.passed
    assert result.anatomy_verified is False
    assert any("BodyPartExamined" in w for w in result.warnings)


def test_burned_in_annotation_is_refused():
    series = make_ct_series(count=120)
    series[3].BurnedInAnnotation = "YES"
    result = gate_for(series)
    assert not result.passed
    assert "burned_in_annotation" in codes(result)


def test_an_untrustworthy_ordering_fails_the_gate():
    series = make_ct_series(count=120)
    for ds in series:
        del ds.ImageOrientationPatient
        del ds.ImagePositionPatient
        del ds.SliceLocation
    result = gate_for(series)
    assert not result.passed
    assert "untrusted_ordering" in codes(result)


def test_every_problem_is_reported_at_once():
    """A caller fixing one problem should not have to resubmit a 150 MB study
    to discover the next."""
    result = gate_for(make_ct_series(count=10, modality="MR", thickness=9.0, body_part="HEAD"))
    assert not result.passed
    assert {"wrong_modality", "too_few_slices", "slice_too_thick", "unsupported_anatomy"} <= codes(result)


def test_failures_carry_a_code_and_a_sentence_a_person_can_act_on():
    result = gate_for(make_ct_series(count=5))
    for failure in result.failures:
        assert failure["code"] and failure["code"].islower()
        assert len(failure["message"]) > 30
        assert failure["message"].endswith((".", "!"))


# ── on real data ───────────────────────────────────────────────────────────

@requires_lidc
def test_a_real_lidc_series_passes_the_gate(lidc_nodule):
    import glob
    import os

    import pydicom

    directory = os.path.dirname(lidc_nodule["abs_path"])
    files = sorted(glob.glob(os.path.join(directory, "*.dcm")))
    if len(files) < MIN_SLICES:
        pytest.skip("too few objects in this series directory")

    instances = [
        read_instance_metadata(pydicom.dcmread(f, stop_before_pixels=True, force=True), i)
        for i, f in enumerate(files)
    ]
    members, _ = assemble(instances)
    ordering = order_slices(members)
    result = evaluate_ct_series(ordering.ordered, ordering)

    assert result.passed, result.failures
    assert result.anatomy_verified
    assert result.measurements["modality"] == "CT"
    assert result.measurements["matrix"] == "512x512"
