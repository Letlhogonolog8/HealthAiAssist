"""
scripts/validate-detector-on-lidc.py: a formal evaluation cannot be declared
ready until the owner has decided how it is to be run.

Before 2026-09-29 the script reported READY once a detector and a
localisation rule existed. The treatment of the four exposed test-split
series and the performance criterion were documented as prerequisites of
final evaluation but checked by nothing, so an evaluation could have run on
the exposed series under an unapproved criterion.
"""
from __future__ import annotations

import json

from training import authorisation
from training.tests.test_cli import run

SCRIPT = "scripts/validate-detector-on-lidc.py"


def _report():
    code, output = run(SCRIPT, "--json")
    start = output.index("{")
    return code, json.loads(output[start:output.rindex("}") + 1])


def test_evaluation_is_blocked_while_the_evaluation_decisions_are_pending():
    code, report = _report()
    assert code == 1
    assert report["status"] == "BLOCKED"
    blockers = {b["blocker"] for b in report["blockers"]}
    for decision in ("test-split-exposure", "localisation", "performance-criterion"):
        assert "decision_not_approved:%s" % decision in blockers, blockers
    assert "no_detector" in blockers
    assert report["noResultsProduced"] is True


def test_the_exposed_series_are_named_in_the_blocker():
    _code, report = _report()
    detail = next(b["detail"] for b in report["blockers"]
                  if b["blocker"] == "decision_not_approved:test-split-exposure")
    for patient in ("LIDC-IDRI-0481", "LIDC-IDRI-0447", "LIDC-IDRI-0951", "LIDC-IDRI-0059"):
        assert patient in detail


def test_decision_approved_uses_the_same_rules_as_training():
    record = {"decisions": [
        {"id": d, "status": "APPROVED", "owner": "A. Named Person", "role": "Methodology lead",
         "decidedOn": "2026-09-01", "decision": "Approved as specified in the register."}
        for d in authorisation.REQUIRED_DECISIONS
    ]}
    assert authorisation.decision_approved(record, "test-split-exposure") is True
    record["decisions"][1]["owner"] = "TBD"
    assert authorisation.decision_approved(record, "test-split-exposure") is False
    assert authorisation.decision_approved(authorisation.load(), "test-split-exposure") is False
