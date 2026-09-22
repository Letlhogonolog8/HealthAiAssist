"""
inference/uid_remap.py: deterministic, keyed, conformant, collision-free.

The properties here are the ones the whole series pipeline rests on. If the
mapping is not deterministic, a series cannot be assembled from two uploads;
if it is not keyed, the de-identified UIDs are a join key back to the source
PACS; if it is not conformant, the objects are not valid DICOM.
"""
from __future__ import annotations

import io
import re

import pydicom
import pytest

from conftest import dataset_bytes, make_ct_dataset, requires_lidc

from dicom_ingest import dicom_to_model_frame
from uid_remap import (
    SCOPE_DEPLOYMENT,
    SCOPE_INGESTION,
    UidRemapper,
    is_valid_dicom_uid,
    remap_uid,
    uid_mapping_scope,
)

SALT_A = b"a" * 32
SALT_B = b"b" * 32
SOURCE = "1.3.6.1.4.1.14519.5.2.1.6279.6001.104577655443617884345707415897"


# ── deterministic ──────────────────────────────────────────────────────────

def test_the_same_uid_and_salt_always_map_the_same_way():
    first = remap_uid(SOURCE, kind="SeriesInstanceUID", salt=SALT_A)
    for _ in range(5):
        assert remap_uid(SOURCE, kind="SeriesInstanceUID", salt=SALT_A) == first


def test_a_remapper_instance_is_consistent_with_the_bare_function():
    remapper = UidRemapper(salt=SALT_A, scope=SCOPE_DEPLOYMENT)
    assert remapper(SOURCE, kind="SOPInstanceUID") == remap_uid(
        SOURCE, kind="SOPInstanceUID", salt=SALT_A
    )
    # And cached, so a 300-slice series pays for each distinct UID once.
    remapper(SOURCE, kind="SOPInstanceUID")
    assert remapper.size == 1


# ── keyed ──────────────────────────────────────────────────────────────────

def test_a_different_salt_gives_a_different_mapping():
    """This is what makes the mapping unlinkable: without the deployment's
    salt, an attacker cannot reproduce it even knowing the algorithm."""
    assert remap_uid(SOURCE, salt=SALT_A) != remap_uid(SOURCE, salt=SALT_B)


def test_the_role_is_part_of_the_key():
    """One string appearing as both a SeriesInstanceUID and a reference must
    not map identically, or the two roles can be correlated."""
    assert remap_uid(SOURCE, kind="SeriesInstanceUID", salt=SALT_A) != remap_uid(
        SOURCE, kind="SOPInstanceUID", salt=SALT_A
    )


def test_the_output_does_not_contain_the_input():
    mapped = remap_uid(SOURCE, salt=SALT_A)
    assert SOURCE not in mapped
    # Nor any distinctive run of it: the org root of the source is the part an
    # attacker would look for.
    assert "1.3.6.1.4.1.14519" not in mapped


# ── collision resistance ───────────────────────────────────────────────────

def test_distinct_inputs_give_distinct_outputs():
    uids = [f"1.2.826.0.1.3680043.8.{n}" for n in range(2000)]
    mapped = {remap_uid(u, salt=SALT_A) for u in uids}
    assert len(mapped) == len(uids)


def test_uids_differing_by_one_character_do_not_collide():
    a = remap_uid("1.2.3.4.5.6.7.8.9", salt=SALT_A)
    b = remap_uid("1.2.3.4.5.6.7.8.10", salt=SALT_A)
    assert a != b


def test_an_empty_uid_is_refused_rather_than_mapped_to_a_constant():
    with pytest.raises(ValueError):
        remap_uid("", salt=SALT_A)


# ── conformant ─────────────────────────────────────────────────────────────

def test_generated_uids_are_valid_dicom_uids():
    for n in range(500):
        uid = remap_uid(f"1.2.840.113619.2.55.{n}", salt=SALT_A)
        assert is_valid_dicom_uid(uid), uid
        assert len(uid) <= 64
        assert uid.startswith("2.25."), "the UUID-derived root from PS3.5 B.2"
        assert re.fullmatch(r"[0-9.]+", uid)


def test_the_validator_rejects_what_the_standard_rejects():
    assert not is_valid_dicom_uid("")
    assert not is_valid_dicom_uid("1.2." + "9" * 70)       # too long
    assert not is_valid_dicom_uid("1..2")                   # empty component
    assert not is_valid_dicom_uid("1.2.")                   # trailing dot
    assert not is_valid_dicom_uid(".1.2")                   # leading dot
    assert not is_valid_dicom_uid("1.02")                   # leading zero
    assert not is_valid_dicom_uid("1.2.a")                  # not a digit
    assert is_valid_dicom_uid("1.2.0.3"), "a bare zero component is legal"


def test_the_generated_value_is_a_version_4_uuid():
    """2.25. expects a UUID, so the version and variant bits are stamped
    rather than the first 128 bits of a digest being passed off as one."""
    import uuid

    for n in range(50):
        uid = remap_uid(f"1.2.3.{n}", salt=SALT_A)
        value = uuid.UUID(int=int(uid[len("2.25."):]))
        assert value.version == 4
        assert value.variant == uuid.RFC_4122


# ── scope ──────────────────────────────────────────────────────────────────

def test_scope_is_deployment_when_a_salt_is_configured(monkeypatch):
    monkeypatch.setenv("DICOM_UID_SALT", "x" * 40)
    assert uid_mapping_scope() == SCOPE_DEPLOYMENT


def test_scope_falls_back_to_ingestion_without_a_salt(monkeypatch):
    monkeypatch.delenv("DICOM_UID_SALT", raising=False)
    assert uid_mapping_scope() == SCOPE_INGESTION


def test_a_short_salt_is_ignored_rather_than_accepted(monkeypatch):
    """A four-character salt is not a secret, and treating it as one would be
    worse than having none: it would be reported as deployment scope."""
    monkeypatch.setenv("DICOM_UID_SALT", "abcd")
    assert uid_mapping_scope() == SCOPE_INGESTION


# ── relationships, end to end through de-identification ────────────────────

def _uids(data: bytes) -> tuple[str, str, str]:
    ds = pydicom.dcmread(io.BytesIO(data), force=True)
    return (
        str(ds.StudyInstanceUID),
        str(ds.SeriesInstanceUID),
        str(ds.SOPInstanceUID),
    )


def test_two_objects_of_one_series_keep_their_relationship():
    """The whole point. Two slices of one series must still share a series and
    a study after de-identification, and must not share an instance UID."""
    first = make_ct_dataset()
    second = make_ct_dataset()
    second.StudyInstanceUID = first.StudyInstanceUID
    second.SeriesInstanceUID = first.SeriesInstanceUID  # same series
    # A different instance.
    assert second.SOPInstanceUID != first.SOPInstanceUID

    remapper = UidRemapper(salt=SALT_A, scope=SCOPE_DEPLOYMENT)
    _f, _a, a_bytes = dicom_to_model_frame(dataset_bytes(first), remapper)
    _f, _a, b_bytes = dicom_to_model_frame(dataset_bytes(second), remapper)

    a_study, a_series, a_sop = _uids(a_bytes)
    b_study, b_series, b_sop = _uids(b_bytes)

    assert a_study == b_study, "one study"
    assert a_series == b_series, "one series"
    assert a_sop != b_sop, "two instances"
    for uid in (a_study, a_series, a_sop, b_sop):
        assert is_valid_dicom_uid(uid)


def test_separate_remapper_instances_agree_under_one_salt():
    """A series ingested in two batches must still be one series."""
    ds = make_ct_dataset()
    raw = dataset_bytes(ds)
    _f, _a, first = dicom_to_model_frame(raw, UidRemapper(salt=SALT_A, scope=SCOPE_DEPLOYMENT))
    _f, _a, second = dicom_to_model_frame(raw, UidRemapper(salt=SALT_A, scope=SCOPE_DEPLOYMENT))
    assert _uids(first) == _uids(second)


def test_no_original_uid_survives_into_the_persisted_object():
    ds = make_ct_dataset()
    originals = {
        str(ds.StudyInstanceUID), str(ds.SeriesInstanceUID), str(ds.SOPInstanceUID),
        str(ds.FrameOfReferenceUID), str(ds.file_meta.MediaStorageSOPInstanceUID),
    }
    _f, _a, deidentified = dicom_to_model_frame(
        dataset_bytes(ds), UidRemapper(salt=SALT_A, scope=SCOPE_DEPLOYMENT)
    )
    for original in originals:
        assert original.encode() not in deidentified, original


@requires_lidc
def test_no_original_uid_survives_on_a_real_object(lidc_nodule):
    original = pydicom.dcmread(io.BytesIO(lidc_nodule["bytes"]), stop_before_pixels=True, force=True)
    _f, acquisition, deidentified = dicom_to_model_frame(
        lidc_nodule["bytes"], UidRemapper(salt=SALT_A, scope=SCOPE_DEPLOYMENT)
    )
    for keyword in ("StudyInstanceUID", "SeriesInstanceUID", "SOPInstanceUID"):
        assert str(getattr(original, keyword)).encode() not in deidentified, keyword
    # And what the caller is handed is the remapped identity, not the source.
    reported = acquisition["deidentifiedUids"]
    assert reported["seriesInstanceUid"] != str(original.SeriesInstanceUID)
    assert is_valid_dicom_uid(reported["seriesInstanceUid"])
