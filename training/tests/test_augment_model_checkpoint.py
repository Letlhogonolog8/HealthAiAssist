"""
Augmentation, the model architecture and checkpoints.

Augmentation is tested against the pixels, not against its own arithmetic: a
bright point is placed where the target is, the transform is applied, and the
point is found again in the output. If the returned target coordinate and the
point disagree, the label has come loose from the image.

Every model and checkpoint here is untrained or trained on synthetic data. None
of it is a detector.
"""
from __future__ import annotations

import os

import numpy as np
import pytest
import torch

from training import augment as aug
from training import checkpoint as ckpt
from training import model as mdl


def augment_config(**overrides):
    values = dict(enabled=True, seed=7, max_shift_px=4, max_rotation_deg=10.0,
                  hu_offset_max=0.0, contrast_scale_max=0.0, noise_sigma_hu=0.0, hu_span=1400.0)
    values.update(overrides)
    return aug.AugmentConfig(**values)


def context_with_point(side=100, channels=3, at=None):
    context = np.full((channels, side, side), 0.1, dtype=np.float32)
    r, c = at if at is not None else (side // 2, side // 2)
    context[:, r - 1:r + 2, c - 1:c + 2] = 1.0     # a 3x3 bright spot, robust to interpolation
    return context, (float(r), float(c))


# ── augmentation ───────────────────────────────────────────────────────────

def test_the_same_seed_epoch_and_index_give_the_same_patch():
    context, target = context_with_point()
    config = augment_config(noise_sigma_hu=10.0, hu_offset_max=20.0, contrast_scale_max=0.05)
    a = aug.apply(context, target, 64, config, epoch=3, index=11)
    b = aug.apply(context, target, 64, config, epoch=3, index=11)
    assert np.array_equal(a[0], b[0]) and a[1] == b[1]


def test_a_different_epoch_gives_a_different_transform():
    context, target = context_with_point()
    config = augment_config(noise_sigma_hu=10.0)
    assert not np.array_equal(aug.apply(context, target, 64, config, 0, 5)[0],
                              aug.apply(context, target, 64, config, 1, 5)[0])


def test_the_returned_target_is_where_the_target_went():
    """An off-centre spot under rotation and shift, 200 draws: the spot's
    intensity-weighted centroid in the output must sit on the returned target.

    Centroid rather than argmax: bilinear rotation smears the spot across
    pixels, and argmax rounds a sub-pixel position to the nearest integer —
    which once reported a 1.1 px "error" on a transform that was exact to 0.01.
    """
    rows, cols = np.mgrid[0:64, 0:64]
    worst = 0.0
    for epoch in range(5):
        for index in range(40):
            context, target = context_with_point(at=(56, 45))
            patch, moved, _params = aug.apply(context, target, 64, augment_config(), epoch, index)
            weight = np.clip(patch[0] - 0.1, 0.0, None)
            centroid = ((weight * rows).sum() / weight.sum(), (weight * cols).sum() / weight.sum())
            worst = max(worst, abs(centroid[0] - moved[0]), abs(centroid[1] - moved[1]))
    assert worst < 0.05, "target drifted %.3f px from the pixels" % worst


def test_the_channels_are_transformed_together():
    """They are adjacent slices of one location; one rotation, one shift."""
    context, target = context_with_point()
    patch, _moved, _p = aug.apply(context, target, 64, augment_config(), 2, 9)
    assert np.array_equal(patch[0], patch[1]) and np.array_equal(patch[1], patch[2])


def test_disabled_augmentation_is_the_exact_centre_crop():
    context, target = context_with_point()
    patch, moved, params = aug.apply(context, target, 64, augment_config(enabled=False), 0, 0)
    assert np.array_equal(patch, aug.centre_crop(context, 64))
    assert params == {}
    assert moved == (target[0] - 18, target[1] - 18)


def test_the_output_stays_in_the_normalised_range():
    context, target = context_with_point()
    patch, _m, _p = aug.apply(context, target, 64,
                              augment_config(noise_sigma_hu=200.0, hu_offset_max=300.0,
                                             contrast_scale_max=0.4), 0, 0)
    assert patch.min() >= 0.0 and patch.max() <= 1.0


@pytest.mark.parametrize("overrides", [
    {"flip": True},
    {"scale": True},
    {"max_rotation_deg": 45.0},
    {"max_shift_px": -1},
    {"hu_span": 0.0},
])
def test_inappropriate_transforms_are_refused(overrides):
    with pytest.raises(aug.AugmentationRefused):
        augment_config(**overrides)


def test_a_context_too_small_for_the_transform_is_refused():
    context, target = context_with_point(side=68)
    with pytest.raises(aug.AugmentationRefused):
        aug.apply(context, target, 64, augment_config(), 0, 0)


# ── the model ──────────────────────────────────────────────────────────────

def test_the_model_builds_from_the_configuration(training_config):
    model = mdl.build(training_config)
    assert model.spec()["architecture"] == mdl.ARCHITECTURE
    assert mdl.parameter_count(model) == 1173473


def test_a_forward_pass_gives_one_logit_per_patch(training_config):
    model = mdl.build(training_config).eval()
    assert tuple(model(torch.zeros(5, 3, 64, 64)).shape) == (5,)


def test_the_model_meets_the_services_detector_contract(training_config):
    """score_batch takes (N, channels, patch, patch) and returns N scores."""
    from detection_service import DetectionConfig

    service = DetectionConfig()
    model = mdl.build(training_config)
    scores = mdl.candidate_scores(model, torch.rand(4, service.channels, service.patch_px, service.patch_px))
    assert tuple(scores.shape) == (4,)
    assert float(scores.min()) >= 0.0 and float(scores.max()) <= 1.0


@pytest.mark.parametrize("shape", [(2, 1, 64, 64), (2, 3, 32, 32), (3, 64, 64)])
def test_a_wrongly_shaped_input_is_refused(training_config, shape):
    with pytest.raises(mdl.ModelInvalid):
        mdl.build(training_config)(torch.zeros(*shape))


def test_invalid_architectures_are_refused():
    with pytest.raises(mdl.ModelInvalid):
        mdl.LungNoduleCandidateNet(channels=2)
    with pytest.raises(mdl.ModelInvalid):
        mdl.LungNoduleCandidateNet(patch_px=60, widths=(8, 8, 8))
    with pytest.raises(mdl.ModelInvalid):
        mdl.LungNoduleCandidateNet(widths=())


def test_the_architecture_fingerprint_describes_the_network_not_its_weights(training_config):
    a = mdl.build(training_config)
    b = mdl.build(training_config)
    with torch.no_grad():
        next(b.parameters()).add_(1.0)
    assert mdl.architecture_fingerprint(a) == mdl.architecture_fingerprint(b)
    wider = mdl.LungNoduleCandidateNet(widths=(32, 64, 128, 512))
    assert mdl.architecture_fingerprint(wider) != mdl.architecture_fingerprint(a)


# ── checkpoints ────────────────────────────────────────────────────────────

def metadata(**overrides):
    values = dict((key, "value-%s" % key) for key in ckpt.REQUIRED_METADATA)
    values.update(seed=1, epoch=0)
    values.update(overrides)
    return values


def small_model():
    torch.manual_seed(0)
    return mdl.LungNoduleCandidateNet(widths=(4, 8))


def test_the_same_weights_give_the_same_fingerprint(tmp_path):
    model = small_model()
    path = str(tmp_path / "a.pt")
    ckpt.save(path, model=model, optimizer=None, scheduler=None,
              status=ckpt.STATUS_TEST_ARTIFACT, metadata=metadata())
    first = ckpt.load(path)["weights_fingerprint"]
    assert first == ckpt.weights_fingerprint(model.state_dict())
    assert first == ckpt.load(path)["weights_fingerprint"]


def test_a_renamed_file_keeps_its_fingerprint(tmp_path):
    model = small_model()
    a, b = str(tmp_path / "a.pt"), str(tmp_path / "renamed.pt")
    ckpt.save(a, model=model, optimizer=None, scheduler=None, status=ckpt.STATUS_TEST_ARTIFACT,
              metadata=metadata())
    os.rename(a, b)
    assert ckpt.load(b)["weights_fingerprint"] == ckpt.weights_fingerprint(model.state_dict())


def test_changed_weights_give_a_different_fingerprint():
    model = small_model()
    before = ckpt.weights_fingerprint(model.state_dict())
    with torch.no_grad():
        model.head.bias.add_(1e-6)
    assert ckpt.weights_fingerprint(model.state_dict()) != before


def test_weights_that_no_longer_match_their_record_are_refused(tmp_path):
    model = small_model()
    path = str(tmp_path / "a.pt")
    ckpt.save(path, model=model, optimizer=None, scheduler=None, status=ckpt.STATUS_TEST_ARTIFACT,
              metadata=metadata())
    record = torch.load(path, weights_only=True)
    record["model_state"]["head.bias"] += 1.0
    torch.save(record, path)
    os.remove(path + ".sha256.json")          # so the weights check, not the sidecar, is what fires
    with pytest.raises(ckpt.CheckpointInvalid, match="do not match"):
        ckpt.load(path)


def test_a_file_that_no_longer_matches_its_sidecar_is_refused(tmp_path):
    model = small_model()
    path = str(tmp_path / "a.pt")
    ckpt.save(path, model=model, optimizer=None, scheduler=None, status=ckpt.STATUS_TEST_ARTIFACT,
              metadata=metadata())
    # Alter the recorded file hash, so the weights still verify and only the
    # sidecar comparison can be what refuses.
    import json

    sidecar = path + ".sha256.json"
    with open(sidecar, encoding="utf-8") as handle:
        record = json.load(handle)
    record["fileSha256"] = "0" * 64
    with open(sidecar, "w", encoding="utf-8") as handle:
        json.dump(record, handle)
    with pytest.raises(ckpt.CheckpointInvalid, match="sidecar"):
        ckpt.load(path)


def test_incomplete_metadata_is_refused_at_save(tmp_path):
    incomplete = metadata()
    del incomplete["dataset_fingerprint"]
    with pytest.raises(ckpt.CheckpointInvalid, match="dataset_fingerprint"):
        ckpt.save(str(tmp_path / "a.pt"), model=small_model(), optimizer=None, scheduler=None,
                  status=ckpt.STATUS_TEST_ARTIFACT, metadata=incomplete)


@pytest.mark.parametrize("status", [ckpt.STATUS_VALIDATED_RESEARCH, ckpt.STATUS_CLINICALLY_VALIDATED, "VALIDATED"])
def test_the_harness_cannot_write_a_validated_checkpoint(tmp_path, status):
    with pytest.raises(ckpt.CheckpointInvalid):
        ckpt.save(str(tmp_path / "a.pt"), model=small_model(), optimizer=None, scheduler=None,
                  status=status, metadata=metadata())


def test_a_checkpoint_claiming_validation_is_refused_on_load(tmp_path):
    path = str(tmp_path / "a.pt")
    ckpt.save(path, model=small_model(), optimizer=None, scheduler=None,
              status=ckpt.STATUS_TEST_ARTIFACT, metadata=metadata())
    record = torch.load(path, weights_only=True)
    record["status"] = ckpt.STATUS_CLINICALLY_VALIDATED
    torch.save(record, path)
    os.remove(path + ".sha256.json")
    with pytest.raises(ckpt.CheckpointInvalid, match="governed"):
        ckpt.load(path)


def test_arbitrary_pickled_objects_are_not_executed_on_load(tmp_path):
    """weights_only loading: a tampered file cannot run code on the reader."""

    class Payload(object):
        def __reduce__(self):
            return (os.getcwd, ())

    path = str(tmp_path / "evil.pt")
    torch.save({"format": ckpt.CHECKPOINT_FORMAT, "x": Payload()}, path)
    with pytest.raises(Exception):
        ckpt.load(path)


def test_every_required_metadata_field_is_present_after_a_save(tmp_path):
    path = str(tmp_path / "a.pt")
    sidecar = ckpt.save(path, model=small_model(), optimizer=None, scheduler=None,
                        status=ckpt.STATUS_TEST_ARTIFACT, metadata=metadata())
    record = ckpt.load(path)
    for key in ckpt.REQUIRED_METADATA:
        assert key in record["metadata"]
    for key in ("model_state", "optimizer_state", "scheduler_state", "rng_state"):
        assert key in record
    assert len(sidecar["fileSha256"]) == 64 and len(sidecar["weightsSha256"]) == 64
