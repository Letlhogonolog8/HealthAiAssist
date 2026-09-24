"""
series_loader and sampling, on the synthetic phantom.

The loader must produce exactly what the service would — the same volume
builder, the same quality gate, the same lung mask, the same patch cutter —
and it must refuse rather than guess wherever a label's identity is in doubt.
Sampling must never put a negative on top of a marked location and must give
the same samples for the same seed.

The phantom is synthetic (see conftest.py). Nothing here is a measurement of
a detector or a patient.
"""
from __future__ import annotations

import numpy as np
import pytest

import conftest as fx
from training import sampling
from training import series_loader as sl


# ── loading and HU ─────────────────────────────────────────────────────────

def test_the_phantom_passes_the_services_quality_gate(phantom):
    assert phantom.gate["passed"] is True


def test_volumes_are_in_hounsfield_units(phantom):
    array = phantom.volume.array
    assert array[0, 0, 0] == pytest.approx(-1000.0)          # air
    assert array[5, 128, 60] == pytest.approx(-850.0)        # aerated lung
    assert array[fx.NODULE["k"], fx.NODULE["row"], fx.NODULE["col"]] == pytest.approx(40.0)


def test_upload_order_does_not_change_the_volume(phantom):
    """Descending files are reordered by geometry, not by arrival."""
    volume, _ordering, _gate = sl.volume_from_datasets(fx.phantom_datasets(order="descending"))
    assert np.array_equal(volume.array, phantom.volume.array)


def test_a_series_that_fails_the_gate_is_unavailable_with_its_reason():
    datasets = fx.phantom_datasets()[:20]      # below the 40-slice minimum
    with pytest.raises(sl.SeriesUnavailable) as excinfo:
        sl.volume_from_datasets(datasets)
    assert excinfo.value.code.startswith("quality_gate:")


def test_a_duplicated_slice_position_is_refused():
    datasets = fx.phantom_datasets()
    datasets[10].ImagePositionPatient = list(datasets[9].ImagePositionPatient)
    with pytest.raises(sl.SeriesUnavailable):
        sl.volume_from_datasets(datasets)


def test_a_missing_exclusion_index_fails_closed(tmp_path):
    with pytest.raises(sl.SeriesUnavailable) as excinfo:
        sl.load_exclusions(str(tmp_path / "absent.csv"))
    assert excinfo.value.code == "exclusions_missing"


# ── label coordinates ──────────────────────────────────────────────────────

def test_a_label_resolves_to_its_voxel(phantom):
    target = phantom.targets[0]
    assert (target.k, target.j, target.i) == (fx.NODULE["k"], fx.NODULE["row"], fx.NODULE["col"])


def test_the_label_patient_coordinate_follows_the_dicom_formula(phantom):
    """PS3.3 C.7.6.2.1.1 with identity orientation: x = IPPx + col*dx, y = IPPy + row*dy."""
    target = phantom.targets[0]
    assert target.x_mm == pytest.approx(0.0 + fx.NODULE["col"] * fx.PIXEL_MM)
    assert target.y_mm == pytest.approx(0.0 + fx.NODULE["row"] * fx.PIXEL_MM)
    assert target.z_mm == pytest.approx(fx.START_Z + fx.NODULE["k"] * fx.SLICE_MM)


def test_a_label_whose_z_disagrees_with_its_slice_is_not_placed(phantom):
    label = phantom.label
    wrong_z = float(label["z"]) + 5.0
    assert sl.resolve_point(phantom.ordering, phantom.volume, label["sop_uid"],
                            float(label["cx"]), float(label["cy"]), wrong_z) is None


def test_a_label_naming_a_slice_not_in_the_series_is_not_placed(phantom):
    assert sl.resolve_point(phantom.ordering, phantom.volume, "1.2.3.not.here",
                            80.0, 128.0, None) is None


def test_a_label_outside_the_frame_is_not_placed(phantom):
    label = phantom.label
    assert sl.resolve_point(phantom.ordering, phantom.volume, label["sop_uid"],
                            999.0, 128.0, float(label["z"])) is None


# ── the lung mask the harness trains against ───────────────────────────────

def test_the_labelled_nodule_is_inside_the_search_constraint(phantom):
    """Under lung-threshold-v1 this failed: the solid nodule was a hole in the
    aerated band. The service would never score a window centred on it, and a
    detector trained on it would be trained on a location it never serves."""
    target = phantom.targets[0]
    assert phantom.lung_mask.contains(target.i, target.j, target.k)
    assert phantom.lung_mask.version == "lung-threshold-v3"


# ── sampling ───────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def samples(phantom, training_config):
    side = 100
    return sampling.sample_series(phantom, "phantom-series", training_config, side), side


def test_one_positive_per_labelled_nodule(samples, phantom):
    result, _side = samples
    assert result.stats["positives"] == len(phantom.targets) == int((result.labels == 1).sum())


def test_negatives_are_drawn_as_configured(samples, training_config):
    result, _side = samples
    assert result.stats["negatives"] == training_config["sampling"]["negatives_per_series"]
    assert result.stats["negativeShortfall"] == 0


def test_every_negative_is_inside_the_lung_mask(samples, phantom):
    result, _side = samples
    for k, j, i in result.centres[result.labels == 0].astype(int):
        assert phantom.lung_mask.mask[k, j, i]


def test_no_negative_is_near_any_marked_location(samples, phantom, training_config):
    """The rated nodule and the sub-3 mm mark alike: the ignore zone holds."""
    result, _side = samples
    radius = training_config["sampling"]["negative_exclusion_radius_mm"]
    points = phantom.exclusion_points_mm
    assert len(points) == 2
    for k, j, i in result.centres[result.labels == 0]:
        centre = np.asarray(phantom.volume.voxel_to_patient(float(i), float(j), int(k)))
        assert np.sqrt(((points - centre) ** 2).sum(axis=1)).min() >= radius


def test_the_exclusion_actually_had_work_to_do(samples):
    """Otherwise the two tests above would pass on a sampler that ignored it."""
    result, _side = samples
    assert result.stats["negativeRejectedNearMark"] > 0


def test_sampling_is_deterministic_for_the_same_seed_and_series(phantom, training_config):
    a = sampling.sample_series(phantom, "phantom-series", training_config, 100)
    b = sampling.sample_series(phantom, "phantom-series", training_config, 100)
    assert np.array_equal(a.contexts, b.contexts)
    assert np.array_equal(a.labels, b.labels)


def test_a_different_series_key_draws_different_negatives(phantom, training_config):
    a = sampling.sample_series(phantom, "phantom-series", training_config, 100)
    b = sampling.sample_series(phantom, "another-series", training_config, 100)
    assert not np.array_equal(a.contexts[a.labels == 0], b.contexts[b.labels == 0])


def test_a_training_context_is_the_services_own_patch(phantom, training_config):
    """Cut by inference/detection_service._extract_patch, so training and
    serving see the same array at the same location."""
    from detection_service import DetectionConfig, _extract_patch as service_patch

    prepared = sampling.prepare(phantom.volume, training_config["preprocessing"])
    k, j, i = fx.NODULE["k"], fx.NODULE["row"], fx.NODULE["col"]
    ours = sampling.cut_context(prepared, k, j, i, 64, 3)
    theirs = service_patch(prepared, k, j, i, DetectionConfig(patch_px=64, channels=3))
    assert np.array_equal(ours, theirs)


def test_the_positive_target_sits_at_the_context_centre(samples):
    result, side = samples
    positive = int(np.flatnonzero(result.labels == 1)[0])
    assert tuple(result.target_rc[positive]) == (side // 2, side // 2)


def test_a_target_carries_no_malignancy_field():
    """Structural: the thing sampling reads cannot hold a rating, so a benign-
    and a malignant-rated nodule are necessarily the same kind of positive."""
    import dataclasses

    names = {f.name for f in dataclasses.fields(sl.NoduleTarget)}
    assert names == {"key", "i", "j", "k", "x_mm", "y_mm", "z_mm"}
