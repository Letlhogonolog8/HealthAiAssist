"""
inference/detection_service.py: proposing locations, and refusing to.

The distinction this file exists to protect: an empty candidate list means the
volume was searched and nothing scored above the threshold; a refusal means no
search happened. Collapsing them lets an infrastructure failure read as a
normal negative result, which is the failure mode the whole platform is built
to avoid.

Every detector here is a SYNTHETIC stub defined in the test — a fixed score, a
score keyed to position, a broken contract. There is no trained model in this
repository and none of these assert anything about clinical performance.
"""
from __future__ import annotations

import numpy as np
import pytest

from conftest import make_ct_series

from detection_preprocess import prepare_volume
from detection_service import (
    DEFAULT_DETECTION_CONFIG,
    DETECTION_COORDINATE_SYSTEM,
    Candidate,
    DetectionConfig,
    DetectorUnavailable,
    detect_candidates,
    detector_status,
    merge_candidates,
    register_detector,
    registered_detector,
)
from lung_mask import LungMask
from series import assemble, order_slices, read_instance_metadata
from volume import build_volume


# ── synthetic detectors, clearly not models ────────────────────────────────

class ConstantDetector:
    """Scores every patch the same. SYNTHETIC — not a trained model."""

    version = "synthetic-constant-v0"

    def __init__(self, score=0.9):
        self.score = score
        self.calls = 0

    def score_batch(self, patches):
        self.calls += 1
        return np.full(patches.shape[0], self.score, dtype=np.float64)


class SilentDetector:
    """Scores everything below any sensible threshold. SYNTHETIC."""

    version = "synthetic-silent-v0"

    def score_batch(self, patches):
        return np.zeros(patches.shape[0], dtype=np.float64)


class BrokenDetector:
    """Returns the wrong number of scores. SYNTHETIC."""

    version = "synthetic-broken-v0"

    def score_batch(self, patches):
        return np.zeros(patches.shape[0] - 1, dtype=np.float64)


def volume_for(count=8, rows=64, columns=64, spacing=2.5):
    datasets = make_ct_series(count=count, spacing=spacing, rows=rows, columns=columns)
    metas = [read_instance_metadata(ds, i) for i, ds in enumerate(datasets)]
    members, _ = assemble(metas)
    ordering = order_slices(members)
    in_order = [datasets[m.source_index] for m in ordering.ordered]
    return build_volume(ordering.ordered, ordering, in_order)


def full_mask(volume):
    """A mask that permits everything, so mask behaviour is not under test."""
    return LungMask(
        mask=np.ones(volume.shape, dtype=bool), version="test-open", lung_fraction=1.0
    )


@pytest.fixture(autouse=True)
def clear_registry():
    register_detector(None)
    yield
    register_detector(None)


def small_config(**kwargs):
    base = dict(patch_px=16, stride_px=16, channels=3, score_threshold=0.5, merge_radius_mm=8.0)
    base.update(kwargs)
    return DetectionConfig(**base)


# ── the empty model slot ───────────────────────────────────────────────────

def test_no_detector_is_registered_by_default():
    """The repository ships no trained checkpoint, and the slot says so."""
    assert registered_detector() is None
    status = detector_status()
    assert status["available"] is False
    assert "does not return an empty candidate list" in status["note"]


def test_detection_refuses_when_there_is_no_model():
    volume = volume_for()
    prepared, _ = prepare_volume(volume)

    with pytest.raises(DetectorUnavailable) as raised:
        detect_candidates(volume, prepared, full_mask(volume), config=small_config())

    assert raised.value.code == "model_unavailable"
    assert "not a negative result" in raised.value.message


def test_a_refusal_is_not_an_empty_candidate_list():
    """The distinction the whole module is shaped around."""
    volume = volume_for()
    prepared, _ = prepare_volume(volume)

    with pytest.raises(DetectorUnavailable):
        detect_candidates(volume, prepared, full_mask(volume), config=small_config())

    result = detect_candidates(
        volume, prepared, full_mask(volume), config=small_config(), detector=SilentDetector()
    )
    assert result.candidates == [], "searched, nothing above threshold"
    assert result.positions_scored > 0, "and the search actually happened"


# ── the lung constraint is required, not optional by accident ──────────────

def test_a_missing_lung_mask_refuses_by_default():
    volume = volume_for()
    prepared, _ = prepare_volume(volume)

    with pytest.raises(DetectorUnavailable) as raised:
        detect_candidates(volume, prepared, None, config=small_config(), detector=ConstantDetector())

    assert raised.value.code == "lung_mask_unavailable"


def test_searching_without_the_mask_requires_saying_so_and_is_recorded():
    volume = volume_for()
    prepared, _ = prepare_volume(volume)

    result = detect_candidates(
        volume, prepared, None,
        config=small_config(), detector=ConstantDetector(), allow_without_mask=True,
    )
    assert any("without the lung-region constraint" in w for w in result.warnings)


def test_the_mask_actually_restricts_where_candidates_appear():
    volume = volume_for(rows=64, columns=64)
    prepared, _ = prepare_volume(volume)

    restricted = np.zeros(volume.shape, dtype=bool)
    restricted[:, 20:40, 20:40] = True
    mask = LungMask(mask=restricted, version="test-box", lung_fraction=0.1)

    result = detect_candidates(
        volume, prepared, mask, config=small_config(), detector=ConstantDetector()
    )
    assert result.candidates
    for candidate in result.candidates:
        assert 20 <= candidate.voxel_i < 40
        assert 20 <= candidate.voxel_j < 40


def test_a_mask_that_permits_nothing_gives_zero_candidates_and_says_why():
    volume = volume_for()
    prepared, _ = prepare_volume(volume)
    closed = LungMask(mask=np.zeros(volume.shape, dtype=bool), version="test-closed",
                      lung_fraction=0.0)

    result = detect_candidates(
        volume, prepared, closed, config=small_config(), detector=ConstantDetector()
    )
    assert result.candidates == []
    assert result.positions_scored == 0
    assert any("not evidence that the study is clear" in w for w in result.warnings)


# ── candidates and their coordinates ───────────────────────────────────────

def test_candidates_carry_both_coordinate_systems():
    volume = volume_for()
    prepared, _ = prepare_volume(volume)
    result = detect_candidates(
        volume, prepared, full_mask(volume), config=small_config(), detector=ConstantDetector()
    )

    assert result.candidates
    for candidate in result.candidates:
        assert candidate.coordinate_system == DETECTION_COORDINATE_SYSTEM == "dicom_patient_lps"
        assert isinstance(candidate.voxel_k, int)
        assert candidate.x_mm is not None and candidate.z_mm is not None


def test_a_candidate_round_trips_through_the_volume_frame():
    volume = volume_for()
    prepared, _ = prepare_volume(volume)
    result = detect_candidates(
        volume, prepared, full_mask(volume), config=small_config(), detector=ConstantDetector()
    )

    for candidate in result.candidates[:5]:
        i, j, k = volume.patient_to_voxel((candidate.x_mm, candidate.y_mm, candidate.z_mm))
        assert i == pytest.approx(candidate.voxel_i, abs=1e-6)
        assert j == pytest.approx(candidate.voxel_j, abs=1e-6)
        assert k == candidate.position_index


def test_the_reviewable_slice_is_recorded_not_inferred():
    volume = volume_for(count=8)
    prepared, _ = prepare_volume(volume)
    result = detect_candidates(
        volume, prepared, full_mask(volume), config=small_config(), detector=ConstantDetector()
    )
    for candidate in result.candidates:
        assert 0 <= candidate.position_index < volume.shape[0]


def test_the_threshold_excludes_positions_below_it():
    volume = volume_for()
    prepared, _ = prepare_volume(volume)

    quiet = detect_candidates(
        volume, prepared, full_mask(volume),
        config=small_config(score_threshold=0.95), detector=ConstantDetector(score=0.9),
    )
    loud = detect_candidates(
        volume, prepared, full_mask(volume),
        config=small_config(score_threshold=0.5), detector=ConstantDetector(score=0.9),
    )
    assert quiet.candidates == []
    assert loud.candidates


def test_the_score_is_named_for_what_it_is():
    """No field a malignancy could be written into."""
    candidate = Candidate(voxel_i=1, voxel_j=2, voxel_k=3, x_mm=0, y_mm=0, z_mm=0, score_raw=0.7)
    record = candidate.as_dict()

    assert "scoreRaw" in record and "scoreCalibrated" in record
    for forbidden in ("malignant", "cancer", "risk", "diagnosis", "priority"):
        assert not any(forbidden in key.lower() for key in record), forbidden


def test_an_uncalibrated_candidate_says_so_rather_than_reusing_the_raw_score():
    candidate = Candidate(voxel_i=0, voxel_j=0, voxel_k=0, x_mm=0, y_mm=0, z_mm=0, score_raw=0.8)
    assert candidate.as_dict()["scoreCalibrated"] is None


# ── merging ────────────────────────────────────────────────────────────────

def _at(x, y, z, score):
    return Candidate(voxel_i=x, voxel_j=y, voxel_k=int(z), x_mm=x, y_mm=y, z_mm=z,
                     score_raw=score)


def test_two_detections_of_one_thing_merge_into_the_stronger():
    merged = merge_candidates([_at(0, 0, 0, 0.6), _at(2, 0, 0, 0.9)], radius_mm=8.0,
                              max_candidates=100)
    assert len(merged) == 1
    assert merged[0].score_raw == 0.9
    assert merged[0].merged_from == 2


def test_two_genuinely_separate_findings_both_survive():
    merged = merge_candidates([_at(0, 0, 0, 0.9), _at(50, 0, 0, 0.8)], radius_mm=8.0,
                              max_candidates=100)
    assert len(merged) == 2


def test_merging_is_in_millimetres_not_voxels():
    """The radius must not change meaning with the acquisition's spacing."""
    near = merge_candidates([_at(0, 0, 0, 0.9), _at(0, 0, 7.5, 0.8)], radius_mm=8.0,
                            max_candidates=100)
    far = merge_candidates([_at(0, 0, 0, 0.9), _at(0, 0, 9.0, 0.8)], radius_mm=8.0,
                           max_candidates=100)
    assert len(near) == 1
    assert len(far) == 2


def test_merging_is_deterministic_for_tied_scores():
    tied = [_at(0, 0, 0, 0.7), _at(40, 0, 0, 0.7), _at(80, 0, 0, 0.7)]
    first = [c.as_dict() for c in merge_candidates(tied, 8.0, 100)]
    for _ in range(4):
        assert [c.as_dict() for c in merge_candidates(list(reversed(tied)), 8.0, 100)] == first


def test_the_candidate_list_is_capped():
    many = [_at(i * 40, 0, 0, 0.9) for i in range(50)]
    assert len(merge_candidates(many, 8.0, max_candidates=10)) == 10


def test_an_over_full_study_says_so_rather_than_quietly_truncating():
    volume = volume_for()
    prepared, _ = prepare_volume(volume)
    result = detect_candidates(
        volume, prepared, full_mask(volume),
        config=small_config(merge_radius_mm=0.001, max_candidates=5),
        detector=ConstantDetector(),
    )
    assert len(result.candidates) == 5
    assert any("capped at 5" in w for w in result.warnings)


# ── contract and determinism ───────────────────────────────────────────────

def test_a_detector_returning_the_wrong_number_of_scores_is_refused():
    volume = volume_for()
    prepared, _ = prepare_volume(volume)

    with pytest.raises(DetectorUnavailable) as raised:
        detect_candidates(volume, prepared, full_mask(volume), config=small_config(),
                          detector=BrokenDetector())
    assert raised.value.code == "detector_contract_violated"


def test_repeated_runs_over_one_volume_are_identical():
    volume = volume_for()
    prepared, _ = prepare_volume(volume)
    runs = [
        detect_candidates(volume, prepared, full_mask(volume), config=small_config(),
                          detector=ConstantDetector()).as_dict()
        for _ in range(3)
    ]
    assert all(run == runs[0] for run in runs)


def test_the_result_records_the_model_and_the_search_parameters():
    volume = volume_for()
    prepared, _ = prepare_volume(volume)
    result = detect_candidates(
        volume, prepared, full_mask(volume), config=small_config(), detector=ConstantDetector()
    )
    record = result.as_dict()

    assert record["detectorVersion"] == "synthetic-constant-v0"
    assert record["config"]["fingerprint"]
    assert record["coordinateSystem"] == "dicom_patient_lps"
    assert record["positionsScored"] > 0


def test_the_config_fingerprint_changes_with_any_parameter():
    base = DEFAULT_DETECTION_CONFIG
    for changed in (
        DetectionConfig(patch_px=32),
        DetectionConfig(stride_px=8),
        DetectionConfig(score_threshold=0.7),
        DetectionConfig(merge_radius_mm=4.0),
    ):
        assert changed.fingerprint() != base.fingerprint()


def test_registering_a_detector_makes_it_visible_to_the_status():
    register_detector(ConstantDetector())
    status = detector_status()
    assert status["available"] is True
    assert status["version"] == "synthetic-constant-v0"
