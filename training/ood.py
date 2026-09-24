"""
Detector out-of-distribution screening: the interface and its refusal
semantics. No detector OOD reference exists.

── Status: NOT BUILT ──────────────────────────────────────────────────────

The characteriser's OOD reference is fitted on 224x224 RGB patch features and
is never reused for the detector, which consumes HU volumes. A detector
reference must be built from a trained detector's own features, validated in
both directions with bars set before measuring — the rule
`scripts/build-ood-reference.py` already enforces — and none of that can
happen without a detector.

── Four outcomes that must never be confused ──────────────────────────────

A future detector run on one series ends in exactly one of these, and a
report, a UI or an evaluation that merges any two of them misstates what
happened:

    OOD_REFUSED           the series was screened and judged unlike the
                          training distribution; it was NOT searched
    INFERENCE_FAILED      the search did not complete; nothing is known
    ZERO_CANDIDATES       the series WAS searched and nothing scored above
                          threshold — the only one of the four that is a
                          search result, and even it is not "no nodule"
    CANDIDATES_PROPOSED   the series was searched and produced candidates

`inference/detection_eval.py` already keeps the first two out of both
denominators; `outcome_for_evaluation` maps these names onto its states so the
two modules cannot drift.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

OOD_STATUS = "NOT BUILT — no trained detector"

OOD_REFUSED = "OOD_REFUSED"
INFERENCE_FAILED = "INFERENCE_FAILED"
ZERO_CANDIDATES = "ZERO_CANDIDATES"
CANDIDATES_PROPOSED = "CANDIDATES_PROPOSED"

OUTCOMES = (OOD_REFUSED, INFERENCE_FAILED, ZERO_CANDIDATES, CANDIDATES_PROPOSED)
SEARCHED = frozenset({ZERO_CANDIDATES, CANDIDATES_PROPOSED})


class DetectorOodUnavailable(Exception):
    """No detector OOD reference exists, so no series can be screened."""


class DetectorOodScreen(object):
    """What a detector OOD screen must provide once one exists."""

    version: str = ""

    def score(self, features: Any) -> float:  # pragma: no cover - interface
        raise NotImplementedError

    def threshold(self) -> float:  # pragma: no cover - interface
        raise NotImplementedError


def current_screen() -> Optional[DetectorOodScreen]:
    """There is none. Callers must treat that as unavailable, not as a pass."""
    return None


def require_screen() -> DetectorOodScreen:
    screen = current_screen()
    if screen is None:
        raise DetectorOodUnavailable(
            "No detector OOD reference has been built. A series cannot be declared "
            "in-distribution for a detector that does not exist."
        )
    return screen


def classify(*, ood_refused: bool, failed: bool, candidate_count: Optional[int]) -> str:
    """One outcome, from what actually happened. Ambiguity raises."""
    if ood_refused and failed:
        raise ValueError("a series cannot be both OOD-refused and failed")
    if ood_refused:
        return OOD_REFUSED
    if failed:
        return INFERENCE_FAILED
    if candidate_count is None:
        raise ValueError("a searched series must report a candidate count, including zero")
    return ZERO_CANDIDATES if candidate_count == 0 else CANDIDATES_PROPOSED


def outcome_for_evaluation(outcome: str) -> str:
    """The matching scan outcome in inference/detection_eval.py."""
    mapping: Dict[str, str] = {
        OOD_REFUSED: "refused_ood",
        INFERENCE_FAILED: "failed",
        ZERO_CANDIDATES: "evaluated",
        CANDIDATES_PROPOSED: "evaluated",
    }
    if outcome not in mapping:
        raise ValueError("unknown outcome %r" % outcome)
    return mapping[outcome]
