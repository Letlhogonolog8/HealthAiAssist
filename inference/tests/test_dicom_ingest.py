"""
inference/dicom_ingest.py: recognition, windowing, de-identification.

Every assertion here is about a number or a tag the code can be held to.
"""
from __future__ import annotations

import io

import numpy as np
import pydicom
import pytest

from conftest import dataset_bytes, make_ct_dataset, requires_lidc

from dicom_ingest import (
    CT_LUNG_WINDOW,
    DicomRejected,
    _IDENTIFYING_KEYWORDS,
    _window,
    deidentify,
    dicom_to_model_frame,
    dicom_to_png_bytes,
    looks_like_dicom,
    training_window,
)


# ── recognition ────────────────────────────────────────────────────────────

def test_recognises_dicom_from_the_preamble_not_the_name(synthetic_ct_bytes):
    assert looks_like_dicom(synthetic_ct_bytes)
    assert not looks_like_dicom(b"\x89PNG\r\n\x1a\n" + b"\x00" * 200)
    assert not looks_like_dicom(b"")
    # 128 bytes of anything, then DICM: that is the whole test.
    assert looks_like_dicom(b"\xff" * 128 + b"DICM" + b"\x00" * 8)


def test_non_dicom_bytes_are_rejected_not_guessed():
    with pytest.raises(DicomRejected):
        dicom_to_model_frame(b"not a dicom object at all" * 20)


# ── windowing ──────────────────────────────────────────────────────────────

def test_training_window_forces_the_lung_window_for_ct_only():
    ct = make_ct_dataset(modality="CT")
    mr = make_ct_dataset(modality="MR")
    assert training_window(ct) == CT_LUNG_WINDOW
    assert training_window(mr) is None


def test_serving_render_ignores_the_display_preset_for_ct():
    """A soft-tissue display window (WC 40 / WW 400) clips aerated lung to black;
    the serving render must use the lung window instead, as training did."""
    ds = make_ct_dataset(window=(40.0, 400.0))
    frame, acquisition, _ = dicom_to_model_frame(dataset_bytes(ds))
    assert frame.dtype == np.uint8 and frame.shape == (64, 64)
    assert acquisition["windowApplied"] == {"center": -600.0, "width": 1500.0, "source": "training_window"}
    # Row 0 is -1000 HU (air). At the lung window that maps to
    # (-1000 - (-1350)) / 1500 * 255 ≈ 60, not to 0 as the display preset would give.
    assert 55 <= int(frame[0, 0]) <= 65
    # The same object through the tag window would have been black there.
    tag_rendered = _window(ds.pixel_array.astype(np.float64), ds)
    assert int(tag_rendered[0, 0]) == 0


def test_modality_lut_is_applied_before_the_voi_lut():
    """Rescale (slope, intercept) first, then the window. Skipping the rescale
    gives an image that looks plausible and is wrong; the ramp makes it checkable."""
    ds = make_ct_dataset(window=None)
    frame = _window(ds.pixel_array.astype(np.float64), ds, force_window=(0.0, 2000.0))
    # HU -1000 → 0; HU 0 (middle row) → 127/128; HU +1000 → 255.
    assert int(frame[0, 0]) == 0
    assert 125 <= int(frame[32, 0]) <= 130
    assert int(frame[-1, 0]) == 255


def test_monochrome1_is_inverted():
    ds = make_ct_dataset(photometric="MONOCHROME1", window=None)
    frame = _window(ds.pixel_array.astype(np.float64), ds, force_window=(0.0, 2000.0))
    assert int(frame[0, 0]) == 255 and int(frame[-1, 0]) == 0


def test_multi_frame_takes_the_middle_frame():
    ds = make_ct_dataset(frames=5, window=None)
    frame, acquisition, _ = dicom_to_model_frame(dataset_bytes(ds))
    assert acquisition["frames"] == 5
    assert frame.shape == (64, 64)


# ── refusals ───────────────────────────────────────────────────────────────

def test_burned_in_annotation_is_refused():
    ds = make_ct_dataset(burned_in="YES")
    with pytest.raises(DicomRejected, match="burned-in"):
        dicom_to_model_frame(dataset_bytes(ds))


# ── de-identification ──────────────────────────────────────────────────────

def _elements(ds):
    for el in ds:
        if el.VR == "SQ":
            for item in el.value:
                yield from _elements(item)
        else:
            yield el


def test_deidentify_removes_every_listed_identifier_and_private_tags():
    ds = make_ct_dataset()
    present_before = [k for k in _IDENTIFYING_KEYWORDS if k in ds]
    assert present_before, "the fixture carries identifiers to remove"
    deidentify(ds)
    for keyword in _IDENTIFYING_KEYWORDS:
        assert keyword not in ds, keyword
    assert not any(el.tag.is_private for el in _elements(ds)), "private tags removed wholesale"
    assert ds.PatientIdentityRemoved == "YES"
    assert "DeidentificationMethod" in ds


def test_deidentify_keeps_dates_to_the_year_and_drops_times():
    ds = make_ct_dataset()
    deidentify(ds)
    assert ds.StudyDate == "20260101"
    assert "StudyTime" not in ds


def test_deidentify_replaces_instance_uids_and_keeps_class_uids():
    ds = make_ct_dataset()
    original = {
        "sop": ds.SOPInstanceUID, "study": ds.StudyInstanceUID,
        "series": ds.SeriesInstanceUID, "frame": ds.FrameOfReferenceUID,
        "meta": ds.file_meta.MediaStorageSOPInstanceUID,
    }
    class_uid = ds.SOPClassUID
    deidentify(ds)
    assert ds.SOPClassUID == class_uid
    assert ds.file_meta.MediaStorageSOPClassUID == class_uid
    for keyword, before in (
        ("SOPInstanceUID", original["sop"]), ("StudyInstanceUID", original["study"]),
        ("SeriesInstanceUID", original["series"]), ("FrameOfReferenceUID", original["frame"]),
    ):
        assert keyword in ds, f"{keyword} must remain for a conformant object"
        assert ds[keyword].value != before, f"{keyword} must not be the source's"
    assert ds.file_meta.MediaStorageSOPInstanceUID != original["meta"]


def test_the_deidentified_object_carries_no_identity_bytes_and_still_decodes(synthetic_ct_bytes):
    _frame, _acq, deidentified = dicom_to_model_frame(synthetic_ct_bytes)
    for token in (b"Doe^Jane", b"MRN-000123", b"ACC-9", b"Test Hospital", b"ALT-1", b"VENDOR CREATOR"):
        assert token not in deidentified, token
    ds = pydicom.dcmread(io.BytesIO(deidentified), force=True)
    assert ds.pixel_array.shape == (64, 64)
    assert ds.PatientIdentityRemoved == "YES"


def test_acquisition_record_is_identity_free(synthetic_ct_bytes):
    _frame, acquisition, _ = dicom_to_model_frame(synthetic_ct_bytes)
    assert acquisition["modality"] == "CT"
    assert acquisition["manufacturer"] == "SYNTHETIC"
    assert acquisition["pixelSpacingMm"] == [0.7, 0.7]
    assert acquisition["sliceThicknessMm"] == 2.5
    assert acquisition["bodyPartExamined"] == "CHEST"
    text = str(acquisition)
    for token in ("Doe", "MRN-000123", "ACC-9", "Test Hospital"):
        assert token not in text


def test_png_wrapper_uses_the_same_render(synthetic_ct_bytes):
    from PIL import Image

    png, acquisition = dicom_to_png_bytes(synthetic_ct_bytes)
    frame, acquisition2, _ = dicom_to_model_frame(synthetic_ct_bytes)
    decoded = np.asarray(Image.open(io.BytesIO(png)).convert("L"))
    assert np.array_equal(decoded, frame)
    assert "deidentifiedObject" not in acquisition
    assert acquisition["windowApplied"] == acquisition2["windowApplied"]


# ── on a real object ───────────────────────────────────────────────────────

@requires_lidc
def test_real_lidc_object_renders_at_the_lung_window_and_loses_its_identity(lidc_nodule):
    frame, acquisition, deidentified = dicom_to_model_frame(lidc_nodule["bytes"])
    assert frame.shape == (512, 512) and frame.dtype == np.uint8
    assert acquisition["windowApplied"]["source"] == "training_window"
    assert acquisition["modality"] == "CT"
    # Aerated lung is a large dark-grey region at the lung window, not black:
    # if the display preset had been honoured this would be near-zero.
    assert 0.15 < float((frame < 90).mean()) < 0.95
    original = pydicom.dcmread(io.BytesIO(lidc_nodule["bytes"]), stop_before_pixels=True, force=True)
    assert lidc_nodule["patientId"].encode() not in deidentified
    assert str(original.SeriesInstanceUID).encode() not in deidentified
    assert str(original.SOPInstanceUID).encode() not in deidentified
