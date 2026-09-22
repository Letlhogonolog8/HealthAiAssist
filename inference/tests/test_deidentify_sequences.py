"""
De-identification at depth, and UID references that still resolve.

Two defects found on 2026-09-22 by independent verification, both invisible to
every other test in this suite because LIDC-IDRI objects are plain axial CT
with no nested sequences and no cross-references. A pipeline can pass a
hundred tests on that data and still hand a real PACS export straight through
with the patient's name in it.

  1. deidentify() removed named identifiers and reduced dates with a flat loop
     over the top level, while private tags and UIDs were already handled
     recursively. A PatientName one level down inside RequestAttributesSequence
     — the sequence a scanner writes from the RIS order — survived intact.

  2. UIDs were remapped under a key that included the DICOM tag keyword, so the
     same instance reached through SOPInstanceUID and through
     ReferencedSOPInstanceUID came out as two different values. Every reference
     in a de-identified object pointed at nothing, and file_meta's copy of the
     instance UID stopped matching the dataset's, which is not conformant.

Both are fixed. These tests are the reason they stay fixed.
"""
from __future__ import annotations

import pytest
from pydicom.dataset import Dataset

from conftest import make_ct_dataset, make_ct_series

from dicom_ingest import deidentify
from uid_remap import UidRemapper

NESTED_IDENTIFIERS = {
    "PatientName": "Doe^Jane",
    "PatientID": "MRN-000123",
    "AccessionNumber": "ACC-9",
    "InstitutionName": "Test Hospital",
    "ReferringPhysicianName": "Ref^Doc",
    "StationName": "CT-01",
}


def _request_attributes() -> Dataset:
    """One item of a RequestAttributesSequence, as a scanner writes it."""
    item = Dataset()
    for keyword, value in NESTED_IDENTIFIERS.items():
        setattr(item, keyword, value)
    item.StudyDate = "20260315"
    item.StudyTime = "101500"
    return item


def _all_elements(dataset):
    """Every element at every depth, sequences included."""
    for element in dataset:
        if element.VR == "SQ":
            for item in element.value:
                yield from _all_elements(item)
        else:
            yield element


# ── 1. identifiers and dates, at depth ─────────────────────────────────────

def test_identifiers_nested_in_a_sequence_do_not_survive():
    """The defect, exactly as it was demonstrated."""
    ds = make_ct_dataset()
    ds.RequestAttributesSequence = [_request_attributes()]

    deidentify(ds)

    nested = ds.RequestAttributesSequence[0]
    survived = {
        keyword: str(getattr(nested, keyword))
        for keyword in NESTED_IDENTIFIERS
        if getattr(nested, keyword, None) not in (None, "")
    }
    assert survived == {}, f"nested identifiers survived: {survived}"


def test_no_identifying_value_survives_anywhere_in_the_object():
    """Byte-level, rather than trusting the keyword list to be complete."""
    ds = make_ct_dataset()
    ds.RequestAttributesSequence = [_request_attributes()]
    deidentify(ds)

    rendered = str(ds)
    for value in NESTED_IDENTIFIERS.values():
        assert value not in rendered, f"{value} is still in the object"


def test_nested_dates_are_reduced_and_nested_times_dropped():
    ds = make_ct_dataset()
    ds.RequestAttributesSequence = [_request_attributes()]
    deidentify(ds)

    nested = ds.RequestAttributesSequence[0]
    assert nested.StudyDate == "20260101", "reduced to the year, like the top level"
    assert "StudyTime" not in nested


def test_identifiers_survive_nowhere_however_deeply_nested():
    """Three levels down. The recursion is not special-cased to one depth."""
    innermost = Dataset()
    innermost.PatientName = "Doe^Jane"
    innermost.ContentDate = "20260315"

    middle = Dataset()
    middle.ReferencedImageSequence = [innermost]

    outer = Dataset()
    outer.SourceImageSequence = [middle]

    ds = make_ct_dataset()
    ds.RequestAttributesSequence = [outer]
    deidentify(ds)

    deep = ds.RequestAttributesSequence[0].SourceImageSequence[0].ReferencedImageSequence[0]
    assert getattr(deep, "PatientName", None) in (None, "")
    assert deep.ContentDate == "20260101"


def test_a_sequence_that_is_itself_an_identifier_goes_wholesale():
    """PatientInsurancePlanCodeSequence is in the identifier list and is a
    sequence. It must be deleted, not descended into and left behind empty."""
    item = Dataset()
    item.CodeValue = "PLAN-1"
    ds = make_ct_dataset()
    ds.PatientInsurancePlanCodeSequence = [item]

    deidentify(ds)

    assert "PatientInsurancePlanCodeSequence" not in ds


def test_nested_private_tags_still_go():
    """Already worked, via pydicom's recursive walk. Pinned so the new
    traversal cannot quietly take over and lose it."""
    item = Dataset()
    item.add_new((0x0009, 0x0010), "LO", "VENDOR CREATOR")
    item.add_new((0x0009, 0x1001), "LO", "Doe^Jane copy")
    ds = make_ct_dataset()
    ds.RequestAttributesSequence = [item]

    deidentify(ds)

    assert not any(el.tag.is_private for el in _all_elements(ds))


def test_the_clinical_and_geometric_attributes_are_untouched():
    """A de-identifier that removes too much produces an object that is safe
    and unreadable. These are what the pipeline needs downstream."""
    ds = make_ct_dataset()
    ds.RequestAttributesSequence = [_request_attributes()]
    before = {
        "Rows": ds.Rows,
        "Columns": ds.Columns,
        "Modality": ds.Modality,
        "RescaleSlope": float(ds.RescaleSlope),
        "RescaleIntercept": float(ds.RescaleIntercept),
        "PhotometricInterpretation": ds.PhotometricInterpretation,
        "BitsAllocated": ds.BitsAllocated,
        "PixelRepresentation": ds.PixelRepresentation,
        "SliceThickness": float(ds.SliceThickness),
        "BodyPartExamined": ds.BodyPartExamined,
        "Manufacturer": ds.Manufacturer,
        "ManufacturerModelName": ds.ManufacturerModelName,
    }
    pixels = bytes(ds.PixelData)

    deidentify(ds)

    for keyword, value in before.items():
        actual = getattr(ds, keyword, None)
        actual = float(actual) if isinstance(value, float) else actual
        assert actual == value, keyword
    assert bytes(ds.PixelData) == pixels, "pixel data is not de-identification's business"
    assert list(ds.PixelSpacing) == [0.7, 0.7]
    assert ds.PatientIdentityRemoved == "YES"
    assert "PS3.15" in str(ds.DeidentificationMethod)


# ── 2. references that still resolve ───────────────────────────────────────

def _cross_referenced_pair():
    """Two slices of one series, the second referring to the first the way a
    derived or reformatted image does."""
    series = make_ct_series(count=2)
    a, b = series[0], series[1]

    source = Dataset()
    source.ReferencedSOPClassUID = a.SOPClassUID
    source.ReferencedSOPInstanceUID = a.SOPInstanceUID
    b.SourceImageSequence = [source]

    b.ReferencedFrameOfReferenceUID = a.FrameOfReferenceUID

    study_ref = Dataset()
    study_ref.ReferencedSOPClassUID = "1.2.840.10008.3.1.2.3.1"
    study_ref.ReferencedSOPInstanceUID = a.StudyInstanceUID
    b.ReferencedStudySequence = [study_ref]

    series_ref = Dataset()
    series_ref.SeriesInstanceUID = a.SeriesInstanceUID
    b.ReferencedSeriesSequence = [series_ref]

    return a, b


def test_a_reference_to_an_instance_resolves_to_that_instance():
    a, b = _cross_referenced_pair()
    remapper = UidRemapper()
    deidentify(a, remapper)
    deidentify(b, remapper)

    assert str(b.SourceImageSequence[0].ReferencedSOPInstanceUID) == str(a.SOPInstanceUID)


def test_a_frame_of_reference_reference_resolves():
    a, b = _cross_referenced_pair()
    remapper = UidRemapper()
    deidentify(a, remapper)
    deidentify(b, remapper)

    assert str(b.ReferencedFrameOfReferenceUID) == str(a.FrameOfReferenceUID)


def test_a_study_reference_resolves_to_the_study_not_an_instance():
    """ReferencedSOPInstanceUID means whatever the surrounding sequence
    references. Inside ReferencedStudySequence it is the study."""
    a, b = _cross_referenced_pair()
    remapper = UidRemapper()
    deidentify(a, remapper)
    deidentify(b, remapper)

    assert str(b.ReferencedStudySequence[0].ReferencedSOPInstanceUID) == str(a.StudyInstanceUID)


def test_a_series_reference_resolves():
    a, b = _cross_referenced_pair()
    remapper = UidRemapper()
    deidentify(a, remapper)
    deidentify(b, remapper)

    assert str(b.ReferencedSeriesSequence[0].SeriesInstanceUID) == str(a.SeriesInstanceUID)


def test_file_meta_instance_uid_matches_the_dataset():
    """They must be equal or the object is non-conformant. Keying on the
    keyword gave them two different values."""
    ds = make_ct_dataset()
    deidentify(ds)

    assert str(ds.file_meta.MediaStorageSOPInstanceUID) == str(ds.SOPInstanceUID)


def test_distinct_entities_still_map_distinctly():
    """The roles must not collapse: a study, a series, an instance and a frame
    of reference are four different things even under one remapper."""
    ds = make_ct_dataset()
    deidentify(ds)

    values = {
        str(ds.StudyInstanceUID),
        str(ds.SeriesInstanceUID),
        str(ds.SOPInstanceUID),
        str(ds.FrameOfReferenceUID),
    }
    assert len(values) == 4


def test_two_instances_of_one_series_share_a_series_uid_and_differ_otherwise():
    a, b = _cross_referenced_pair()
    remapper = UidRemapper()
    deidentify(a, remapper)
    deidentify(b, remapper)

    assert str(a.SeriesInstanceUID) == str(b.SeriesInstanceUID)
    assert str(a.StudyInstanceUID) == str(b.StudyInstanceUID)
    assert str(a.SOPInstanceUID) != str(b.SOPInstanceUID)


def test_no_source_uid_survives_the_cross_referenced_pair():
    """The whole point of the remap is still met: references resolve to each
    other and to nothing outside this deployment."""
    a, b = _cross_referenced_pair()
    originals = {
        str(a.SOPInstanceUID), str(a.StudyInstanceUID),
        str(a.SeriesInstanceUID), str(a.FrameOfReferenceUID),
        str(b.SOPInstanceUID),
    }
    remapper = UidRemapper()
    deidentify(a, remapper)
    deidentify(b, remapper)

    rendered = str(a) + str(b)
    for original in originals:
        assert original not in rendered, original


def test_the_remap_is_still_deterministic_across_remapper_instances():
    """Two ingestions of the same object, under one configured salt, have to
    agree or a re-upload becomes a second study."""
    salt = b"x" * 40
    first, second = make_ct_dataset(), make_ct_dataset()
    second.SOPInstanceUID = first.SOPInstanceUID
    second.StudyInstanceUID = first.StudyInstanceUID
    second.SeriesInstanceUID = first.SeriesInstanceUID
    second.file_meta.MediaStorageSOPInstanceUID = first.SOPInstanceUID

    deidentify(first, UidRemapper(salt=salt))
    deidentify(second, UidRemapper(salt=salt))

    assert str(first.SOPInstanceUID) == str(second.SOPInstanceUID)
    assert str(first.StudyInstanceUID) == str(second.StudyInstanceUID)
    assert str(first.SeriesInstanceUID) == str(second.SeriesInstanceUID)


def test_a_different_salt_gives_a_different_mapping_of_the_same_object():
    first, second = make_ct_dataset(), make_ct_dataset()
    second.SOPInstanceUID = first.SOPInstanceUID

    deidentify(first, UidRemapper(salt=b"a" * 40))
    deidentify(second, UidRemapper(salt=b"b" * 40))

    assert str(first.SOPInstanceUID) != str(second.SOPInstanceUID)


def test_an_unrecognised_uid_is_still_deleted_rather_than_remapped():
    """The three-way policy is unchanged: keep class UIDs, remap the tree,
    delete anything else, because an unknown UID points somewhere unknown."""
    ds = make_ct_dataset()
    ds.add_new((0x0008, 0x0014), "UI", "1.2.826.0.1.3680043.8.9999.1")  # InstanceCreatorUID
    class_uid = str(ds.SOPClassUID)

    deidentify(ds)

    assert "InstanceCreatorUID" not in ds
    assert str(ds.SOPClassUID) == class_uid


@pytest.mark.parametrize("keyword", ["SOPInstanceUID", "SeriesInstanceUID", "StudyInstanceUID"])
def test_every_remapped_uid_is_a_conformant_uuid_derived_uid(keyword):
    from uid_remap import is_valid_dicom_uid

    ds = make_ct_dataset()
    deidentify(ds)

    value = str(getattr(ds, keyword))
    assert value.startswith("2.25."), value
    assert is_valid_dicom_uid(value), value
