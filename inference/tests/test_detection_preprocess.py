"""
inference/detection_preprocess.py: HU to detector input.

The property that matters most is separation: this path must not be, and must
not become, the 8-bit lung-window render the nodule characteriser takes. That
substitution is the same class of mistake that withdrew the legacy lung model
— a model meeting a distribution nobody measured it on — and it would be
invisible, because both paths produce plausible arrays.

The rest is determinism. Every published detector figure describes a model and
a transform together, so a transform that changes without its fingerprint
changing makes the figure quietly stop describing the system.
"""
from __future__ import annotations

import numpy as np
import pytest

from conftest import make_ct_series

from detection_preprocess import (
    DEFAULT_CONFIG,
    PREPROCESSING_VERSION,
    PreprocessConfig,
    build_channel_stack,
    prepare_volume,
    resample_slices,
    to_hu_window,
)
from series import assemble, order_slices, read_instance_metadata
from volume import build_volume


def volume_for(count=20, spacing=2.5, rows=64, columns=64):
    datasets = make_ct_series(count=count, spacing=spacing, rows=rows, columns=columns)
    metas = [read_instance_metadata(ds, i) for i, ds in enumerate(datasets)]
    members, _ = assemble(metas)
    ordering = order_slices(members)
    in_order = [datasets[m.source_index] for m in ordering.ordered]
    return build_volume(ordering.ordered, ordering, in_order)


# ── separation from the characteriser's render ─────────────────────────────

def test_the_detector_transform_is_not_the_characteriser_window():
    """dicom_ingest uses WC -600 / WW 1500, i.e. -1350..+150 HU, and emits
    8-bit. This clips to a different range and emits float."""
    from dicom_ingest import CT_LUNG_WINDOW

    centre, width = CT_LUNG_WINDOW
    characteriser_low, characteriser_high = centre - width / 2, centre + width / 2

    assert (DEFAULT_CONFIG.hu_min, DEFAULT_CONFIG.hu_max) != (
        characteriser_low,
        characteriser_high,
    ), "the two transforms must not silently converge"


def test_the_output_is_float_not_eight_bit():
    volume = volume_for()
    prepared, _record = prepare_volume(volume)

    assert prepared.dtype == np.float32
    assert prepared.max() <= 1.0 and prepared.min() >= 0.0


# ── HU handling ────────────────────────────────────────────────────────────

def test_clipping_keeps_the_configured_range():
    array = np.array([[-2000.0, -1000.0, 0.0, 400.0, 3000.0]], dtype=np.float32)
    clipped = to_hu_window(array, PreprocessConfig(normalise=False))

    assert clipped.min() == pytest.approx(-1000.0)
    assert clipped.max() == pytest.approx(400.0)


def test_normalisation_maps_the_range_onto_zero_to_one():
    array = np.array([[-1000.0, -300.0, 400.0]], dtype=np.float32)
    scaled = to_hu_window(array, PreprocessConfig())

    assert scaled[0, 0] == pytest.approx(0.0)
    assert scaled[0, 2] == pytest.approx(1.0)
    assert scaled[0, 1] == pytest.approx((-300.0 + 1000.0) / 1400.0, abs=1e-6)


def test_normalisation_can_be_switched_off_leaving_real_hounsfield_units():
    array = np.array([[-500.0]], dtype=np.float32)
    assert to_hu_window(array, PreprocessConfig(normalise=False))[0, 0] == pytest.approx(-500.0)


def test_an_inverted_hu_range_is_refused_rather_than_dividing_by_a_negative():
    with pytest.raises(ValueError):
        to_hu_window(np.zeros((2, 2), dtype=np.float32), PreprocessConfig(hu_min=400, hu_max=-1000))


def test_the_transform_does_not_rescale_per_volume():
    """Per-volume z-scoring would make identical anatomy map to different
    numbers depending on how much of the patient is in the frame."""
    small = np.array([[-1000.0, 0.0]], dtype=np.float32)
    large = np.array([[-1000.0, 0.0, 400.0, 400.0]], dtype=np.float32)

    assert to_hu_window(small)[0, 0] == to_hu_window(large)[0, 0]
    assert to_hu_window(small)[0, 1] == to_hu_window(large)[0, 1]


# ── channel stacks ─────────────────────────────────────────────────────────

def test_a_channel_stack_is_centred_on_the_requested_slice():
    array = np.arange(10 * 2 * 2, dtype=np.float32).reshape(10, 2, 2)
    stack = build_channel_stack(array, centre=5, channels=3)

    assert stack.shape == (3, 2, 2)
    assert np.array_equal(stack[1], array[5]), "the middle channel is the centre slice"
    assert np.array_equal(stack[0], array[4])
    assert np.array_equal(stack[2], array[6])


def test_a_stack_at_the_edge_is_padded_not_shifted():
    """Shifting would put a finding at the apex off-centre and teach a model
    that findings live at the edge of the stack."""
    array = np.arange(10 * 2 * 2, dtype=np.float32).reshape(10, 2, 2)
    stack = build_channel_stack(array, centre=0, channels=5)

    assert stack.shape == (5, 2, 2)
    assert np.array_equal(stack[2], array[0]), "still centred on slice 0"
    assert np.array_equal(stack[0], array[0]), "edge-padded"
    assert np.array_equal(stack[1], array[0])


def test_an_even_channel_count_is_refused_because_it_has_no_centre():
    array = np.zeros((10, 2, 2), dtype=np.float32)
    with pytest.raises(ValueError):
        build_channel_stack(array, centre=5, channels=4)


def test_a_single_channel_stack_is_the_slice_itself():
    array = np.arange(10 * 2 * 2, dtype=np.float32).reshape(10, 2, 2)
    stack = build_channel_stack(array, centre=3, channels=1)
    assert stack.shape == (1, 2, 2)
    assert np.array_equal(stack[0], array[3])


# ── resampling ─────────────────────────────────────────────────────────────

def test_no_resampling_leaves_the_volume_and_its_spacing_alone():
    volume = volume_for(count=10, spacing=2.5)
    array, spacing = resample_slices(volume, PreprocessConfig())

    assert array is volume.array
    assert spacing == pytest.approx(2.5)


def test_resampling_puts_the_stack_on_the_requested_grid():
    volume = volume_for(count=10, spacing=2.5)
    array, spacing = resample_slices(volume, PreprocessConfig(resample_slice_spacing_mm=1.25))

    assert spacing == pytest.approx(1.25)
    assert array.shape[0] > volume.shape[0], "finer grid, more slices"
    assert array.shape[1:] == volume.shape[1:], "in-plane is untouched"


def test_resampling_preserves_the_values_at_the_original_positions():
    volume = volume_for(count=10, spacing=2.0)
    array, _ = resample_slices(volume, PreprocessConfig(resample_slice_spacing_mm=2.0))
    assert np.allclose(array[0], volume.array[0], atol=1e-4)


def test_a_non_positive_resample_spacing_is_refused():
    volume = volume_for(count=10)
    with pytest.raises(ValueError):
        resample_slices(volume, PreprocessConfig(resample_slice_spacing_mm=0.0))


def test_a_resample_that_would_collapse_the_volume_is_refused():
    volume = volume_for(count=5, spacing=2.5)
    with pytest.raises(ValueError):
        resample_slices(volume, PreprocessConfig(resample_slice_spacing_mm=10_000.0))


# ── determinism and the fingerprint ────────────────────────────────────────

def test_the_fingerprint_changes_when_any_parameter_changes():
    base = PreprocessConfig()
    for changed in (
        PreprocessConfig(hu_min=-1200),
        PreprocessConfig(hu_max=600),
        PreprocessConfig(normalise=False),
        PreprocessConfig(resample_slice_spacing_mm=1.0),
        PreprocessConfig(channels=5),
    ):
        assert changed.fingerprint() != base.fingerprint(), changed


def test_the_fingerprint_is_stable_across_instances_and_runs():
    assert PreprocessConfig().fingerprint() == PreprocessConfig().fingerprint()
    assert len({PreprocessConfig().fingerprint() for _ in range(5)}) == 1


def test_the_record_carries_the_version_and_the_fingerprint():
    volume = volume_for(count=10)
    _prepared, record = prepare_volume(volume)

    assert record["version"] == PREPROCESSING_VERSION
    assert record["fingerprint"] == DEFAULT_CONFIG.fingerprint()
    assert record["resampled"] is False
    assert record["inputShape"] == list(volume.shape)
    assert record["sliceSpacingMmOut"] == pytest.approx(2.5)


def test_preparing_the_same_volume_twice_gives_identical_arrays():
    volume = volume_for(count=12)
    first, record_a = prepare_volume(volume)
    second, record_b = prepare_volume(volume)

    assert np.array_equal(first, second)
    assert record_a == record_b


def test_the_config_is_frozen_so_a_transform_cannot_drift_at_runtime():
    with pytest.raises(Exception):
        DEFAULT_CONFIG.hu_min = -500  # type: ignore[misc]
