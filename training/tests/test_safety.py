"""
The boundaries the harness must not cross, pinned.

  - the configuration cannot claim an approval the repository does not record,
    and cannot enable a transform or a split the harness refuses;
  - the test and calibration splits cannot reach the training loader;
  - calibration fits only on the calibration split, and a missing calibration
    is None — never the raw score renamed;
  - OOD refusal, inference failure and zero candidates stay four distinct
    outcomes, consistent with inference/detection_eval.py;
  - training changes nothing in the service: the detector slot stays empty,
    the capability stays PLANNED, the legacy lung model is never touched, and
    inference/ never imports training/.
"""
from __future__ import annotations

import ast
import copy
import glob
import json
import os

import pytest

from training import _paths
from training import calibration as cal
from training import config as config_module
from training import dataset as ds
from training import manifest as mf
from training import ood

ROOT = _paths.ROOT


# ── configuration refusals ─────────────────────────────────────────────────

def mutated(config, path, value):
    changed = copy.deepcopy(config)
    node = changed
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    return changed


@pytest.mark.parametrize("path,value,expect", [
    (("governance", "localization_methodology_status"), "APPROVED", "repository records"),
    (("governance", "performance_bar_status"), "APPROVED", "repository records"),
    (("governance", "luna16"), "INTEGRATED", "LUNA16"),
    (("data", "fit_split"), "test", "fit_split"),
    (("data", "select_split"), "test", "select_split"),
    (("data", "expected_split_fingerprint"), "", "pin"),
    (("augmentation", "flip"), True, "mirrors"),
    (("augmentation", "scale"), True, "physical size"),
    (("augmentation", "max_rotation_deg"), 90.0, "max_rotation_deg"),
    (("augmentation", "max_shift_px"), 12, "positive_centre_jitter_px"),
    (("preprocessing", "hu_max"), 1000.0, "does not match the service"),
    (("preprocessing", "resample_slice_spacing_mm"), 1.0, "resample"),
    (("patch", "patch_px"), 96, "does not match the service"),
    (("target", "meaning"), "probability of malignancy", "marked location"),
    (("target", "meaning"), "cancer present here", "marked location"),
    (("optimisation", "selection_metric"), "test_sensitivity", "validation_loss"),
    (("sampling", "negatives_within_lung_mask"), False, "lung_mask"),
])
def test_the_configuration_refuses(training_config, path, value, expect):
    problems = config_module.validate(mutated(training_config, path, value))
    assert problems, "accepted %s = %r" % (".".join(path), value)
    assert any(expect in problem for problem in problems), problems


def test_an_unknown_section_is_refused_not_ignored(training_config):
    changed = copy.deepcopy(training_config)
    changed["evaluation"] = {"tolerance_mm": 5.0}
    assert any("unknown" in p for p in config_module.validate(changed))


def test_the_shipped_configuration_is_valid_and_marked_as_engineering_defaults(training_config):
    assert config_module.validate(training_config) == []
    assert training_config["status"] == "INITIAL_ENGINEERING_DEFAULT"


def test_the_configuration_contains_no_localisation_tolerance():
    """Training does not need one, and no experiment may carry an invented one."""
    with open(_paths.DEFAULT_CONFIG, encoding="utf-8") as handle:
        text = handle.read().lower()
    for word in ("match_radius", "matching_radius", "localisation_tolerance", "localization_tolerance",
                 "tolerance_mm"):
        assert word not in text


# ── the repository's governance record is unchanged ────────────────────────

def test_the_localisation_methodology_is_still_pending():
    assert config_module.repository_governance()["localization_methodology_status"] == "PENDING"


def test_the_performance_bar_is_still_not_approved():
    with open(_paths.BAR, encoding="utf-8") as handle:
        bar = json.load(handle)
    assert bar["status"] == "DRAFT_NOT_APPROVED"
    assert bar["proposedGate"]["approval"]["approved"] is False
    assert bar["metrics"]["localisationTolerance"]["status"] == "BLOCKED"


def test_the_detection_capability_is_still_planned():
    with open(os.path.join(ROOT, "server", "capabilities.ts"), encoding="utf-8") as handle:
        text = handle.read()
    block = text[text.index("id: 'lung-nodule-detection'"):]
    block = block[:block.index("}")]
    assert "status: 'PLANNED'" in block


# ── split protection ───────────────────────────────────────────────────────

@pytest.mark.parametrize("split", ["test", "calibration", "validation"])
def test_the_training_dataset_refuses_every_split_but_train(training_config, split):
    with pytest.raises(mf.SplitAccessDenied):
        ds.TrainingDataset(split=split)


def test_a_legitimate_evaluation_set_cannot_be_served_to_training(training_config):
    evaluation = ds.synthetic_sample_set(training_config, "test", mf.PURPOSE_EVALUATE, count=4)
    with pytest.raises(mf.SplitAccessDenied):
        ds.PatchDataset(evaluation, mf.PURPOSE_FIT, patch_px=64, augment_config=None)
    with pytest.raises(mf.SplitAccessDenied):
        ds.PatchDataset(evaluation, mf.PURPOSE_EVALUATE, patch_px=64, augment_config=None)


def test_a_sample_set_cannot_be_built_for_the_wrong_purpose(training_config):
    with pytest.raises(mf.SplitAccessDenied):
        ds.synthetic_sample_set(training_config, "test", mf.PURPOSE_FIT)


def test_the_lidc_builder_refuses_the_test_split_before_reading_anything(training_config):
    with pytest.raises(mf.SplitAccessDenied):
        ds.build_lidc_sample_set(training_config, "test", mf.PURPOSE_FIT, verified={}, available=[],
                                 series_index={}, exclusions={})


def test_validation_is_never_augmented(training_config):
    from training import augment as aug

    val = ds.synthetic_sample_set(training_config, "validation", mf.PURPOSE_SELECT, count=4)
    config = aug.AugmentConfig.from_config(training_config["augmentation"], training_config["preprocessing"])
    dataset = ds.PatchDataset(val, mf.PURPOSE_SELECT, patch_px=64, augment_config=config)
    assert dataset.augment_config is None


# ── calibration ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("split", ["train", "validation", "test"])
def test_calibration_fits_only_on_the_calibration_split(split):
    with pytest.raises(mf.SplitAccessDenied):
        cal.fit_temperature([1.0, -1.0], [1, 0], split=split, checkpoint_weights_sha256="a" * 64)


def test_the_temperature_fit_recovers_a_known_temperature():
    """Synthetic logits drawn from a model with true temperature 2.5."""
    import numpy as np

    rng = np.random.default_rng(0)
    true_logits = rng.normal(0.0, 2.0, 20000)
    labels = (rng.random(20000) < 1.0 / (1.0 + np.exp(-true_logits))).astype(int)
    record = cal.fit_temperature(true_logits * 2.5, labels, split="calibration",
                                 checkpoint_weights_sha256="a" * 64)
    assert record.temperature == pytest.approx(2.5, rel=0.05)
    assert record.fitted_on_split == "calibration"
    assert len(record.fingerprint) == 64


def test_no_calibration_means_no_calibrated_score():
    assert cal.calibrated_score(3.0, None) is None


def test_a_calibration_must_name_its_checkpoint():
    with pytest.raises(cal.CalibrationRefused):
        cal.fit_temperature([1.0, -1.0], [1, 0], split="calibration", checkpoint_weights_sha256="")


def test_calibration_status_is_not_performed():
    assert cal.CALIBRATION_STATUS.startswith("NOT PERFORMED")


# ── OOD ────────────────────────────────────────────────────────────────────

def test_there_is_no_detector_ood_screen():
    assert ood.current_screen() is None
    with pytest.raises(ood.DetectorOodUnavailable):
        ood.require_screen()


def test_the_four_outcomes_are_distinct():
    assert ood.classify(ood_refused=True, failed=False, candidate_count=None) == ood.OOD_REFUSED
    assert ood.classify(ood_refused=False, failed=True, candidate_count=None) == ood.INFERENCE_FAILED
    assert ood.classify(ood_refused=False, failed=False, candidate_count=0) == ood.ZERO_CANDIDATES
    assert ood.classify(ood_refused=False, failed=False, candidate_count=3) == ood.CANDIDATES_PROPOSED
    assert len(set(ood.OUTCOMES)) == 4


def test_a_searched_series_must_report_a_count_including_zero():
    """NULL is not zero: a missing count cannot be read as 'searched, nothing found'."""
    with pytest.raises(ValueError):
        ood.classify(ood_refused=False, failed=False, candidate_count=None)


def test_ood_outcomes_map_onto_the_evaluators_states():
    """A refused or failed series is never 'evaluated' in the FROC denominators."""
    import detection_eval

    assert ood.outcome_for_evaluation(ood.OOD_REFUSED) == detection_eval.OUTCOME_REFUSED_OOD
    assert ood.outcome_for_evaluation(ood.INFERENCE_FAILED) == detection_eval.OUTCOME_FAILED
    assert ood.outcome_for_evaluation(ood.ZERO_CANDIDATES) == detection_eval.OUTCOME_EVALUATED
    for outcome in ood.OUTCOMES:
        assert ood.outcome_for_evaluation(outcome) in detection_eval.SCAN_OUTCOMES


def test_the_evaluator_still_refuses_without_an_approved_rule():
    import detection_eval

    with pytest.raises(detection_eval.MethodologyUndecided):
        detection_eval.rule_from_bar()


# ── nothing leaks into the service ─────────────────────────────────────────

def _imports(path):
    with open(path, encoding="utf-8") as handle:
        tree = ast.parse(handle.read())
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def test_inference_never_imports_training():
    offenders = []
    for path in glob.glob(os.path.join(ROOT, "inference", "*.py")):
        if any(name == "training" or name.startswith("training.") for name in _imports(path)):
            offenders.append(os.path.basename(path))
    assert offenders == []


def test_training_never_touches_the_legacy_lung_model():
    forbidden = ("lung_cancer_MRI_dataset", "resnet50v2_lung_cancer_model", "lung-cancer-service",
                 "lung_cancer_service", "infer_lung(")
    for path in glob.glob(os.path.join(ROOT, "training", "*.py")) + \
            [os.path.join(ROOT, "scripts", "train_lung_detector.py")]:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        for word in forbidden:
            assert word not in text, "%s references %s" % (os.path.basename(path), word)


def test_training_does_not_register_a_detector(training_config, tmp_path):
    """After a full synthetic run the service's detector slot is still empty."""
    import detection_service

    from training import environment as env
    from training import trainer

    config = copy.deepcopy(training_config)
    config["model"]["widths"] = [4, 8]
    config["optimisation"]["epochs"] = 1
    report = env.probe()
    trainer.train(
        config=config,
        train_set=ds.synthetic_sample_set(config, "train", mf.PURPOSE_FIT, count=16),
        val_set=ds.synthetic_sample_set(config, "validation", mf.PURPOSE_SELECT, count=8),
        device="cpu", artifact_root=str(tmp_path),
        dataset_fingerprint={"fingerprint": "synthetic", "parts": {}}, split_fingerprint="synthetic",
        environment=report, environment_fingerprint=env.environment_fingerprint(report),
        config_fingerprint=config_module.fingerprint(config),
        preprocessing_fingerprint="x")
    assert detection_service.registered_detector() is None
    assert detection_service.detector_status()["available"] is False


def test_nothing_is_written_under_inference_or_dataset(training_config, tmp_path):
    """Checkpoints go to the artifact tree the caller names, never next to the service."""
    before = set(glob.glob(os.path.join(ROOT, "inference", "**", "*.pt"), recursive=True))
    test_training_does_not_register_a_detector(training_config, tmp_path)
    after = set(glob.glob(os.path.join(ROOT, "inference", "**", "*.pt"), recursive=True))
    assert after == before
    assert glob.glob(os.path.join(str(tmp_path), "experiments", "*", "checkpoints", "*.pt"))


def test_the_candidate_score_is_never_called_a_probability_of_disease():
    for path in glob.glob(os.path.join(ROOT, "training", "*.py")):
        with open(path, encoding="utf-8") as handle:
            text = handle.read().lower()
        for phrase in ("cancer probability", "malignancy probability", "risk score", "probability of cancer"):
            for line in text.splitlines():
                if phrase in line:
                    assert "not" in line, "%s: %r" % (os.path.basename(path), line.strip())
