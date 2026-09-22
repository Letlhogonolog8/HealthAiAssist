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
    ROLE_FRAME_OF_REFERENCE,
    ROLE_INSTANCE,
    ROLE_SERIES,
    ROLE_STUDY,
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
    """One string standing for two *different entities* must not map
    identically, or a study and an instance that happen to share a string can
    be correlated.

    The converse is test_one_role_is_one_namespace below: two attributes
    naming the *same* entity must map identically, which is what makes a
    reference still resolve after de-identification.
    """
    assert remap_uid(SOURCE, kind=ROLE_SERIES, salt=SALT_A) != remap_uid(
        SOURCE, kind=ROLE_INSTANCE, salt=SALT_A
    )


def test_one_role_is_one_namespace():
    """The identity that makes references survive: the role is the namespace,
    so it does not matter which attribute the UID was reached through."""
    for role in (ROLE_STUDY, ROLE_SERIES, ROLE_INSTANCE, ROLE_FRAME_OF_REFERENCE):
        assert remap_uid(SOURCE, kind=role, salt=SALT_A) == remap_uid(
            SOURCE, kind=role, salt=SALT_A
        )


def test_the_four_entity_roles_are_mutually_distinct():
    roles = (ROLE_STUDY, ROLE_SERIES, ROLE_INSTANCE, ROLE_FRAME_OF_REFERENCE)
    mapped = {remap_uid(SOURCE, kind=role, salt=SALT_A) for role in roles}
    assert len(mapped) == len(roles)


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


# ── relationships survive de-identification ────────────────────────────────
#
# The reason the mapping is keyed by role rather than by tag keyword. Keyed by
# keyword, an instance reached through SOPInstanceUID and the same instance
# reached through ReferencedSOPInstanceUID came out as two different values, so
# every reference in a de-identified object pointed at nothing while the object
# still looked well formed.

def _derived_object(source):
    """A derived image referencing `source`, the way a reformat or a secondary
    capture does: the reference lives inside SourceImageSequence, two levels
    down from the dataset root."""
    from pydicom.dataset import Dataset

    derived = make_ct_dataset()
    derived.StudyInstanceUID = source.StudyInstanceUID
    derived.SeriesInstanceUID = source.SeriesInstanceUID
    derived.FrameOfReferenceUID = source.FrameOfReferenceUID

    reference = Dataset()
    reference.ReferencedSOPClassUID = source.SOPClassUID
    reference.ReferencedSOPInstanceUID = source.SOPInstanceUID
    derived.SourceImageSequence = [reference]

    purpose = Dataset()
    purpose.ReferencedSOPClassUID = source.SOPClassUID
    purpose.ReferencedSOPInstanceUID = source.SOPInstanceUID
    outer = Dataset()
    outer.ReferencedImageSequence = [purpose]
    derived.ReferencedImageEvidenceSequence = [outer]

    return derived


def test_a_derived_object_still_resolves_its_source_image_reference():
    from dicom_ingest import deidentify

    source = make_ct_dataset()
    derived = _derived_object(source)
    remapper = UidRemapper(salt=SALT_A, scope=SCOPE_DEPLOYMENT)

    deidentify(source, remapper)
    deidentify(derived, remapper)

    assert str(derived.SourceImageSequence[0].ReferencedSOPInstanceUID) == str(
        source.SOPInstanceUID
    )


def test_a_reference_two_sequences_deep_still_resolves():
    """The recursion carries the role down, not just the first level."""
    from dicom_ingest import deidentify

    source = make_ct_dataset()
    derived = _derived_object(source)
    remapper = UidRemapper(salt=SALT_A, scope=SCOPE_DEPLOYMENT)

    deidentify(source, remapper)
    deidentify(derived, remapper)

    nested = derived.ReferencedImageEvidenceSequence[0].ReferencedImageSequence[0]
    assert str(nested.ReferencedSOPInstanceUID) == str(source.SOPInstanceUID)


def test_the_study_series_and_frame_of_reference_tie_the_two_objects_together():
    from dicom_ingest import deidentify

    source = make_ct_dataset()
    derived = _derived_object(source)
    remapper = UidRemapper(salt=SALT_A, scope=SCOPE_DEPLOYMENT)

    deidentify(source, remapper)
    deidentify(derived, remapper)

    assert str(derived.StudyInstanceUID) == str(source.StudyInstanceUID)
    assert str(derived.SeriesInstanceUID) == str(source.SeriesInstanceUID)
    assert str(derived.FrameOfReferenceUID) == str(source.FrameOfReferenceUID)
    assert str(derived.SOPInstanceUID) != str(source.SOPInstanceUID)


def test_the_relationships_hold_under_a_different_salt_and_change_value():
    from dicom_ingest import deidentify

    first_source, first_derived = make_ct_dataset(), None
    first_derived = _derived_object(first_source)
    second_source = make_ct_dataset()
    second_source.SOPInstanceUID = first_source.SOPInstanceUID
    second_source.StudyInstanceUID = first_source.StudyInstanceUID
    second_source.SeriesInstanceUID = first_source.SeriesInstanceUID
    second_source.FrameOfReferenceUID = first_source.FrameOfReferenceUID
    second_derived = _derived_object(second_source)

    deidentify(first_source, UidRemapper(salt=SALT_A, scope=SCOPE_DEPLOYMENT))
    deidentify(first_derived, UidRemapper(salt=SALT_A, scope=SCOPE_DEPLOYMENT))
    deidentify(second_source, UidRemapper(salt=SALT_B, scope=SCOPE_DEPLOYMENT))
    deidentify(second_derived, UidRemapper(salt=SALT_B, scope=SCOPE_DEPLOYMENT))

    # Internally consistent under each salt...
    assert str(first_derived.SourceImageSequence[0].ReferencedSOPInstanceUID) == str(
        first_source.SOPInstanceUID
    )
    assert str(second_derived.SourceImageSequence[0].ReferencedSOPInstanceUID) == str(
        second_source.SOPInstanceUID
    )
    # ...and not linkable between them.
    assert str(first_source.SOPInstanceUID) != str(second_source.SOPInstanceUID)


def test_every_remapped_uid_in_a_derived_object_is_conformant():
    from dicom_ingest import deidentify

    source = make_ct_dataset()
    derived = _derived_object(source)
    remapper = UidRemapper(salt=SALT_A, scope=SCOPE_DEPLOYMENT)
    deidentify(source, remapper)
    deidentify(derived, remapper)

    def uids(dataset):
        for element in dataset:
            if element.VR == "SQ":
                for item in element.value:
                    yield from uids(item)
            elif element.VR == "UI" and element.value:
                yield element.keyword, str(element.value)

    checked = 0
    for keyword, value in uids(derived):
        assert is_valid_dicom_uid(value), f"{keyword}={value}"
        if keyword not in ("SOPClassUID", "ReferencedSOPClassUID", "TransferSyntaxUID",
                           "MediaStorageSOPClassUID", "ImplementationClassUID"):
            assert value.startswith("2.25."), f"{keyword}={value}"
            checked += 1
    assert checked >= 5, "the derived object carries the UIDs this test is about"
