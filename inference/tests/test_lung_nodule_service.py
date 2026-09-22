"""
inference/lung_nodule_service.py: what it answers, what it refuses, and that
serving prepares exactly what training saw.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import re

import numpy as np
import pytest
from PIL import Image

from conftest import (
    ROOT, NODULE_MODEL, NODULE_MODEL_DIR, PATCHES,
    dataset_bytes, make_ct_dataset, requires_lidc, requires_nodule_model, requires_patches,
)

from dicom_ingest import DicomRejected
from nodule_patch import PATCH_PX, crop, patch_to_model_input


# ── the crop, in isolation ─────────────────────────────────────────────────

def test_crop_is_centred_and_zero_padded_at_the_edge():
    frame = np.arange(100 * 100, dtype=np.uint8).reshape(100, 100)
    centre = crop(frame, 50, 50, 64)
    assert centre.shape == (64, 64)
    assert centre[32, 32] == frame[50, 50]
    edge = crop(frame, 2, 2, 64)
    assert edge.shape == (64, 64)
    # Everything left of / above the frame is padding, and the centre stays put.
    assert edge[:30, :30].max() == 0
    assert edge[32, 32] == frame[2, 2]


def test_patch_to_model_input_shape_and_range():
    patch = np.full((PATCH_PX, PATCH_PX), 120, dtype=np.uint8)
    batch = patch_to_model_input(patch)
    assert batch.shape == (1, 224, 224, 3) and batch.dtype == np.float32
    assert batch.min() >= 0 and batch.max() <= 255
    assert abs(float(batch.mean()) - 120) < 1


# ── quality gate floors were measured, not copied ──────────────────────────

def test_gate_floors_sit_below_the_training_minimum():
    import lung_nodule_service as svc

    # Measured on 2,900 training patches on 2026-09-21: std min 8.0,
    # Laplacian variance min 1.57. A floor above either would refuse valid input.
    assert svc.MIN_STD < 8.0
    assert svc.MIN_LAPLACIAN_VAR < 1.57


def test_gate_refuses_a_blank_and_a_saturated_crop():
    import lung_nodule_service as svc

    blank = np.zeros((1, 224, 224, 3), dtype=np.float32)
    assert any("black" in r for r in svc.LungNoduleCharacteriser._quality_failures(blank))
    white = np.full((1, 224, 224, 3), 250.0, dtype=np.float32)
    assert any("white" in r for r in svc.LungNoduleCharacteriser._quality_failures(white))


# ── refusals that need no model ────────────────────────────────────────────

def _bare_characteriser():
    """The class without a model, for prepare()-level refusals."""
    import lung_nodule_service as svc

    c = svc.LungNoduleCharacteriser.__new__(svc.LungNoduleCharacteriser)
    c.model = None
    return c


def test_raster_input_is_refused_with_the_reason():
    png = Image.new("L", (512, 512), 100)
    import io
    buffer = io.BytesIO(); png.save(buffer, format="PNG")
    with pytest.raises(DicomRejected, match="DICOM"):
        _bare_characteriser().prepare(buffer.getvalue(), 256, 256)


def test_non_ct_modality_is_refused():
    ds = make_ct_dataset(modality="MR")
    with pytest.raises(DicomRejected, match="not CT"):
        _bare_characteriser().prepare(dataset_bytes(ds), 32, 32)


def test_a_centre_outside_the_frame_is_refused():
    ds = make_ct_dataset()
    with pytest.raises(DicomRejected, match="outside"):
        _bare_characteriser().prepare(dataset_bytes(ds), 500, 500)


def test_prepare_returns_the_model_input_and_the_region(synthetic_ct_bytes):
    batch, acquisition = _bare_characteriser().prepare(synthetic_ct_bytes, 32, 40)
    assert batch.shape == (1, 224, 224, 3)
    assert acquisition["region"] == {
        "cx": 32.0, "cy": 40.0, "sizePx": PATCH_PX,
        "sizeMm": [round(PATCH_PX * 0.7, 1), round(PATCH_PX * 0.7, 1)],
        "frameRows": 64, "frameColumns": 64,
    }
    assert isinstance(acquisition["deidentifiedObject"], (bytes, bytearray))


# ── configuration comes from the artifact's own files ──────────────────────

@requires_nodule_model
def test_operating_point_and_calibration_are_read_not_typed(characteriser):
    training = json.load(open(os.path.join(NODULE_MODEL_DIR, "lung_nodule_training.json")))
    calibration = json.load(open(os.path.join(NODULE_MODEL_DIR, "lung_nodule_model_calibration.json")))
    assert characteriser.threshold == training["operatingPoint"]["threshold"]
    assert calibration["applied"] is False
    assert characteriser.temperature == 1.0, "fitted but not applied means identity"


@requires_nodule_model
def test_temperature_scaling_is_monotonic(characteriser):
    p = np.array([0.7, 0.3])
    characteriser.temperature = 2.0
    try:
        scaled = characteriser._apply_temperature(p)
    finally:
        characteriser.temperature = 1.0
    assert scaled.argmax() == p.argmax()
    assert abs(scaled.sum() - 1.0) < 1e-9
    assert scaled[0] < p[0], "T > 1 moves probabilities toward 0.5"


# ── serving prepares exactly what training saw ─────────────────────────────

def _nodule_id(row):
    series = hashlib.sha256(row["series_uid"].encode()).hexdigest()[:6]
    return f"{row['patient']}_{series}_{row['nodule_index']}"


@requires_lidc
@requires_patches
def test_windowing_parity_serving_patch_equals_training_png(lidc_nodule):
    """The serving path (DICOM bytes + centre → batch) must produce the same
    224×224 array as the PNG the training extractor wrote for that nodule's
    centre slice. Byte-identical, not approximately: a difference here is the
    model meeting an input it never trained on."""
    rows = [r for r in csv.DictReader(open(PATCHES, encoding="utf-8")) if r["nodule_id"] == lidc_nodule["noduleId"]]
    assert rows, "the nodule has patches in the manifest"
    # The extractor writes offsets 0..4 for the five slices around the centre;
    # the centre slice is offset 2 when the nodule is not at the very top of
    # the series, which the held-out test nodules are not.
    centre_row = next((r for r in rows if r["offset"] == "2"), None)
    if centre_row is None:
        pytest.skip("centre slice offset not present for this nodule")
    training_png = os.path.join(ROOT, "dataset", "lidc-ct", centre_row["path"].replace("/", os.sep))
    expected = np.asarray(Image.open(training_png).convert("RGB"), dtype=np.float32)[None]

    batch, _ = _bare_characteriser().prepare(lidc_nodule["bytes"], lidc_nodule["cx"], lidc_nodule["cy"])
    assert batch.shape == expected.shape
    assert np.array_equal(batch, expected), f"serving and training differ in {int((batch != expected).sum())} values"


# ── the answer, and the screen, on real inputs ─────────────────────────────

@requires_lidc
@requires_nodule_model
def test_a_labelled_nodule_gets_a_structured_answer(characteriser, lidc_nodule):
    result = characteriser.characterise(lidc_nodule["bytes"], lidc_nodule["cx"], lidc_nodule["cy"])
    assert result["status"] == "success", result
    assert 0.0 <= result["probability"] <= 1.0
    assert result["threshold"] == characteriser.threshold
    assert result["prediction"] == ("cancer" if result["probability"] >= result["threshold"] else "no_cancer")
    assert result["temperature"] == 1.0 and result["calibrationApplied"] is False
    assert result["oodScore"]["score"] < result["oodScore"]["threshold"]
    assert result["qualityGate"] == "passed"
    assert result["acquisition"]["windowApplied"]["source"] == "training_window"
    assert re.match(r"\d{4}-\d{2}-\d{2}T", result["inferenceAt"])
    assert "%" not in json.dumps({k: v for k, v in result.items() if k != "acquisition"})


@requires_nodule_model
def test_whole_slices_and_skin_are_refused_by_the_ood_screen(characteriser):
    """The reference was validated at ≥90% refusal on both domains; ten samples
    each are asserted at a bar that a 90% detector clears with room to spare."""
    for directory, floor in (
        (os.path.join(ROOT, "dataset", "lidc-ood", "whole-slice"), 7),
        (os.path.join(ROOT, "dataset", "dataset", "data", "test", "benign"), 7),
    ):
        if not os.path.isdir(directory):
            pytest.skip(f"{directory} absent")
        files = sorted(f for f in os.listdir(directory) if f.lower().endswith((".png", ".jpg", ".jpeg")))[:10]
        flagged = 0
        for name in files:
            img = Image.open(os.path.join(directory, name)).convert("RGB").resize((224, 224))
            batch = np.asarray(img, dtype=np.float32)[None]
            is_ood, _detail, note = characteriser._out_of_distribution(batch)
            assert note is None, note
            flagged += int(bool(is_ood))
        assert flagged >= floor, f"{directory}: only {flagged}/10 refused"


@requires_nodule_model
def test_the_service_fingerprint_matches_the_governance_binding(characteriser):
    """The artifact the service holds is the one the Node binding names."""
    digest = hashlib.sha256()
    with open(characteriser.model_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    fingerprint = digest.hexdigest()[:12]

    governance = open(os.path.join(ROOT, "server", "model-governance.ts"), encoding="utf-8").read()
    match = re.search(r"lung_nodule:\s*\{\s*artifactFingerprint:\s*'([0-9a-f]{12})'", governance)
    assert match, "no lung_nodule binding in model-governance.ts"
    assert match.group(1) == fingerprint

    verification = os.path.join(NODULE_MODEL_DIR, "lung_nodule_verification.json")
    if os.path.exists(verification):
        report = json.load(open(verification))
        assert report["artifactFingerprint"] == fingerprint
        assert report["matchesPublished"] is True
