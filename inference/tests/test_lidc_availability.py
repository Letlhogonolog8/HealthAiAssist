"""
docs/splits/lidc-availability.json: that it still describes the split it claims to.

The availability index and the split manifest are produced by two different
scripts at two different times, and the whole point of the index is to stop a
split size being quoted when a third of it has no pixel data on this machine.
An index computed against a superseded split would do the opposite — it would
attach believable-looking availability counts to the wrong partition.

So the checks here are consistency checks, not measurements. They read what
the scripts wrote and refuse to let the two drift apart. Nothing here requires
pydicom or the collection on disk.
"""
from __future__ import annotations

import json
import os

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SPLITS = os.path.join(ROOT, "docs", "splits", "lidc-split-v1.json")
AVAILABILITY = os.path.join(ROOT, "docs", "splits", "lidc-availability.json")

SPLIT_ORDER = ("train", "validation", "calibration", "test")


def load(path):
    if not os.path.exists(path):
        pytest.skip("%s has not been generated in this working copy"
                    % os.path.relpath(path, ROOT))
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(scope="module")
def splits():
    return load(SPLITS)


@pytest.fixture(scope="module")
def availability():
    return load(AVAILABILITY)


def test_the_availability_index_names_the_split_it_was_computed_for(availability, splits):
    """The guard that makes every other count in the file meaningful."""
    assert availability["splitFingerprint"] == splits["fingerprint"], (
        "the availability index was computed against a different split. Re-run "
        "python scripts/lidc_series_availability.py"
    )


def test_assigned_counts_agree_with_the_split_manifest(availability, splits):
    for name in SPLIT_ORDER:
        assert availability["perSplit"][name]["seriesAssigned"] == splits["summary"][name]["series"]
        assert availability["perSplit"][name]["nodulesAssigned"] == splits["summary"][name]["nodules"]


def test_nothing_is_available_that_was_not_assigned(availability):
    for name in SPLIT_ORDER:
        block = availability["perSplit"][name]
        assert block["seriesAvailable"] <= block["seriesAssigned"]
        assert block["nodulesAvailable"] <= block["nodulesAssigned"]
        assert block["patientsAvailable"] <= block["seriesAvailable"]


def test_the_per_split_availability_sums_to_the_total(availability):
    total = sum(availability["perSplit"][name]["seriesAvailable"] for name in SPLIT_ORDER)
    assert total == availability["seriesAvailable"] == len(availability["availableSeries"])


def test_available_series_are_distinct(availability):
    listed = availability["availableSeries"]
    assert len(set(listed)) == len(listed)


def test_availability_never_exceeds_what_is_on_disk(availability):
    assert availability["seriesAvailable"] <= availability["seriesWithPixelDataOnDisk"]
    assert availability["seriesAvailable"] <= availability["seriesNamedInLabelTable"]


def test_a_non_ct_series_would_be_reported_rather_than_silently_counted(availability):
    """The field exists and is a list. An empty one is a measurement, not an
    absence of one — this collection happens to be all CT."""
    assert isinstance(availability["nonCtSeriesAvailable"], list)
    assert isinstance(availability["seriesOnDiskNotInLabelTable"], list)


def test_the_index_says_what_it_is_not(availability):
    """Availability is an inventory. It is not a quality-gate pass."""
    assert "not a statement that any series is usable" in availability["whatThisIsNot"]
    assert "quality gate" in availability["whatThisIsNot"]


def test_the_index_records_why_the_smaller_number_is_the_one_that_matters(availability):
    assert "overstate the evidence" in availability["consequence"]


def test_the_split_manifest_itself_still_passes_its_own_leakage_audit(splits):
    audit = splits["leakageAudit"]
    assert audit["clean"] is True
    for key in ("patientsInMultipleSplits", "seriesInMultipleSplits",
                "nodulesInMultipleSplits", "seriesSharedByMultiplePatients",
                "unassignedPatients", "duplicateNoduleKeys"):
        assert audit[key] == 0, "%s: %s" % (key, audit[key])
