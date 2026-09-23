"""
inference/detection_eval.py: the arithmetic, and the refusals around it.

Two things are being protected here. The first is that no figure can be
produced without a matching rule somebody chose on purpose — a default
tolerance would become the methodology decision by accident, and the whole
point of docs/P2_LOCALIZATION_METHODOLOGY.md is that it is made deliberately.
The second is that a scan which was never searched is never counted as a scan
that found nothing. A refusal is not a negative finding, and the moment its
nodules land in the sensitivity denominator, the refusal reads as a miss.

Every fixture here is synthetic geometry invented in the test. No real
annotation is asserted, no figure produced here is a measurement of anything,
and nothing in this file is a clinical label.
"""
from __future__ import annotations

import importlib.util
import json
import os

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _load():
    path = os.path.join(ROOT, "inference", "detection_eval.py")
    spec = importlib.util.spec_from_file_location("detection_eval", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ev = _load()


def fixed_rule(radius_mm=5.0, duplicate_policy=None):
    """A synthetic rule for arithmetic tests. Not a proposed tolerance."""
    return ev.MatchRule(
        basis=ev.BASIS_FIXED,
        fixed_radius_mm=radius_mm,
        duplicate_policy=duplicate_policy or ev.DUPLICATE_IS_FALSE_POSITIVE,
        source="synthetic rule constructed inside a unit test",
    )


def reference(nodule_id, x=0.0, y=0.0, z=0.0, **extra):
    row = {"nodule_id": nodule_id, "x_mm": x, "y_mm": y, "z_mm": z}
    row.update(extra)
    return row


def candidate(candidate_id, x=0.0, y=0.0, z=0.0, score=0.5):
    return {"candidate_id": candidate_id, "x_mm": x, "y_mm": y, "z_mm": z, "score": score}


def scan(scan_id, outcome=None, references=None, candidates=None, **extra):
    row = {
        "scan_id": scan_id,
        "outcome": outcome or ev.OUTCOME_EVALUATED,
        "references": references or [],
        "candidates": candidates or [],
    }
    row.update(extra)
    return row


# ── no rule, no number ─────────────────────────────────────────────────────

def test_the_bar_refuses_to_yield_a_rule_while_the_tolerance_is_blocked():
    """The real pre-registration, unmodified. This must fail today."""
    with pytest.raises(ev.MethodologyUndecided) as excinfo:
        ev.rule_from_bar()
    assert "BLOCKED" in str(excinfo.value)


def test_the_repository_bar_really_does_still_say_blocked():
    """Guards the test above from passing for the wrong reason."""
    with open(ev.BAR_PATH, encoding="utf-8") as handle:
        bar = json.load(handle)
    assert bar["metrics"]["localisationTolerance"]["status"] == "BLOCKED"


def test_an_approved_bar_without_a_machine_readable_rule_still_refuses(tmp_path):
    """Marking it approved is not the same as saying what it is."""
    path = tmp_path / "bar.json"
    path.write_text(json.dumps({
        "metrics": {"localisationTolerance": {"status": "APPROVED"}}
    }), encoding="utf-8")
    with pytest.raises(ev.MethodologyUndecided):
        ev.rule_from_bar(str(path))


def test_an_approved_bar_with_a_rule_yields_it(tmp_path):
    """The mechanism works once a decision exists — so the refusal above is
    about the missing decision, not a broken reader."""
    path = tmp_path / "bar.json"
    path.write_text(json.dumps({
        "metrics": {"localisationTolerance": {
            "status": "APPROVED",
            "approvedBy": "a-test",
            "approvedOn": "never",
            "rule": {"basis": ev.BASIS_FIXED, "fixedRadiusMm": 4.0,
                     "duplicatePolicy": ev.DUPLICATE_IS_FALSE_POSITIVE},
        }}
    }), encoding="utf-8")
    rule = ev.rule_from_bar(str(path))
    assert rule.fixed_radius_mm == 4.0
    assert "a-test" in rule.source


@pytest.mark.parametrize("call", ["match_scan", "froc"])
def test_the_entry_points_refuse_anything_that_is_not_a_rule(call):
    if call == "match_scan":
        with pytest.raises(ev.MethodologyUndecided):
            ev.match_scan([], [], None)
        with pytest.raises(ev.MethodologyUndecided):
            ev.match_scan([], [], 5.0)  # a bare number is not a methodology
    else:
        with pytest.raises(ev.MethodologyUndecided):
            ev.froc([], None)


def test_there_is_no_default_tolerance_anywhere_in_the_signature():
    import inspect

    parameters = inspect.signature(ev.MatchRule.__init__).parameters
    assert parameters["basis"].default is inspect.Parameter.empty
    assert parameters["duplicate_policy"].default is inspect.Parameter.empty


# ── the rule itself ────────────────────────────────────────────────────────

def test_a_rule_rejects_a_basis_it_does_not_know():
    with pytest.raises(ValueError):
        ev.MatchRule(basis="vibes", duplicate_policy=ev.DUPLICATE_IS_IGNORED)


def test_a_fixed_rule_needs_a_radius_and_a_diameter_rule_must_not_have_one():
    with pytest.raises(ValueError):
        ev.MatchRule(basis=ev.BASIS_FIXED, duplicate_policy=ev.DUPLICATE_IS_IGNORED)
    with pytest.raises(ValueError):
        ev.MatchRule(basis=ev.BASIS_MAX_IN_PLANE, fixed_radius_mm=5.0,
                     duplicate_policy=ev.DUPLICATE_IS_IGNORED)


def test_a_duplicate_policy_must_be_stated():
    with pytest.raises(ValueError):
        ev.MatchRule(basis=ev.BASIS_FIXED, fixed_radius_mm=5.0, duplicate_policy=None)


def test_a_diameter_rule_uses_half_the_diameter():
    rule = ev.MatchRule(basis=ev.BASIS_MAX_IN_PLANE,
                        duplicate_policy=ev.DUPLICATE_IS_IGNORED)
    assert rule.tolerance_for(reference("n", max_in_plane_diameter_mm=8.0)) == 4.0


def test_a_floor_raises_the_tolerance_and_a_ceiling_caps_it():
    floored = ev.MatchRule(basis=ev.BASIS_MAX_IN_PLANE, floor_mm=3.0,
                           duplicate_policy=ev.DUPLICATE_IS_IGNORED)
    assert floored.tolerance_for(reference("n", max_in_plane_diameter_mm=2.0)) == 3.0
    capped = ev.MatchRule(basis=ev.BASIS_MAX_IN_PLANE, ceiling_mm=10.0,
                          duplicate_policy=ev.DUPLICATE_IS_IGNORED)
    assert capped.tolerance_for(reference("n", max_in_plane_diameter_mm=56.0)) == 10.0


def test_a_nodule_with_no_measurement_raises_rather_than_being_given_one():
    """267 nodules in the local table have no contour to measure. Substituting
    a value for them would invent the tolerance they are judged by."""
    rule = ev.MatchRule(basis=ev.BASIS_MAX_IN_PLANE,
                        duplicate_policy=ev.DUPLICATE_IS_IGNORED)
    with pytest.raises(ValueError) as excinfo:
        rule.tolerance_for(reference("unmeasured"))
    assert "excluded" in str(excinfo.value)


# ── matching ───────────────────────────────────────────────────────────────

def test_a_candidate_inside_the_tolerance_finds_the_nodule():
    result = ev.match_scan([reference("n1")], [candidate("c1", x=3.0)], fixed_rule(5.0))
    assert list(result["found"]) == ["n1"]
    assert result["missed"] == []
    assert result["falsePositives"] == []


def test_a_candidate_just_outside_the_tolerance_is_a_miss_and_a_false_positive():
    result = ev.match_scan([reference("n1")], [candidate("c1", x=5.001)], fixed_rule(5.0))
    assert result["missed"] == ["n1"]
    assert result["falsePositives"] == ["c1"]


def test_the_boundary_is_inclusive():
    result = ev.match_scan([reference("n1")], [candidate("c1", x=5.0)], fixed_rule(5.0))
    assert list(result["found"]) == ["n1"]


def test_two_candidates_on_one_nodule_give_the_nodule_to_the_nearer_one():
    """Finding a nodule twice is not finding two nodules."""
    result = ev.match_scan(
        [reference("n1")],
        [candidate("far", x=4.0), candidate("near", x=1.0)],
        fixed_rule(5.0),
    )
    assert result["found"]["n1"][0] == "near"
    assert result["duplicates"] == ["far"]


def test_the_duplicate_policy_decides_whether_the_second_one_costs_anything():
    pair = [candidate("far", x=4.0), candidate("near", x=1.0)]
    counted = ev.match_scan([reference("n1")], pair,
                            fixed_rule(5.0, ev.DUPLICATE_IS_FALSE_POSITIVE))
    ignored = ev.match_scan([reference("n1")], pair,
                            fixed_rule(5.0, ev.DUPLICATE_IS_IGNORED))
    assert counted["falsePositives"] == ["far"]
    assert ignored["falsePositives"] == []
    # Either way the nodule is found exactly once.
    assert len(counted["found"]) == len(ignored["found"]) == 1


def test_a_candidate_near_two_matched_nodules_is_one_false_positive_not_two():
    """It is admissible for both, and was appended once per nodule.

    Two nodules, each already claimed by a nearer candidate, with a third
    candidate sitting inside both tolerances. That candidate is one wrong
    proposal. Counting it once per nodule it happens to be near inflates the
    false-positive rate by however many references are crowded around it,
    which is worst exactly where nodules cluster.
    """
    references = [reference("a", x=0.0), reference("b", x=6.0)]
    candidates = [
        candidate("ca", x=0.2),   # nearest to a
        candidate("cb", x=5.8),   # nearest to b
        candidate("loose", x=3.0),  # inside both tolerances, claims neither
    ]
    result = ev.match_scan(references, candidates, fixed_rule(5.0))

    assert result["found"]["a"][0] == "ca"
    assert result["found"]["b"][0] == "cb"
    assert result["duplicates"] == ["loose"]
    assert result["falsePositives"] == ["loose"]


def test_one_candidate_between_two_nodules_is_claimed_by_the_nearer_one():
    result = ev.match_scan(
        [reference("near", x=1.0), reference("far", x=9.0)],
        [candidate("c1", x=3.0)],
        fixed_rule(7.0),
    )
    assert list(result["found"]) == ["near"]
    assert result["missed"] == ["far"]
    assert result["falsePositives"] == []


def test_matching_is_one_to_one_across_several_nodules():
    result = ev.match_scan(
        [reference("a", x=0.0), reference("b", x=10.0)],
        [candidate("ca", x=1.0), candidate("cb", x=11.0)],
        fixed_rule(3.0),
    )
    assert result["found"]["a"][0] == "ca"
    assert result["found"]["b"][0] == "cb"
    assert result["falsePositives"] == []


def test_the_assignment_does_not_depend_on_the_order_things_are_listed_in():
    references = [reference("a", x=0.0), reference("b", x=4.0)]
    candidates = [candidate("c1", x=1.0), candidate("c2", x=3.0)]
    forward = ev.match_scan(references, candidates, fixed_rule(5.0))
    backward = ev.match_scan(list(reversed(references)), list(reversed(candidates)),
                             fixed_rule(5.0))
    assert forward["found"] == backward["found"]


def test_distance_is_measured_in_three_dimensions():
    """A candidate on the right slice but the wrong one is still far away."""
    inside = ev.match_scan([reference("n")], [candidate("c", z=4.0)], fixed_rule(5.0))
    outside = ev.match_scan([reference("n")], [candidate("c", z=6.0)], fixed_rule(5.0))
    assert list(inside["found"]) == ["n"]
    assert outside["missed"] == ["n"]


# ── refusal is not a negative ──────────────────────────────────────────────

@pytest.mark.parametrize("outcome", [
    ev.OUTCOME_REFUSED_OOD,
    ev.OUTCOME_REFUSED_QUALITY,
    ev.OUTCOME_FAILED,
    ev.OUTCOME_NOT_RUN,
])
def test_a_scan_that_was_never_searched_is_not_a_scan_that_found_nothing(outcome):
    scans = [
        scan("searched", references=[reference("found", x=0.0)],
             candidates=[candidate("c", x=0.5, score=0.9)]),
        scan("unsearched", outcome=outcome, references=[reference("never-offered")]),
    ]
    curve = ev.froc(scans, fixed_rule(5.0))

    # The unsearched nodule is in neither denominator.
    assert curve["referenceNodulesSearched"] == 1
    assert curve["scansSearched"] == 1
    assert curve["points"][0]["sensitivity"] == 1.0

    # And it is reported rather than dropped.
    assert curve["scanAccounting"][outcome]["referenceNodules"] == 1
    assert curve["notSearched"]["referenceNodules"] == 1


def test_the_four_not_searched_states_are_kept_apart():
    """An operator has to be able to tell an OOD refusal from a crash."""
    scans = [
        scan("a", outcome=ev.OUTCOME_REFUSED_OOD, references=[reference("r1")]),
        scan("b", outcome=ev.OUTCOME_REFUSED_QUALITY, references=[reference("r2")]),
        scan("c", outcome=ev.OUTCOME_FAILED, references=[reference("r3")]),
        scan("d", outcome=ev.OUTCOME_NOT_RUN, references=[reference("r4")]),
    ]
    accounting = ev.account_scans(scans)
    assert accounting[ev.OUTCOME_REFUSED_OOD]["scans"] == 1
    assert accounting[ev.OUTCOME_REFUSED_QUALITY]["scans"] == 1
    assert accounting[ev.OUTCOME_FAILED]["scans"] == 1
    assert accounting[ev.OUTCOME_NOT_RUN]["scans"] == 1
    assert accounting[ev.OUTCOME_EVALUATED]["scans"] == 0


def test_an_unrecognised_outcome_raises_rather_than_defaulting_to_evaluated():
    with pytest.raises(ValueError):
        ev.account_scans([scan("x", outcome="probably_fine")])


def test_a_collection_where_nothing_was_searched_reports_no_sensitivity():
    """Not 0.0, and not 1.0. There is no denominator, so there is no figure."""
    curve = ev.froc(
        [scan("a", outcome=ev.OUTCOME_REFUSED_OOD, references=[reference("r1")])],
        fixed_rule(5.0),
    )
    assert curve["points"] == []
    assert curve["referenceNodulesSearched"] == 0
    assert ev.operating_point(curve, 4) is None


# ── the curve ──────────────────────────────────────────────────────────────

def build_collection():
    """Three synthetic scans with a hit, a miss and a false positive each."""
    return [
        scan("s1",
             references=[reference("n1", x=0.0)],
             candidates=[candidate("c1", x=1.0, score=0.9),
                         candidate("c2", x=50.0, score=0.4)]),
        scan("s2",
             references=[reference("n2", x=0.0)],
             candidates=[candidate("c3", x=1.0, score=0.6),
                         candidate("c4", x=50.0, score=0.2)]),
        scan("s3",
             references=[reference("n3", x=0.0)],
             candidates=[candidate("c5", x=80.0, score=0.8)]),
    ]


def test_sensitivity_rises_and_false_positives_rise_with_it():
    curve = ev.froc(build_collection(), fixed_rule(5.0))
    sensitivities = [p["sensitivity"] for p in curve["points"]]
    fps = [p["falsePositivesPerScan"] for p in curve["points"]]
    # Points are swept from the strictest threshold down.
    assert sensitivities == sorted(sensitivities)
    assert fps == sorted(fps)
    assert curve["points"][-1]["sensitivity"] == pytest.approx(2 / 3.0, abs=1e-4)


def test_every_threshold_on_the_curve_is_one_a_candidate_actually_carried():
    collection = build_collection()
    curve = ev.froc(collection, fixed_rule(5.0))
    scored = set(c["score"] for s in collection for c in s["candidates"])
    assert set(p["scoreThreshold"] for p in curve["points"]) == scored


def test_false_positives_per_scan_divides_by_scans_searched_only():
    collection = build_collection()
    collection.append(scan("refused", outcome=ev.OUTCOME_REFUSED_OOD,
                           references=[reference("n4")]))
    curve = ev.froc(collection, fixed_rule(5.0))
    lowest = curve["points"][-1]
    assert curve["scansSearched"] == 3
    assert lowest["falsePositives"] == 3
    assert lowest["falsePositivesPerScan"] == pytest.approx(1.0)


def test_every_reported_proportion_carries_an_interval():
    curve = ev.froc(build_collection(), fixed_rule(5.0))
    for point in curve["points"]:
        low, high = point["sensitivityCI95"]
        assert low <= point["sensitivity"] <= high
        assert high - low > 0.0  # three nodules cannot produce a tight interval


def test_the_interval_is_wilson_and_matches_the_published_value():
    point, low, high = ev.wilson(8, 10)
    assert point == 0.8
    assert low == pytest.approx(0.4902, abs=5e-4)
    assert high == pytest.approx(0.9433, abs=5e-4)


def test_an_empty_denominator_gives_none_rather_than_zero():
    point, low, high = ev.wilson(0, 0)
    assert point is None
    assert (low, high) == (0.0, 1.0)


def test_the_curve_carries_its_rule_and_its_provenance():
    """A figure must not be separable from the rule that produced it."""
    curve = ev.froc(build_collection(), fixed_rule(5.0))
    assert curve["rule"]["basis"] == ev.BASIS_FIXED
    assert curve["rule"]["fixedRadiusMm"] == 5.0
    assert "unit test" in curve["rule"]["source"]
    assert "not histopathological" in curve["labelProvenance"]


def test_a_rule_with_no_recorded_source_says_so():
    rule = ev.MatchRule(basis=ev.BASIS_FIXED, fixed_radius_mm=5.0,
                        duplicate_policy=ev.DUPLICATE_IS_IGNORED)
    assert "UNRECORDED" in rule.describe()["source"]


# ── operating point ────────────────────────────────────────────────────────

def test_the_operating_point_is_a_threshold_that_was_actually_swept():
    curve = ev.froc(build_collection(), fixed_rule(5.0))
    point = ev.operating_point(curve, 4)
    assert point in curve["points"]


def test_an_unreachable_false_positive_budget_returns_nothing_rather_than_a_guess():
    collection = [
        scan("s1", references=[reference("n1", x=0.0)],
             candidates=[candidate("c%d" % i, x=50.0 + i, score=0.9) for i in range(10)]),
    ]
    curve = ev.froc(collection, fixed_rule(5.0))
    assert ev.operating_point(curve, 0.5) is None


def test_the_operating_point_prefers_sensitivity_within_the_budget():
    curve = ev.froc(build_collection(), fixed_rule(5.0))
    generous = ev.operating_point(curve, 10)
    strict = ev.operating_point(curve, 0)
    assert generous["sensitivity"] >= strict["sensitivity"]
    assert strict["falsePositivesPerScan"] == 0


# ── stratification ─────────────────────────────────────────────────────────

def test_stratification_splits_the_curve_without_changing_the_rule():
    collection = build_collection()
    collection[0]["slice_thickness_mm"] = 1.0
    collection[1]["slice_thickness_mm"] = 2.5
    collection[2]["slice_thickness_mm"] = 2.5
    strata = ev.stratify(collection, fixed_rule(5.0), "slice_thickness_mm")
    assert set(strata) == {"1.0", "2.5"}
    assert strata["1.0"]["scansSearched"] == 1
    assert strata["2.5"]["scansSearched"] == 2


def test_a_scan_missing_the_attribute_is_labelled_rather_than_dropped():
    strata = ev.stratify(build_collection(), fixed_rule(5.0), "reconstruction_kernel")
    assert "unrecorded" in strata
    assert strata["unrecorded"]["scansSearched"] == 3
