"""
training/manifest.py: the committed split, verified, and the split gate.

Synthetic patient tables are built with the real split builder so the
fingerprints are computed exactly as the committed manifest's were. Their
patient ids are shaped like source LIDC ids (LIDC-IDRI-9xxx, a range the
collection does not use) because the verifier refuses anything else.
"""
from __future__ import annotations

import copy
import importlib.util
import os

import pytest

from training import _paths
from training import manifest as mf

ROOT = _paths.ROOT


def _splits_module():
    spec = importlib.util.spec_from_file_location(
        "lidc_build_splits", os.path.join(ROOT, "scripts", "lidc_build_splits.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def synthetic(patients=80):
    splits = _splits_module()
    rows = []
    for p in range(patients):
        patient = "LIDC-IDRI-9%03d" % p
        for n in range(2):
            rows.append({"patient": patient, "series_uid": "1.2.3.%d" % p, "nodule_index": str(n),
                         "sop_uid": "1.2.3.%d.%d" % (p, n), "cx": "100", "cy": "120", "z": "-50.0",
                         "label": "benign"})
    built = splits.build(rows, "test-seed", splits.DEFAULT_FRACTIONS)
    manifest = {"version": "t", "seed": "test-seed", "fractions": splits.DEFAULT_FRACTIONS,
                "assignment": built["assignment"], "identity": "source LIDC patient id"}
    manifest["fingerprint"] = splits.fingerprint(
        {"seed": "test-seed", "fractions": splits.DEFAULT_FRACTIONS, "assignment": built["assignment"]})
    return manifest, rows


# ── the gate ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("split,purpose", [
    ("train", mf.PURPOSE_FIT),
    ("validation", mf.PURPOSE_SELECT),
    ("calibration", mf.PURPOSE_CALIBRATE),
    ("test", mf.PURPOSE_EVALUATE),
])
def test_each_purpose_may_read_its_own_split(split, purpose):
    mf.require_split(split, purpose)


@pytest.mark.parametrize("split,purpose", [
    ("test", mf.PURPOSE_FIT),
    ("calibration", mf.PURPOSE_FIT),
    ("validation", mf.PURPOSE_FIT),
    ("test", mf.PURPOSE_SELECT),
    ("calibration", mf.PURPOSE_SELECT),
    ("test", mf.PURPOSE_CALIBRATE),
    ("validation", mf.PURPOSE_CALIBRATE),
    ("train", mf.PURPOSE_EVALUATE),
])
def test_no_purpose_reads_another_purposes_split(split, purpose):
    with pytest.raises(mf.SplitAccessDenied):
        mf.require_split(split, purpose)


def test_an_unknown_purpose_or_split_is_refused():
    with pytest.raises(mf.SplitAccessDenied):
        mf.require_split("train", "peek")
    with pytest.raises(mf.SplitAccessDenied):
        mf.require_split("holdout", mf.PURPOSE_FIT)


def test_rows_for_split_applies_the_gate_before_filtering():
    manifest, rows = synthetic()
    with pytest.raises(mf.SplitAccessDenied):
        mf.rows_for_split(rows, manifest["assignment"], "test", mf.PURPOSE_FIT)


# ── verification ───────────────────────────────────────────────────────────

def test_a_consistent_manifest_verifies():
    manifest, rows = synthetic()
    report = mf.verify(manifest, rows, manifest["fingerprint"])
    assert report["clean"], report["problems"]
    assert all(count == 0 for count in report["patientIntersections"].values())
    assert len(report["patientIntersections"]) == 6


def test_an_edited_assignment_breaks_its_own_fingerprint():
    manifest, rows = synthetic()
    tampered = copy.deepcopy(manifest)
    patient = sorted(tampered["assignment"])[0]
    tampered["assignment"][patient] = "test" if tampered["assignment"][patient] != "test" else "train"
    report = mf.verify(tampered, rows, manifest["fingerprint"])
    assert not report["clean"]
    assert any("does not match its own contents" in p for p in report["problems"])


def test_a_substituted_split_fails_the_pinned_fingerprint():
    manifest, rows = synthetic()
    report = mf.verify(manifest, rows, "0000000000000000")
    assert any("not the pinned" in p for p in report["problems"])


def test_no_pinned_fingerprint_is_a_problem():
    manifest, rows = synthetic()
    assert not mf.verify(manifest, rows, None)["clean"]


def test_a_patient_in_two_splits_is_caught():
    """The label table gives one patient's two series to two different ids —
    the shape a per-series split produces."""
    manifest, rows = synthetic()
    assignment = manifest["assignment"]
    first = rows[0]["patient"]
    other = next(p for p in sorted(assignment) if assignment[p] != assignment[first])
    broken = [dict(r) for r in rows]
    broken.append(dict(rows[0], patient=other))   # same series, different patient and split
    report = mf.verify(manifest, broken, manifest["fingerprint"])
    assert not report["clean"]
    assert any("leakage audit" in p for p in report["problems"])


def test_a_duplicate_series_across_splits_is_caught():
    manifest, rows = synthetic()
    assignment = manifest["assignment"]
    a = rows[0]
    b = next(r for r in rows if assignment[r["patient"]] != assignment[a["patient"]])
    broken = [dict(r) for r in rows]
    broken.append(dict(b, series_uid=a["series_uid"], nodule_index="99"))
    assert not mf.verify(manifest, broken, manifest["fingerprint"])["clean"]


def test_a_salted_production_uid_is_not_a_patient_identity():
    manifest, rows = synthetic()
    tampered = copy.deepcopy(manifest)
    tampered["assignment"]["2.25.123456789"] = "train"
    report = mf.verify(tampered, rows, tampered["fingerprint"])
    assert any("patient identity cannot be established" in p for p in report["problems"])


def test_a_blank_patient_identity_is_refused():
    manifest, rows = synthetic()
    tampered = copy.deepcopy(manifest)
    tampered["assignment"][""] = "train"
    assert not mf.verify(tampered, rows, tampered["fingerprint"])["clean"]


def test_a_label_row_without_its_identity_fields_is_refused():
    manifest, rows = synthetic()
    broken = [dict(r) for r in rows]
    broken[3]["sop_uid"] = ""
    report = mf.verify(manifest, broken, manifest["fingerprint"])
    assert any("identity cannot be established" in p for p in report["problems"])


def test_missing_manifest_fields_fail_closed():
    manifest, rows = synthetic()
    del manifest["assignment"]
    assert not mf.verify(manifest, rows, "x")["clean"]


def test_the_split_fingerprint_matches_the_builder():
    manifest, _ = synthetic()
    assert mf.split_fingerprint(manifest) == manifest["fingerprint"]


# ── the committed manifest ─────────────────────────────────────────────────

def test_the_committed_manifest_verifies_against_the_real_label_table():
    if not os.path.exists(_paths.LABEL_TABLE):
        pytest.skip("dataset/lidc-labels.csv is gitignored and absent in this checkout")
    verified = mf.verified_manifest("f55f6cd5188ae3ee")
    assert verified["report"]["patientsPerSplit"] == {
        "train": 474, "validation": 93, "calibration": 71, "test": 102}


def test_the_committed_manifest_fingerprint_is_self_consistent():
    """Needs only the tracked manifest, so it runs everywhere."""
    manifest = mf.load_manifest()
    assert mf.split_fingerprint(manifest) == manifest["fingerprint"] == "f55f6cd5188ae3ee"


# ── dataset fingerprint ────────────────────────────────────────────────────

def test_the_dataset_fingerprint_moves_when_the_labels_move(tmp_path):
    manifest_file = tmp_path / "m.json"
    manifest_file.write_text("{}", encoding="utf-8")
    labels = tmp_path / "labels.csv"
    labels.write_text("patient\nA\n", encoding="utf-8")

    def fp():
        return mf.dataset_fingerprint(
            manifest_path=str(manifest_file), labels_path=str(labels), exclusions_path=None,
            decision_path=str(tmp_path / "absent.md"), preprocessing={"v": 1}, sampling={"s": 1},
            series_by_split={"train": ["b", "a"]})["fingerprint"]

    first = fp()
    assert first == fp()
    labels.write_text("patient\nB\n", encoding="utf-8")
    assert fp() != first


def test_the_dataset_fingerprint_does_not_depend_on_series_order(tmp_path):
    manifest_file = tmp_path / "m.json"
    manifest_file.write_text("{}", encoding="utf-8")
    labels = tmp_path / "l.csv"
    labels.write_text("x", encoding="utf-8")
    common = dict(manifest_path=str(manifest_file), labels_path=str(labels), exclusions_path=None,
                  decision_path=str(tmp_path / "d.md"), preprocessing={}, sampling={})
    a = mf.dataset_fingerprint(series_by_split={"train": ["1", "2"]}, **common)
    b = mf.dataset_fingerprint(series_by_split={"train": ["2", "1"]}, **common)
    assert a["fingerprint"] == b["fingerprint"]
    # The record carries a hash and a count per split, never the identifiers.
    digest = a["parts"]["seriesBySplitSha256"]["train"]
    assert isinstance(digest, str) and len(digest) == 64
    assert a["parts"]["seriesCountBySplit"] == {"train": 2}
    assert not any(isinstance(v, list) for v in a["parts"]["seriesBySplitSha256"].values())
