"""
inference/series.py: grouping a pile of objects into one ordered series.

The failures these cover are the ones that produce a plausible-looking result
rather than an error — two series merged into one volume, slices ordered by
filename, a missing slice nobody noticed. None of them raise on their own.
"""
from __future__ import annotations

import random

import pytest

from conftest import make_ct_dataset, make_ct_series, requires_lidc

from series import (
    SeriesRejected,
    assemble,
    order_slices,
    read_instance_metadata,
)


def metas(datasets, shuffle_seed: int | None = None):
    """Datasets to InstanceMeta, optionally in a deliberately wrong order."""
    ordered = list(datasets)
    if shuffle_seed is not None:
        random.Random(shuffle_seed).shuffle(ordered)
    return [read_instance_metadata(ds, index) for index, ds in enumerate(ordered)]


# ── A. grouping ────────────────────────────────────────────────────────────

def test_one_valid_series_assembles():
    members, report = assemble(metas(make_ct_series(count=50)))
    assert len(members) == 50
    assert report == {"uploaded": 50, "unique": 50, "duplicatesDropped": 0, "modality": "CT"}


def test_grouping_ignores_upload_order():
    """Order is a property of the upload; membership is a property of the
    objects. Shuffling must change nothing about the grouping."""
    series = make_ct_series(count=40)
    straight, _ = assemble(metas(series))
    shuffled, _ = assemble(metas(series, shuffle_seed=11))
    assert {m.sop_instance_uid for m in straight} == {m.sop_instance_uid for m in shuffled}


def test_two_series_in_one_upload_are_refused_not_merged():
    """The important one. A merged series is a volume with slices from two
    acquisitions in it, and nothing downstream could detect that."""
    a = make_ct_series(count=30)
    b = make_ct_series(count=30)
    with pytest.raises(SeriesRejected) as raised:
        assemble(metas(a + b, shuffle_seed=5))
    assert raised.value.code == "mixed_series"
    assert raised.value.detail["seriesCount"] == 2
    assert sorted(raised.value.detail["instancesPerSeries"]) == [30, 30]
    # Counts, never the original UIDs.
    assert "1.2." not in str(raised.value.detail)


def test_a_duplicated_instance_is_dropped_and_counted():
    series = make_ct_series(count=20)
    members, report = assemble(metas(series + [series[3], series[7]]))
    assert len(members) == 20
    assert report["uploaded"] == 22
    assert report["duplicatesDropped"] == 2


def test_two_different_objects_sharing_one_sop_uid_are_refused():
    """A dropped duplicate is the same object twice. This is not that: one of
    the two is mislabelled and there is no way to tell which."""
    series = make_ct_series(count=20)
    impostor = make_ct_dataset(rows=256, cols=256)
    impostor.SeriesInstanceUID = series[0].SeriesInstanceUID
    impostor.StudyInstanceUID = series[0].StudyInstanceUID
    impostor.SOPInstanceUID = series[5].SOPInstanceUID  # collides
    impostor.ImagePositionPatient = [0.0, 0.0, 999.0]
    impostor.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    with pytest.raises(SeriesRejected) as raised:
        assemble(metas(series + [impostor]))
    assert raised.value.code == "conflicting_instances"


def test_an_object_without_a_series_uid_cannot_be_grouped():
    series = make_ct_series(count=10)
    del series[4].SeriesInstanceUID
    with pytest.raises(SeriesRejected) as raised:
        assemble(metas(series))
    assert raised.value.code == "missing_series_uid"


def test_objects_disagreeing_about_the_study_are_refused():
    series = make_ct_series(count=10)
    series[2].StudyInstanceUID = "1.2.826.0.1.3680043.8.9999"
    with pytest.raises(SeriesRejected) as raised:
        assemble(metas(series))
    assert raised.value.code == "inconsistent_study"


def test_mixed_modality_within_one_series_is_refused():
    series = make_ct_series(count=10)
    series[3].Modality = "MR"
    with pytest.raises(SeriesRejected) as raised:
        assemble(metas(series))
    assert raised.value.code == "mixed_modality"
    assert raised.value.detail["modalities"] == ["CT", "MR"]


def test_an_empty_upload_is_refused():
    with pytest.raises(SeriesRejected) as raised:
        assemble([])
    assert raised.value.code == "empty_upload"


# ── B. ordering ────────────────────────────────────────────────────────────

def _positions(result):
    return [m.projected_position for m in result.ordered]


def test_normal_ascending_positions_order_by_geometry():
    result = order_slices(metas(make_ct_series(count=40, spacing=2.5)))
    assert result.method == "image_position_patient"
    assert result.trusted
    assert _positions(result) == sorted(_positions(result))
    assert result.median_spacing == pytest.approx(2.5)


def test_reverse_upload_order_produces_the_same_anatomical_order():
    series = make_ct_series(count=30, spacing=2.0)
    forward = order_slices(metas(series))
    backward = order_slices(metas(list(reversed(series))))
    assert [m.sop_instance_uid for m in forward.ordered] == [
        m.sop_instance_uid for m in backward.ordered
    ]


def test_shuffled_upload_order_produces_the_same_anatomical_order():
    series = make_ct_series(count=30, spacing=2.0)
    reference = [m.sop_instance_uid for m in order_slices(metas(series)).ordered]
    for seed in (1, 2, 3, 99):
        shuffled = order_slices(metas(series, shuffle_seed=seed))
        assert [m.sop_instance_uid for m in shuffled.ordered] == reference


def test_filename_order_is_not_the_ordering_mechanism():
    """The slices are handed over in an order that is exactly wrong — later
    anatomy first — as a filename sort would produce for `IMG10` before
    `IMG9`. The geometry has to win."""
    series = make_ct_series(count=20, spacing=3.0)
    upside_down = list(reversed(series))
    result = order_slices(metas(upside_down))
    assert result.trusted
    assert _positions(result) == sorted(_positions(result))
    # The first slice out is the one that was last in.
    assert result.ordered[0].source_index == len(series) - 1


def test_ordering_is_correct_for_a_non_axial_orientation():
    """Sorting by the z of ImagePositionPatient is the common shortcut and is
    wrong the moment a series is not axial. Here the through-plane axis is x,
    so a z-sort would produce nothing at all."""
    slices = make_ct_series(count=20, orientation=(0, 1, 0, 0, 0, 1))
    for index, ds in enumerate(slices):
        ds.ImagePositionPatient = [index * 2.5, 0.0, 0.0]  # varies in x
    result = order_slices(metas(slices, shuffle_seed=4))
    assert result.trusted
    assert result.method == "image_position_patient"
    assert _positions(result) == sorted(_positions(result))
    assert result.median_spacing == pytest.approx(2.5)


def test_inconsistent_orientation_is_detected():
    series = make_ct_series(count=20)
    series[9].ImageOrientationPatient = [0, 1, 0, 0, 0, 1]
    result = order_slices(metas(series))
    assert not result.trusted
    assert any("orientation" in p for p in result.problems)


def test_duplicate_slice_positions_are_detected():
    series = make_ct_series(count=20, spacing=2.5)
    series[10].ImagePositionPatient = list(series[9].ImagePositionPatient)
    result = order_slices(metas(series))
    assert not result.trusted
    assert any("same position" in p for p in result.problems)


def test_missing_spatial_metadata_falls_back_and_says_so():
    series = make_ct_series(count=20)
    for ds in series:
        del ds.ImageOrientationPatient  # SliceLocation survives
    result = order_slices(metas(series, shuffle_seed=6))
    assert result.method == "slice_location"
    assert result.trusted, "reproducible, if less well founded"
    assert any("SliceLocation" in w for w in result.warnings)
    assert _positions(result) == sorted(_positions(result))


def test_no_spatial_metadata_at_all_is_never_trusted():
    series = make_ct_series(count=20)
    for ds in series:
        del ds.ImageOrientationPatient
        del ds.ImagePositionPatient
        del ds.SliceLocation
    result = order_slices(metas(series))
    assert result.method == "instance_number"
    assert not result.trusted
    assert any("no spatial metadata" in p.lower() for p in result.problems)


def test_a_degenerate_orientation_is_refused_rather_than_used():
    series = make_ct_series(count=20, orientation=(1, 0, 0, 1, 0, 0))  # parallel cosines
    result = order_slices(metas(series))
    assert not result.trusted
    assert any("degenerate" in p for p in result.problems)


def test_a_missing_slice_shows_up_as_an_irregular_gap():
    series = make_ct_series(count=30, spacing=2.5)
    del series[15]
    result = order_slices(metas(series))
    assert result.trusted, "ordering is fine; the gap is the gate's business"
    assert result.median_spacing == pytest.approx(2.5)
    assert max(result.spacings) == pytest.approx(5.0)


# ── on real data ───────────────────────────────────────────────────────────

@requires_lidc
def test_a_real_lidc_series_assembles_and_orders(lidc_nodule):
    """Shuffled real objects must reproduce the z-sorted anatomical order."""
    import glob
    import os

    import pydicom

    directory = os.path.dirname(lidc_nodule["abs_path"])
    files = sorted(glob.glob(os.path.join(directory, "*.dcm")))
    if len(files) < 20:
        pytest.skip("too few objects in this series directory")

    shuffled = files[:]
    random.Random(17).shuffle(shuffled)
    instances = [
        read_instance_metadata(pydicom.dcmread(f, stop_before_pixels=True, force=True), i)
        for i, f in enumerate(shuffled)
    ]

    members, report = assemble(instances)
    assert report["duplicatesDropped"] == 0
    assert report["modality"] == "CT"

    result = order_slices(members)
    assert result.method == "image_position_patient"
    assert result.trusted, result.problems

    truth = sorted(
        files,
        key=lambda f: float(
            pydicom.dcmread(f, stop_before_pixels=True, force=True).ImagePositionPatient[2]
        ),
    )
    assert [shuffled[m.source_index] for m in result.ordered] == truth
