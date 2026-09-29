"""
Whether a real detector training run is authorised — read from a record an
owner signs, never inferred.

── Why this exists ────────────────────────────────────────────────────────

Until 2026-09-28 the harness recorded the localisation and performance-bar
status and said, in its own gate output, "training does not depend on
either". The only thing stopping a real run was the absence of a GPU. The day
a CUDA machine appeared, training would have started with all nine
methodology decisions in docs/P2_TRAINING_GATE_DECISION_REGISTER.md still
PENDING and nobody assigned to make them.

Engineering readiness is not authorisation. This module reads
docs/decisions/p2-training-authorisation.json and answers one question: has
every required decision been APPROVED, by someone, on a date, with what was
decided written down?

── What it deliberately does not do ───────────────────────────────────────

It takes no path from the environment and has no override flag. A way to
point it at a different file is a way to authorise training without the
record, which is the thing it exists to prevent. Tests call `assess` on a
dictionary instead.

It does not judge a decision. APPROVED with a named owner is authorisation as
far as the harness is concerned; whether the decision is sound is for the
people making it, and the record keeps what they decided next to who decided
it.
"""
from __future__ import annotations

import datetime
import json
import re
from typing import Any, Dict, List

from training import _paths

RECORD_PATH = _paths.TRAINING_AUTHORISATION

REQUIRED_DECISIONS = (
    "lung-mask-v4",
    "test-split-exposure",
    "dataset-ratification",
    "same-reader-clusters",
    "ct-geometry",
    "detector-input",
    "sampling",
    "localisation",
    "performance-criterion",
)

STATUSES = ("PENDING", "APPROVED", "REJECTED", "DEFERRED")

# An owner written as one of these has not been assigned.
_PLACEHOLDER_OWNER = re.compile(
    r"^\s*$|not\s+(yet\s+)?assigned|unassigned|\btbd\b|\btbc\b|placeholder|\bunknown\b|\bn/?a\b|^-+$",
    re.IGNORECASE,
)
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _real_past_date(value: Any) -> bool:
    """A real calendar date, not in the future. A decision cannot predate itself."""
    if not isinstance(value, str) or not _DATE.match(value):
        return False
    try:
        return datetime.date.fromisoformat(value) <= datetime.date.today()
    except ValueError:
        return False


def _real_owner(value: Any) -> bool:
    return isinstance(value, str) and not _PLACEHOLDER_OWNER.search(value)


class NotAuthorised(Exception):
    """Training is not authorised; `reasons` says which decisions and why."""

    def __init__(self, reasons: List[str]):
        super().__init__("; ".join(reasons))
        self.reasons = reasons


def assess(record: Dict[str, Any]) -> Dict[str, Any]:
    """Every problem with the record, and whether it authorises training."""
    problems: List[str] = []
    pending: List[str] = []
    decisions = record.get("decisions")
    if not isinstance(decisions, list):
        return {"authorised": False, "pending": list(REQUIRED_DECISIONS),
                "problems": ["the record has no list of decisions"]}

    by_id: Dict[str, Dict[str, Any]] = {}
    for entry in decisions:
        if not isinstance(entry, dict) or not entry.get("id"):
            problems.append("a decision entry has no id")
            continue
        if entry["id"] in by_id:
            problems.append("decision %r appears twice" % entry["id"])
        by_id[entry["id"]] = entry

    for decision_id in REQUIRED_DECISIONS:
        entry = by_id.get(decision_id)
        if entry is None:
            problems.append("decision %r is missing from the record" % decision_id)
            pending.append(decision_id)
            continue
        status = entry.get("status")
        if status not in STATUSES:
            problems.append("decision %r has status %r, not one of %s" % (decision_id, status, list(STATUSES)))
            pending.append(decision_id)
            continue
        if status != "APPROVED":
            pending.append(decision_id)
            continue
        owner = entry.get("owner")
        if not _real_owner(owner):
            problems.append("decision %r is marked APPROVED with no assigned owner (%r)" % (decision_id, owner))
            pending.append(decision_id)
        if not isinstance(entry.get("role"), str) or not entry["role"].strip():
            problems.append("decision %r is marked APPROVED with no owner role" % decision_id)
            pending.append(decision_id)
        if not _real_past_date(entry.get("decidedOn")):
            problems.append("decision %r is marked APPROVED without a real, past decision date (YYYY-MM-DD): %r"
                            % (decision_id, entry.get("decidedOn")))
            pending.append(decision_id)
        if not isinstance(entry.get("decision"), str) or len(entry["decision"].strip()) < 10:
            problems.append("decision %r is marked APPROVED but does not say what was decided" % decision_id)
            pending.append(decision_id)

    unexpected = sorted(set(by_id) - set(REQUIRED_DECISIONS))
    pending = sorted(set(pending), key=REQUIRED_DECISIONS.index)
    return {
        "authorised": not pending and not problems,
        "pending": pending,
        "problems": problems,
        "unrecognised": unexpected,
    }


# The mask an approval of "lung-mask-v4" covers. If the implementation moves
# on, the approval does not follow it: a new version needs a new decision.
APPROVED_MASK_VERSION = "lung-threshold-v4"


def consistency(record: Dict[str, Any], bar: Dict[str, Any], mask_version: str) -> List[str]:
    """Problems where an approval disagrees with the evidence it depends on.

    An approval recorded here must match what the pre-registration and the
    code actually say. Otherwise the record could approve a performance
    criterion the bar still marks DRAFT, a localisation rule the evaluator
    would refuse, or a mask that is no longer the one in the code.
    """
    problems: List[str] = []
    status = {d.get("id"): d.get("status") for d in record.get("decisions", []) if isinstance(d, dict)}

    if status.get("performance-criterion") == "APPROVED":
        approval = bar.get("proposedGate", {}).get("approval", {})
        if approval.get("approved") is not True or not _real_owner(approval.get("approvedBy"))                 or not _real_past_date(approval.get("approvedOn")):
            problems.append("performance-criterion is APPROVED here but docs/bars/p2.json does not record an "
                            "approved performance gate signed by a named person on a real, past date")
    if status.get("localisation") == "APPROVED":
        tolerance = bar.get("metrics", {}).get("localisationTolerance", {})
        rule = tolerance.get("rule")
        if tolerance.get("status") != "APPROVED" or not isinstance(rule, dict):
            problems.append("localisation is APPROVED here but docs/bars/p2.json does not carry an APPROVED "
                            "tolerance with a machine-readable rule")
        else:
            if not _real_owner(tolerance.get("approvedBy")) or not _real_past_date(tolerance.get("approvedOn")):
                problems.append("localisation is APPROVED here but the tolerance in docs/bars/p2.json is not "
                                "signed by a named person on a real, past date")
            rule_problem = _evaluator_refuses(rule)
            if rule_problem:
                problems.append("localisation is APPROVED here but the evaluator would refuse the recorded "
                                "rule: %s" % rule_problem)
    if status.get("lung-mask-v4") == "APPROVED" and mask_version != APPROVED_MASK_VERSION:
        problems.append("lung-mask-v4 is APPROVED but the code implements %s; a changed mask needs its own "
                        "decision" % mask_version)
    return problems


def _evaluator_refuses(rule: Dict[str, Any]) -> str:
    """Why inference/detection_eval.py would refuse this rule, or "" if it accepts it.

    Built exactly as `rule_from_bar` builds it, so the gate and the evaluator
    cannot disagree about what a usable rule is.
    """
    _paths.ensure_inference_on_path()
    import detection_eval  # noqa: PLC0415

    try:
        detection_eval.MatchRule(
            basis=rule.get("basis"),
            duplicate_policy=rule.get("duplicatePolicy"),
            fixed_radius_mm=rule.get("fixedRadiusMm"),
            floor_mm=rule.get("floorMm"),
            ceiling_mm=rule.get("ceilingMm"),
        )
    except (ValueError, TypeError) as exc:
        return str(exc)
    return ""


def decision_approved(record: Dict[str, Any], decision_id: str) -> bool:
    """Whether one decision is validly APPROVED, by exactly the rules training uses."""
    return decision_id not in assess(record)["pending"]


def load() -> Dict[str, Any]:
    with open(RECORD_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def require_authorisation() -> str:
    """Raise NotAuthorised unless the repository record authorises training."""
    try:
        record = load()
    except (OSError, ValueError) as exc:
        raise NotAuthorised(["the authorisation record could not be read (%s)" % exc])
    verdict = assess(record)
    _paths.ensure_inference_on_path()
    from lung_mask import MASK_VERSION  # noqa: PLC0415

    with open(_paths.BAR, encoding="utf-8") as handle:
        bar = json.load(handle)
    mismatches = consistency(record, bar, MASK_VERSION)
    if mismatches:
        verdict = dict(verdict, authorised=False, problems=list(verdict["problems"]) + mismatches)
    if not verdict["authorised"]:
        reasons = list(verdict["problems"])
        not_approved = [d for d in verdict["pending"]
                        if not any(("%r" % d) in p for p in verdict["problems"])]
        if not_approved:
            reasons.append("not approved: %s" % ", ".join(not_approved))
        reasons.append("see docs/P2_TRAINING_GATE_DECISION_REGISTER.md")
        raise NotAuthorised(reasons)
    return "all %d decisions approved in %s" % (
        len(REQUIRED_DECISIONS), RECORD_PATH.replace("\\", "/").split("/docs/")[-1])
