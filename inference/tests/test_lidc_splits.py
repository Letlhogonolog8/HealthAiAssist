"""
scripts/lidc_build_splits.py: who is in which split, and why it must not move.

The property that matters is patient disjointness. A patient has several
series, a series has many slices, a slice can carry several nodules — split on
any of those and the same person's anatomy lands on both sides of the line.
The model then sees a chest in training and is asked about that chest at test
time, and the figure measures memorisation while looking like success.

The second property is stability. A split that reshuffles when the collection
grows makes a model trained last month incomparable with one trained today,
which quietly destroys the ability to say whether a change helped.

Fixtures are synthetic patient tables built in the test. No real annotation is
asserted, and nothing here is a clinical label.
"""
from __future__ import annotations

import importlib.util
import os

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _load():
    path = os.path.join(ROOT, "scripts", "lidc_build_splits.py")
    spec = importlib.util.spec_from_file_location("lidc_build_splits", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


splits = _load()


def synthetic_rows(patients=60, series_per_patient=2, nodules_per_series=3):
    """A synthetic label table with the columns the real one has."""
    rows = []
    for p in range(patients):
        patient = f"SYN-{p:04d}"
        for s in range(series_per_patient):
            series_uid = f"1.2.3.{p}.{s}"
            for n in range(nodules_per_series):
                rows.append({
                    "patient": patient,
                    "series_uid": series_uid,
                    "nodule_index": str(n),
                    "label": "malignant" if (p + n) % 3 == 0 else "benign",
                })
    return rows


def build(rows, seed="test-seed"):
    return splits.build(rows, seed, splits.DEFAULT_FRACTIONS)


# ── patient disjointness ───────────────────────────────────────────────────

def test_every_patient_lands_in_exactly_one_split():
    rows = synthetic_rows()
    result = build(rows)
    findings = splits.audit_splits(rows, result["assignment"])

    assert findings["clean"], findings
    assert findings["patientsInMultipleSplits"] == []


def test_all_of_a_patients_series_stay_together():
    """Several series per patient is the case that catches a naive split."""
    rows = synthetic_rows(patients=40, series_per_patient=4)
    result = build(rows)

    by_patient = {}
    for row in rows:
        by_patient.setdefault(row["patient"], set()).add(result["assignment"][row["patient"]])
    assert all(len(v) == 1 for v in by_patient.values())

    findings = splits.audit_splits(rows, result["assignment"])
    assert findings["seriesInMultipleSplits"] == []


def test_all_of_a_patients_nodules_stay_together():
    rows = synthetic_rows(patients=30, nodules_per_series=5)
    result = build(rows)
    findings = splits.audit_splits(rows, result["assignment"])
    assert findings["nodulesInMultipleSplits"] == []


def test_the_audit_catches_a_deliberately_broken_assignment():
    """The audit must fail on leakage, or it is decorative."""
    rows = synthetic_rows(patients=20)
    result = build(rows)
    assignment = dict(result["assignment"])

    # Put one patient's rows on both sides by rewriting the table, which is the
    # shape a per-series split would produce.
    victim = rows[0]["patient"]
    broken_rows = [dict(r) for r in rows]
    for row in broken_rows:
        if row["patient"] == victim and row["series_uid"].endswith(".1"):
            row["patient"] = victim + "-COPY"
            assignment[row["patient"]] = (
                "test" if assignment[victim] != "test" else "train"
            )
            row["series_uid"] = rows[0]["series_uid"]  # same series, two patients

    findings = splits.audit_splits(broken_rows, assignment)
    assert not findings["clean"]
    assert findings["seriesInMultipleSplits"] or findings["seriesSharedByMultiplePatients"]


def test_an_unassigned_patient_is_reported_rather_than_dropped():
    rows = synthetic_rows(patients=10)
    result = build(rows)
    assignment = dict(result["assignment"])
    del assignment[rows[0]["patient"]]

    findings = splits.audit_splits(rows, assignment)
    assert not findings["clean"]
    assert rows[0]["patient"] in findings["unassignedPatients"]


# ── determinism and stability ──────────────────────────────────────────────

def test_the_same_seed_gives_the_same_assignment_every_time():
    rows = synthetic_rows()
    first = build(rows)["assignment"]
    for _ in range(4):
        assert build(rows)["assignment"] == first


def test_a_different_seed_gives_a_different_partition():
    rows = synthetic_rows()
    a = build(rows, seed="seed-a")["assignment"]
    b = build(rows, seed="seed-b")["assignment"]
    assert a != b


def test_adding_a_patient_moves_only_that_patient():
    """The reason assignment is hashed rather than shuffled. A shuffle would
    reassign everybody and make two training runs incomparable."""
    rows = synthetic_rows(patients=50)
    before = build(rows)["assignment"]

    extra = [{"patient": "SYN-9999", "series_uid": "1.2.3.9999.0",
              "nodule_index": "0", "label": "benign"}]
    after = build(rows + extra)["assignment"]

    assert "SYN-9999" in after
    for patient, split in before.items():
        assert after[patient] == split, f"{patient} moved from {split} to {after[patient]}"


def test_removing_a_patient_moves_nobody_else():
    rows = synthetic_rows(patients=50)
    before = build(rows)["assignment"]
    victim = rows[0]["patient"]
    kept = [r for r in rows if r["patient"] != victim]

    after = build(kept)["assignment"]
    for patient, split in after.items():
        assert before[patient] == split


def test_the_order_of_the_table_does_not_change_the_split():
    rows = synthetic_rows()
    shuffled = list(reversed(rows))
    assert build(rows)["assignment"] == build(shuffled)["assignment"]


def test_the_fingerprint_changes_with_the_seed_and_not_with_row_order():
    rows = synthetic_rows()
    a = splits.fingerprint({"seed": "x", "fractions": splits.DEFAULT_FRACTIONS,
                            "assignment": build(rows, "x")["assignment"]})
    a_again = splits.fingerprint({"seed": "x", "fractions": splits.DEFAULT_FRACTIONS,
                                  "assignment": build(list(reversed(rows)), "x")["assignment"]})
    b = splits.fingerprint({"seed": "y", "fractions": splits.DEFAULT_FRACTIONS,
                            "assignment": build(rows, "y")["assignment"]})
    assert a == a_again
    assert a != b


# ── the four splits ────────────────────────────────────────────────────────

def test_there_are_four_splits_including_a_separate_calibration_set():
    """Calibration is separate from validation because fitting a temperature
    on the set that chose the operating point measures the fit, not the model
    — and separate from test, which must stay untouched."""
    assert splits.SPLIT_ORDER == ("train", "validation", "calibration", "test")
    assert set(splits.DEFAULT_FRACTIONS) == set(splits.SPLIT_ORDER)
    assert abs(sum(splits.DEFAULT_FRACTIONS.values()) - 1.0) < 1e-9


def test_every_split_receives_patients_on_a_realistic_collection():
    rows = synthetic_rows(patients=200)
    summary = build(rows)["summary"]
    for name in splits.SPLIT_ORDER:
        assert summary[name]["patients"] > 0, name


def test_assignment_is_a_value_in_the_unit_interval():
    for patient in ("LIDC-IDRI-0001", "SYN-0001", ""):
        value = splits.assign(patient, "seed")
        assert 0.0 <= value < 1.0


def test_the_identity_used_is_the_source_patient_not_a_remapped_uid():
    """A salted production UID would make the split depend on a deployment
    secret and be irreproducible for anyone else."""
    import ast
    import inspect

    source = inspect.getsource(splits)
    assert "source LIDC patient id" in source

    # Checked on the imports, not on a substring: the module docstring names
    # uid_remap precisely to explain why it is not used, and a text search
    # cannot tell an explanation from a dependency.
    imported = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)

    assert not any("uid_remap" in name for name in imported), (
        f"the production remap must not be a dependency of the split: {sorted(imported)}"
    )
