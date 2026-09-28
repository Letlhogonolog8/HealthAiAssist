"""
training/authorisation.py: a real training run needs every methodology
decision approved by a named owner — not a GPU, not engineering readiness.

Until 2026-09-28 the only thing stopping a real run was the missing GPU. These
tests pin that the decisions now stop it too, from the command line and from
the trainer called directly.
"""
from __future__ import annotations

import copy
import json

import pytest

from training import authorisation
from training import dataset as ds
from training import trainer
from training.tests.test_training import run, sets, small_config


def _approved_record():
    """A synthetic, fully approved record. Built in the test; never on disk."""
    return {
        "decisions": [
            {"id": d, "status": "APPROVED", "owner": "A. Named Person", "role": "Methodology lead",
             "decidedOn": "2026-10-01", "decision": "Approved as specified in section X of the register."}
            for d in authorisation.REQUIRED_DECISIONS
        ]
    }


def _with(record, decision_id, **changes):
    record = copy.deepcopy(record)
    for entry in record["decisions"]:
        if entry["id"] == decision_id:
            entry.update(changes)
    return record


# ── the repository record ─────────────────────────────────────────────────

def test_the_repository_record_lists_exactly_the_nine_decisions():
    record = authorisation.load()
    ids = [d["id"] for d in record["decisions"]]
    assert sorted(ids) == sorted(authorisation.REQUIRED_DECISIONS)
    assert len(ids) == len(set(ids)) == 9


def test_every_decision_in_the_repository_is_still_pending():
    """No owner is assigned and nothing is approved. Recording a real approval
    must update this test in the same change, deliberately."""
    for entry in authorisation.load()["decisions"]:
        assert entry["status"] == "PENDING", entry["id"]
        assert entry["owner"] is None and entry["decidedOn"] is None, entry["id"]


def test_the_repository_does_not_authorise_training():
    verdict = authorisation.assess(authorisation.load())
    assert verdict["authorised"] is False
    assert verdict["pending"] == list(authorisation.REQUIRED_DECISIONS)
    with pytest.raises(authorisation.NotAuthorised):
        authorisation.require_authorisation()


def test_there_is_no_override_path():
    """A way to point the gate elsewhere is a way round it."""
    import inspect

    assert inspect.signature(authorisation.require_authorisation).parameters == {}
    source = inspect.getsource(authorisation)
    assert "os.environ" not in source and "getenv" not in source


# ── what counts as approval ───────────────────────────────────────────────

def test_a_fully_approved_record_authorises():
    verdict = authorisation.assess(_approved_record())
    assert verdict["authorised"] is True, verdict


@pytest.mark.parametrize("status", ["PENDING", "REJECTED", "DEFERRED"])
def test_one_decision_not_approved_refuses(status):
    verdict = authorisation.assess(_with(_approved_record(), "localisation", status=status))
    assert verdict["authorised"] is False
    assert verdict["pending"] == ["localisation"]


@pytest.mark.parametrize("owner", [None, "", "OWNER NOT YET ASSIGNED", "owner not assigned", "TBD", "N/A", "---"])
def test_approval_without_an_assigned_owner_refuses(owner):
    verdict = authorisation.assess(_with(_approved_record(), "performance-criterion", owner=owner))
    assert verdict["authorised"] is False
    assert "performance-criterion" in verdict["pending"]


@pytest.mark.parametrize("field,value", [
    ("role", None), ("role", " "),
    ("decidedOn", None), ("decidedOn", "soon"), ("decidedOn", "28/09/2026"),
    ("decision", None), ("decision", "ok"),
])
def test_approval_missing_what_was_decided_or_when_refuses(field, value):
    verdict = authorisation.assess(_with(_approved_record(), "sampling", **{field: value}))
    assert verdict["authorised"] is False


def test_a_missing_decision_refuses():
    record = _approved_record()
    record["decisions"] = [d for d in record["decisions"] if d["id"] != "test-split-exposure"]
    verdict = authorisation.assess(record)
    assert verdict["authorised"] is False
    assert "test-split-exposure" in verdict["pending"]


def test_an_unknown_status_refuses():
    verdict = authorisation.assess(_with(_approved_record(), "ct-geometry", status="APPROVED-ISH"))
    assert verdict["authorised"] is False


def test_a_duplicated_decision_is_a_problem():
    record = _approved_record()
    record["decisions"].append(copy.deepcopy(record["decisions"][0]))
    assert authorisation.assess(record)["authorised"] is False


def test_no_decisions_at_all_refuses():
    assert authorisation.assess({})["authorised"] is False
    assert authorisation.assess(json.loads('{"decisions": "all approved"}'))["authorised"] is False


# ── the trainer, called directly ──────────────────────────────────────────

def test_the_trainer_refuses_lidc_data_without_authorisation(training_config, tmp_path):
    config = small_config(training_config)
    train_set, val_set = sets(config)
    train_set.kind = val_set.kind = ds.KIND_LIDC
    with pytest.raises(trainer.TrainingRefused, match="not authorised"):
        run(config, tmp_path, epochs=1, train_set=train_set, val_set=val_set, device="cuda")


def test_synthetic_harness_runs_need_no_authorisation(training_config, tmp_path):
    """Synthetic runs train nothing real; they must keep working for the harness tests."""
    config = small_config(training_config)
    result = run(config, tmp_path, epochs=1)
    assert result["experiment"]["status"] != "REFUSED"
