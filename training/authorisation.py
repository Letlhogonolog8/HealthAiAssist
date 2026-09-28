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
        if not isinstance(owner, str) or _PLACEHOLDER_OWNER.search(owner):
            problems.append("decision %r is marked APPROVED with no assigned owner (%r)" % (decision_id, owner))
            pending.append(decision_id)
        if not isinstance(entry.get("role"), str) or not entry["role"].strip():
            problems.append("decision %r is marked APPROVED with no owner role" % decision_id)
            pending.append(decision_id)
        if not isinstance(entry.get("decidedOn"), str) or not _DATE.match(entry["decidedOn"]):
            problems.append("decision %r is marked APPROVED with no decision date (YYYY-MM-DD)" % decision_id)
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
