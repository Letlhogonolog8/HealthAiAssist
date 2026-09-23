#!/usr/bin/env python3
"""
FROC evaluation for a nodule candidate detector.

Nothing here measures anything on its own. It is the arithmetic that turns
"these candidates, those reference nodules" into sensitivity and false
positives per scan, written before a detector exists so that the metric cannot
be chosen after seeing a result.

── The rule is an argument, never a default ───────────────────────────────

Deciding whether a proposed candidate *is* a given reference nodule needs a
matching rule, and that rule is a methodology decision recorded as PENDING in
docs/P2_LOCALIZATION_METHODOLOGY.md. Every entry point here demands a
MatchRule and there is no default one, because a default would silently become
the decision. `rule_from_bar` refuses while the bar says the tolerance is not
settled, and raises MethodologyUndecided rather than returning something
usable.

── Refusal is not a negative ──────────────────────────────────────────────

A scan that was refused by the quality gate or the OOD screen, or that failed,
was not searched. It produced no detection and no false positive, and its
reference nodules were never offered to the detector. Counting those nodules
as missed would report a refusal as a failure to detect; dropping them
silently would hide how much of the collection was never examined. So they are
excluded from both denominators and reported in their own right, with the
reason kept distinct — OOD, quality, failure and not-run are four different
operational states and an operator reading a report has to be able to tell
them apart.

── What it does not do ────────────────────────────────────────────────────

It does not interpolate. An operating point is a threshold that was actually
swept, not a value read off a line drawn between two of them. If no threshold
reaches the requested false-positive rate, that is reported as unreachable
rather than approximated.

It does not decide whether a number is good. The gate in docs/bars/p2.json is
PROPOSED and unapproved; comparing against it is informational and is labelled
that way wherever it appears.
"""
from __future__ import annotations

import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BAR_PATH = os.path.join(ROOT, "docs", "bars", "p2.json")

# The four ways a scan can leave the denominator, kept apart on purpose.
OUTCOME_EVALUATED = "evaluated"
OUTCOME_REFUSED_OOD = "refused_ood"
OUTCOME_REFUSED_QUALITY = "refused_quality"
OUTCOME_FAILED = "failed"
OUTCOME_NOT_RUN = "not_run"

SCAN_OUTCOMES = (
    OUTCOME_EVALUATED,
    OUTCOME_REFUSED_OOD,
    OUTCOME_REFUSED_QUALITY,
    OUTCOME_FAILED,
    OUTCOME_NOT_RUN,
)

# Ways a rule can measure the distance it allows.
BASIS_FIXED = "fixed_radius_mm"
BASIS_MAX_IN_PLANE = "max_in_plane_diameter_mm"
BASIS_EQUIVALENT_AREA = "equivalent_area_diameter_mm"
MATCH_BASES = (BASIS_FIXED, BASIS_MAX_IN_PLANE, BASIS_EQUIVALENT_AREA)

# What a second candidate on an already-matched nodule counts as. Which of
# these is right is part of the pending decision, so neither is a default.
DUPLICATE_IS_FALSE_POSITIVE = "false_positive"
DUPLICATE_IS_IGNORED = "ignored"
DUPLICATE_POLICIES = (DUPLICATE_IS_FALSE_POSITIVE, DUPLICATE_IS_IGNORED)


class MethodologyUndecided(Exception):
    """Raised when an evaluation is attempted without a settled matching rule."""


class MatchRule(object):
    """How far a candidate centre may be from a reference centroid.

    Every field is required. There is no default rule and no default
    tolerance, because the point of docs/P2_LOCALIZATION_METHODOLOGY.md is
    that somebody chooses these deliberately and records why.
    """

    def __init__(self, basis, duplicate_policy, fixed_radius_mm=None,
                 floor_mm=None, ceiling_mm=None, source=None):
        if basis not in MATCH_BASES:
            raise ValueError("basis must be one of %s, got %r" % (list(MATCH_BASES), basis))
        if duplicate_policy not in DUPLICATE_POLICIES:
            raise ValueError(
                "duplicate_policy must be one of %s, got %r"
                % (list(DUPLICATE_POLICIES), duplicate_policy)
            )
        if basis == BASIS_FIXED:
            if fixed_radius_mm is None:
                raise ValueError("a fixed-radius rule needs fixed_radius_mm")
            if fixed_radius_mm <= 0:
                raise ValueError("fixed_radius_mm must be positive")
        elif fixed_radius_mm is not None:
            raise ValueError("fixed_radius_mm is meaningless for basis %r" % basis)
        if floor_mm is not None and floor_mm <= 0:
            raise ValueError("floor_mm must be positive")
        if ceiling_mm is not None and floor_mm is not None and ceiling_mm < floor_mm:
            raise ValueError("ceiling_mm is below floor_mm")

        self.basis = basis
        self.duplicate_policy = duplicate_policy
        self.fixed_radius_mm = fixed_radius_mm
        self.floor_mm = floor_mm
        self.ceiling_mm = ceiling_mm
        # Where the rule came from, carried into the report so that a figure is
        # never separable from the decision that made it computable.
        self.source = source or "UNRECORDED — this rule has no decision record"

    def tolerance_for(self, reference):
        """The permitted centre-to-centre distance for one reference nodule."""
        if self.basis == BASIS_FIXED:
            tolerance = float(self.fixed_radius_mm)
        else:
            diameter = reference.get(self.basis)
            if diameter is None:
                raise ValueError(
                    "reference nodule %r has no %s, so this rule cannot be applied to it. "
                    "Nodules without the measurement the rule needs must be excluded "
                    "explicitly, not matched by a substituted value."
                    % (reference.get("nodule_id"), self.basis)
                )
            tolerance = float(diameter) / 2.0
        if self.floor_mm is not None:
            tolerance = max(tolerance, float(self.floor_mm))
        if self.ceiling_mm is not None:
            tolerance = min(tolerance, float(self.ceiling_mm))
        return tolerance

    def describe(self):
        return {
            "basis": self.basis,
            "fixedRadiusMm": self.fixed_radius_mm,
            "floorMm": self.floor_mm,
            "ceilingMm": self.ceiling_mm,
            "duplicatePolicy": self.duplicate_policy,
            "source": self.source,
        }


def rule_from_bar(bar_path=BAR_PATH):
    """Build the rule the pre-registration records, or refuse.

    Refusing is the expected outcome today. The bar carries the tolerance as
    BLOCKED, and an evaluator that quietly supplied its own number would make
    the pre-registration decorative.
    """
    if not os.path.exists(bar_path):
        raise MethodologyUndecided("no pre-registration found at %s" % bar_path)
    with open(bar_path, encoding="utf-8") as handle:
        bar = json.load(handle)

    tolerance = bar.get("metrics", {}).get("localisationTolerance", {})
    status = tolerance.get("status", "UNKNOWN")
    if status != "APPROVED":
        raise MethodologyUndecided(
            "the localisation tolerance is %s, not APPROVED: %s"
            % (status, tolerance.get("blockedBy", "no reason recorded"))
        )

    rule = tolerance.get("rule")
    if not isinstance(rule, dict):
        raise MethodologyUndecided(
            "the tolerance is marked APPROVED but carries no machine-readable rule, "
            "so there is nothing to evaluate with"
        )
    return MatchRule(
        basis=rule.get("basis"),
        duplicate_policy=rule.get("duplicatePolicy"),
        fixed_radius_mm=rule.get("fixedRadiusMm"),
        floor_mm=rule.get("floorMm"),
        ceiling_mm=rule.get("ceilingMm"),
        source="%s approved by %s on %s" % (
            bar_path.replace(os.sep, "/"),
            tolerance.get("approvedBy"),
            tolerance.get("approvedOn"),
        ),
    )


def wilson(successes, total, z=1.96):
    """Point estimate and 95% interval, matching the existing convention.

    Same form as scripts/verify-lung-nodule-operating-point.py and
    server/production-performance.ts, so that a proportion means the same
    thing everywhere in the project. A zero denominator returns None rather
    than 0.0: nothing was measured, which is not the same as measuring none.
    """
    if total == 0:
        return (None, 0.0, 1.0)
    p = successes / float(total)
    d = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / d
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d
    return (round(p, 4), round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4))


def distance_mm(a, b):
    return math.sqrt(
        (a["x_mm"] - b["x_mm"]) ** 2
        + (a["y_mm"] - b["y_mm"]) ** 2
        + (a["z_mm"] - b["z_mm"]) ** 2
    )


def match_scan(references, candidates, rule):
    """Assign candidates to reference nodules, one to one.

    Greedy nearest first: every admissible pair is sorted by distance and taken
    in order, so the closest candidate claims its nodule before a more distant
    one can. That resolves both ambiguities the methodology record names — two
    candidates inside one nodule, and one candidate between two nodules —
    deterministically, and without preferring whichever happened to be listed
    first.
    """
    if not isinstance(rule, MatchRule):
        raise MethodologyUndecided(
            "match_scan needs an explicit MatchRule; there is no default tolerance"
        )

    tolerances = dict((r["nodule_id"], rule.tolerance_for(r)) for r in references)

    admissible = []
    for reference in references:
        for candidate in candidates:
            separation = distance_mm(reference, candidate)
            if separation <= tolerances[reference["nodule_id"]]:
                admissible.append((separation, reference["nodule_id"], candidate["candidate_id"]))
    # Distance first, then the ids, so that equal distances resolve the same
    # way on every machine rather than by dict ordering.
    admissible.sort(key=lambda item: (item[0], str(item[1]), str(item[2])))

    matched_reference = {}
    matched_candidate = {}
    duplicates = []
    for separation, nodule_id, candidate_id in admissible:
        if nodule_id in matched_reference:
            if candidate_id not in matched_candidate:
                duplicates.append(candidate_id)
            continue
        if candidate_id in matched_candidate:
            continue
        matched_reference[nodule_id] = (candidate_id, separation)
        matched_candidate[candidate_id] = nodule_id

    # De-duplicated, because one candidate can be admissible for two nodules
    # that are both already matched and would otherwise be appended twice and
    # counted as two false positives. One candidate is one candidate.
    duplicate_ids = []
    for candidate_id in duplicates:
        if candidate_id not in matched_candidate and candidate_id not in duplicate_ids:
            duplicate_ids.append(candidate_id)
    unmatched_candidates = [
        c["candidate_id"] for c in candidates
        if c["candidate_id"] not in matched_candidate and c["candidate_id"] not in duplicate_ids
    ]
    missed = [r["nodule_id"] for r in references if r["nodule_id"] not in matched_reference]

    if rule.duplicate_policy == DUPLICATE_IS_FALSE_POSITIVE:
        false_positives = unmatched_candidates + duplicate_ids
    else:
        false_positives = unmatched_candidates

    return {
        "found": matched_reference,
        "missed": missed,
        "falsePositives": false_positives,
        "duplicates": duplicate_ids,
    }


def account_scans(scans):
    """Split the collection by what actually happened to each scan."""
    accounting = dict((outcome, {"scans": 0, "referenceNodules": 0}) for outcome in SCAN_OUTCOMES)
    for scan in scans:
        outcome = scan.get("outcome")
        if outcome not in SCAN_OUTCOMES:
            raise ValueError(
                "scan %r has outcome %r, which is not one of %s. An unknown outcome cannot "
                "be counted as evaluated." % (scan.get("scan_id"), outcome, list(SCAN_OUTCOMES))
            )
        accounting[outcome]["scans"] += 1
        accounting[outcome]["referenceNodules"] += len(scan.get("references", []))
    return accounting


def froc(scans, rule):
    """Sensitivity against false positives per scan, swept over the score.

    Only evaluated scans contribute to either axis. Every threshold in the
    sweep is one a candidate actually carried, so each point on the curve is a
    configuration the detector could really be run at.
    """
    if not isinstance(rule, MatchRule):
        raise MethodologyUndecided(
            "froc needs an explicit MatchRule; there is no default tolerance"
        )

    accounting = account_scans(scans)
    evaluated = [s for s in scans if s["outcome"] == OUTCOME_EVALUATED]
    scans_searched = len(evaluated)
    references_searched = sum(len(s.get("references", [])) for s in evaluated)

    thresholds = sorted(
        set(c["score"] for scan in evaluated for c in scan.get("candidates", [])),
        reverse=True,
    )

    points = []
    for threshold in thresholds:
        found = 0
        false_positives = 0
        for scan in evaluated:
            kept = [c for c in scan.get("candidates", []) if c["score"] >= threshold]
            result = match_scan(scan.get("references", []), kept, rule)
            found += len(result["found"])
            false_positives += len(result["falsePositives"])
        sensitivity, low, high = wilson(found, references_searched)
        points.append({
            "scoreThreshold": threshold,
            "nodulesFound": found,
            "nodulesSearched": references_searched,
            "sensitivity": sensitivity,
            "sensitivityCI95": [low, high],
            "falsePositives": false_positives,
            "falsePositivesPerScan": (
                round(false_positives / float(scans_searched), 4) if scans_searched else None
            ),
        })

    return {
        "points": points,
        "scansSearched": scans_searched,
        "referenceNodulesSearched": references_searched,
        "scanAccounting": accounting,
        "rule": rule.describe(),
        "notSearched": {
            "scans": sum(
                accounting[o]["scans"] for o in SCAN_OUTCOMES if o != OUTCOME_EVALUATED
            ),
            "referenceNodules": sum(
                accounting[o]["referenceNodules"] for o in SCAN_OUTCOMES if o != OUTCOME_EVALUATED
            ),
            "note": (
                "These scans were never searched, so their nodules are neither found nor "
                "missed. They are excluded from both denominators and reported here. A "
                "refusal is not a negative finding."
            ),
        },
        "labelProvenance": (
            "Reference nodules are locations radiologists marked in LIDC-IDRI. They are "
            "research impressions, not histopathological diagnosis, and finding one says "
            "nothing about whether a nodule is malignant."
        ),
    }


def operating_point(curve, max_false_positives_per_scan):
    """The most sensitive swept threshold that stays within a false-positive budget.

    Returns None when no threshold reaches it. Nothing is interpolated: a point
    on this curve is a threshold that was measured, not one inferred from the
    shape of a line drawn between two others.
    """
    admissible = [
        point for point in curve["points"]
        if point["falsePositivesPerScan"] is not None
        and point["falsePositivesPerScan"] <= max_false_positives_per_scan
        and point["sensitivity"] is not None
    ]
    if not admissible:
        return None
    return max(admissible, key=lambda p: (p["sensitivity"], -p["falsePositivesPerScan"]))


def stratify(scans, rule, key):
    """The same curve computed within each value of a scan-level attribute.

    A single pooled figure hides where a detector fails, and nodule size and
    slice thickness are exactly where a nodule detector is expected to.
    """
    groups = {}
    for scan in scans:
        groups.setdefault(scan.get(key, "unrecorded"), []).append(scan)
    return dict((str(value), froc(subset, rule)) for value, subset in sorted(
        groups.items(), key=lambda item: str(item[0])
    ))
