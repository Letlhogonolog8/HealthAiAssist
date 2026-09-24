"""
The training loop on synthetic data: it runs, it reproduces, it resumes, and
it refuses.

Every run here trains on `dataset.synthetic_sample_set` — Gaussian blobs on
noise — on CPU, into a pytest temporary directory. The checkpoints are
TEST_ARTIFACTs. The reproducibility checks establish that the *harness* is
deterministic on CPU for a fixed seed; they say nothing about bitwise
determinism on a GPU, which docs/P2_TRAINING_READINESS.md does not claim.
"""
from __future__ import annotations

import copy
import json
import os
import re

import pytest

from training import checkpoint as ckpt
from training import dataset as ds
from training import environment as env
from training import experiment as xp
from training import manifest as mf
from training import trainer


def small_config(training_config):
    config = copy.deepcopy(training_config)
    config["model"]["widths"] = [8, 16]
    config["optimisation"]["batch_size"] = 16
    config["optimisation"]["early_stopping_patience"] = 50
    return config


def sets(config, count=48):
    return (ds.synthetic_sample_set(config, "train", mf.PURPOSE_FIT, count=count, seed=1),
            ds.synthetic_sample_set(config, "validation", mf.PURPOSE_SELECT, count=16, seed=2))


def run(config, root, epochs, resume_from=None, train_set=None, val_set=None, device="cpu",
        stop_after_epochs=None):
    """`epochs` is written into the configuration, so it is fingerprinted."""
    from training import config as training_config

    config = copy.deepcopy(config)
    config["optimisation"]["epochs"] = epochs
    report = env.probe()
    if train_set is None:
        train_set, val_set = sets(config)
    return trainer.train(
        config=config, train_set=train_set, val_set=val_set, device=device, artifact_root=str(root),
        dataset_fingerprint={"fingerprint": "synthetic-test-artifact", "parts": {"label": ds.SYNTHETIC_LABEL}},
        split_fingerprint="synthetic", environment=report,
        environment_fingerprint=env.environment_fingerprint(report),
        config_fingerprint=training_config.fingerprint(config),
        preprocessing_fingerprint="detect-hu-v1:test", stop_after_epochs=stop_after_epochs,
        resume_from=resume_from,
    )


# ── it runs ────────────────────────────────────────────────────────────────

def test_synthetic_training_completes_and_writes_its_records(training_config, tmp_path):
    result = run(small_config(training_config), tmp_path, epochs=2)
    record = result["experiment"]
    assert record["status"] == xp.STATUS_COMPLETED
    assert len(record["epochs"]) == 2
    assert os.path.exists(result["best"]) and os.path.exists(result["last"])
    assert os.path.exists(os.path.join(result["directory"], "manifest.json"))


def test_the_checkpoint_is_a_test_artifact_and_reloads(training_config, tmp_path):
    result = run(small_config(training_config), tmp_path, epochs=1)
    record = ckpt.load(result["last"])
    assert record["status"] == ckpt.STATUS_TEST_ARTIFACT
    assert record["metadata"]["label"] == ds.SYNTHETIC_LABEL
    for key in ckpt.REQUIRED_METADATA:
        assert record["metadata"][key] not in (None, "")


def test_losses_are_finite_and_the_weights_move(training_config, tmp_path):
    import math

    import torch

    from training import model as mdl

    config = small_config(training_config)
    torch.manual_seed(config["optimisation"]["seed"])
    initial = ckpt.weights_fingerprint(mdl.build(config).state_dict())
    result = run(config, tmp_path, epochs=2)
    for epoch in result["experiment"]["epochs"]:
        assert math.isfinite(epoch["trainLoss"]) and math.isfinite(epoch["validationLoss"])
    assert ckpt.load(result["last"])["weights_fingerprint"] != initial


def test_the_manifest_records_every_required_field(training_config, tmp_path):
    record = run(small_config(training_config), tmp_path, epochs=1)["experiment"]
    for key in ("experiment_id", "git", "dataset_fingerprint", "split_fingerprint", "label_version",
                "model_version", "model_fingerprint", "preprocessing_version",
                "preprocessing_fingerprint", "augmentation_version", "training_config",
                "training_config_fingerprint", "seed", "hardware", "environment",
                "environment_fingerprint", "checkpoint"):
        assert key in record, key
    assert record["governance"]["localization_methodology_status"] == "PENDING"
    assert record["governance"]["checkpoint_status_on_completion"] == "TEST_ARTIFACT"


def test_the_manifest_carries_nothing_identifying(training_config, tmp_path):
    """No DICOM UIDs, no LIDC patient ids, no host name."""
    import platform

    result = run(small_config(training_config), tmp_path, epochs=1)
    with open(os.path.join(result["directory"], "manifest.json"), encoding="utf-8") as handle:
        text = handle.read()
    assert not re.search(r"\b\d+(\.\d+){6,}\b", text), "something shaped like a DICOM UID"
    assert "LIDC-IDRI-" not in text
    host = platform.node()
    if len(host) >= 6:        # a very short host name could collide with ordinary text
        assert host not in text


# ── it reproduces ──────────────────────────────────────────────────────────

def test_the_same_seed_and_data_give_the_same_weights(training_config, tmp_path):
    config = small_config(training_config)
    a = run(config, tmp_path / "a", epochs=2)
    b = run(config, tmp_path / "b", epochs=2)
    assert ckpt.load(a["last"])["weights_fingerprint"] == ckpt.load(b["last"])["weights_fingerprint"]
    assert [e["trainLoss"] for e in a["experiment"]["epochs"]] == \
        [e["trainLoss"] for e in b["experiment"]["epochs"]]


def test_a_different_seed_gives_different_weights(training_config, tmp_path):
    config = small_config(training_config)
    other = copy.deepcopy(config)
    other["optimisation"]["seed"] = config["optimisation"]["seed"] + 1
    a = run(config, tmp_path / "a", epochs=1)
    b = run(other, tmp_path / "b", epochs=1)
    assert ckpt.load(a["last"])["weights_fingerprint"] != ckpt.load(b["last"])["weights_fingerprint"]


def test_a_resumed_run_ends_where_an_uninterrupted_one_does(training_config, tmp_path):
    """A two-epoch run straight through, against the same two-epoch run paused
    after one epoch and resumed. Same configuration, so the same schedule."""
    config = small_config(training_config)
    straight = run(config, tmp_path / "straight", epochs=2)
    first = run(config, tmp_path / "resumed", epochs=2, stop_after_epochs=1)
    assert first["experiment"]["status"] == xp.STATUS_PAUSED
    assert len(first["experiment"]["epochs"]) == 1
    resumed = run(config, tmp_path / "resumed", epochs=2, resume_from=first["last"])
    assert resumed["experiment"]["status"] == xp.STATUS_COMPLETED
    assert ckpt.load(resumed["last"])["weights_fingerprint"] == \
        ckpt.load(straight["last"])["weights_fingerprint"]
    assert resumed["experiment"]["experiment_id"] == first["experiment"]["experiment_id"]


def test_a_fingerprint_that_does_not_describe_the_config_is_refused(training_config, tmp_path):
    """The configuration a checkpoint records must be the one it was trained under."""
    from training import config as training_config_module

    config = small_config(training_config)
    train_set, val_set = sets(config)
    report = env.probe()
    with pytest.raises(trainer.TrainingRefused, match="does not match"):
        trainer.train(
            config=config, train_set=train_set, val_set=val_set, device="cpu",
            artifact_root=str(tmp_path), dataset_fingerprint={"fingerprint": "x", "parts": {}},
            split_fingerprint="x", environment=report,
            environment_fingerprint=env.environment_fingerprint(report),
            config_fingerprint=training_config_module.fingerprint(training_config),
            preprocessing_fingerprint="x")


def test_resuming_under_a_different_configuration_is_refused(training_config, tmp_path):
    config = small_config(training_config)
    first = run(config, tmp_path, epochs=1)
    changed = copy.deepcopy(config)
    changed["optimisation"]["learning_rate"] = 0.1
    with pytest.raises(trainer.TrainingRefused, match="training_config_fingerprint"):
        run(changed, tmp_path, epochs=2, resume_from=first["last"])


@pytest.mark.parametrize("method", ["none", "pos_weight", "weighted_sampler"])
def test_every_balancing_method_trains(training_config, tmp_path, method):
    config = small_config(training_config)
    config["balancing"]["method"] = method
    assert run(config, tmp_path, epochs=1)["experiment"]["status"] == xp.STATUS_COMPLETED


def test_early_stopping_stops(training_config, tmp_path):
    """Validation labels inverted: the better the model learns the training
    set, the worse its validation loss — so with patience 1 the run must stop
    after its second epoch."""
    config = small_config(training_config)
    config["optimisation"]["early_stopping_patience"] = 1
    train_set, val_set = sets(config)
    val_set.labels[:] = 1 - val_set.labels
    record = run(config, tmp_path, epochs=12, train_set=train_set, val_set=val_set)["experiment"]
    assert record["status"] == xp.STATUS_STOPPED_EARLY
    epochs = record["epochs"]
    assert len(epochs) < 12
    # The rule itself: it stops exactly `patience` epochs after the last improvement.
    last_improved = max(e["epoch"] for e in epochs if e["improved"])
    assert epochs[-1]["epoch"] - last_improved == config["optimisation"]["early_stopping_patience"]
    assert not epochs[-1]["improved"]


# ── it refuses ─────────────────────────────────────────────────────────────

def test_lidc_data_on_cpu_is_refused(training_config, tmp_path):
    config = small_config(training_config)
    train_set, val_set = sets(config)
    train_set.kind = val_set.kind = ds.KIND_LIDC
    with pytest.raises(trainer.TrainingRefused, match="CUDA"):
        run(config, tmp_path, epochs=1, train_set=train_set, val_set=val_set, device="cpu")


def test_the_test_split_cannot_be_the_training_set(training_config, tmp_path):
    config = small_config(training_config)
    _train, val_set = sets(config)
    test_set = ds.synthetic_sample_set(config, "test", mf.PURPOSE_EVALUATE, count=16)
    with pytest.raises(trainer.TrainingRefused):
        run(config, tmp_path, epochs=1, train_set=test_set, val_set=val_set)


def test_the_calibration_split_cannot_be_the_training_set(training_config, tmp_path):
    config = small_config(training_config)
    _train, val_set = sets(config)
    calibration = ds.synthetic_sample_set(config, "calibration", mf.PURPOSE_CALIBRATE, count=16)
    with pytest.raises(trainer.TrainingRefused):
        run(config, tmp_path, epochs=1, train_set=calibration, val_set=val_set)


def test_the_test_split_cannot_be_the_validation_set(training_config, tmp_path):
    config = small_config(training_config)
    train_set, _val = sets(config)
    test_set = ds.synthetic_sample_set(config, "test", mf.PURPOSE_EVALUATE, count=16)
    with pytest.raises(trainer.TrainingRefused):
        run(config, tmp_path, epochs=1, train_set=train_set, val_set=test_set)


def test_synthetic_and_lidc_cannot_be_mixed(training_config, tmp_path):
    config = small_config(training_config)
    train_set, val_set = sets(config)
    val_set.kind = ds.KIND_LIDC
    with pytest.raises(trainer.TrainingRefused, match="different kinds"):
        run(config, tmp_path, epochs=1, train_set=train_set, val_set=val_set)


def test_a_training_set_without_both_classes_is_refused(training_config, tmp_path):
    config = small_config(training_config)
    train_set, val_set = sets(config)
    train_set.labels[:] = 0
    with pytest.raises(trainer.TrainingRefused, match="both positives and negatives"):
        run(config, tmp_path, epochs=1, train_set=train_set, val_set=val_set)
