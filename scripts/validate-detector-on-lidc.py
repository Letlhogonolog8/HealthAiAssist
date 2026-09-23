#!/usr/bin/env python3
"""
Detector evaluation against the local LIDC-IDRI reference nodules.

    python scripts/validate-detector-on-lidc.py --check

── What this reports today ────────────────────────────────────────────────

**BLOCKED.** Two independent preconditions are unmet, and neither is something
this script can decide for itself:

  1. There is no detector. No trained checkpoint exists in this repository and
     none can be trained on this hardware, which has no GPU.

  2. The localisation tolerance is undefined. Deciding whether a proposed
     candidate *is* a given reference nodule requires a rule, and which of the
     three available measurements defines it — max in-plane diameter,
     equivalent-area diameter, or slice span — is a methodology decision
     recorded as pending in docs/bars/p2.json.

A sensitivity figure computed without (2) is not interpretable, and one
computed without (1) does not exist. So this script refuses to produce a
number and prints what is missing instead. That refusal is the deliverable
until both are resolved.

── Why the script exists now ──────────────────────────────────────────────

Because the evaluation must be written down before there is a result to
rationalise. The event definition, the denominator, the exclusions, the split
and the handling of refusals are all fixed here, so that when a detector
appears nobody gets to choose the metric that flatters it. Same reason
docs/ML_CHANGE_PROCESS.md exists, and the same pattern
scripts/build-ood-reference.py already follows by writing its requirements
into the reference and exiting non-zero when they are not met.

── The evaluation, as specified ───────────────────────────────────────────

Event               a reference nodule is *found* when at least one proposed
                    candidate centre lies within the localisation tolerance of
                    it. One nodule found once; extra candidates on the same
                    nodule are not extra credit.

Denominator         reference nodules in the test split, per nodule, not per
                    slice and not per patch.

False positives     candidates matching no reference nodule, divided by the
                    number of scans searched. Refused and failed runs are
                    excluded from the denominator and reported separately,
                    because a scan that was not searched produced neither a
                    detection nor a false positive.

Curve               sensitivity against false positives per scan, swept over
                    the score threshold.

Intervals           Wilson, on every reported proportion, as
                    server/production-performance.ts already does.

Split               patient-disjoint. No patient may appear in more than one
                    of train, validation, calibration and test.

Stratification      nodule size, slice thickness, reconstruction kernel, and
                    central versus peripheral, where the data supports it.
                    Demographics are not possible from LIDC and must be
                    reported as not possible rather than omitted.

Ceiling             the reference is what radiologists marked. A detector
                    cannot exceed inter-reader agreement on this data, and a
                    figure approaching it indicates agreement with readers,
                    not with the patient's condition.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BAR_PATH = os.path.join(ROOT, "docs", "bars", "p2.json")
LABELS_PATH = os.path.join(ROOT, "dataset", "lidc-labels.csv")


def load_bar() -> dict:
    if not os.path.exists(BAR_PATH):
        return {}
    with open(BAR_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def detector_available() -> tuple[bool, str]:
    """Whether a checkpoint is registered. It is not."""
    sys.path.insert(0, os.path.join(ROOT, "inference"))
    try:
        from detection_service import registered_detector  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        return False, f"the detection service could not be imported: {exc}"
    detector = registered_detector()
    if detector is None:
        return False, (
            "no candidate detector is registered. There is no trained checkpoint in this "
            "repository and none can be trained on this hardware, which has no GPU."
        )
    return True, getattr(detector, "version", "unknown")


def tolerance_defined(bar: dict) -> tuple[bool, str]:
    """Asks the evaluator itself, rather than re-reading the bar separately.

    inference/detection_eval.rule_from_bar is the only thing that turns the
    pre-registration into a usable rule, and it refuses while the tolerance is
    unsettled. Consulting it here means this script and the evaluation agree
    by construction instead of by coincidence.
    """
    sys.path.insert(0, os.path.join(ROOT, "inference"))
    try:
        import detection_eval  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        return False, f"the evaluation machinery could not be imported: {exc}"
    try:
        rule = detection_eval.rule_from_bar()
    except detection_eval.MethodologyUndecided as exc:
        return False, str(exc)
    return True, json.dumps(rule.describe())


def evaluation_machinery() -> dict:
    """What exists to compute with, kept separate from what has been computed.

    The FROC arithmetic, the Wilson intervals, the one-to-one matching and the
    exclusion accounting are implemented and unit-tested on synthetic geometry.
    That is engineering readiness and nothing else: the module has never seen a
    detector output, because there is no detector.
    """
    return {
        "module": "inference/detection_eval.py",
        "tests": "inference/tests/test_detection_eval.py",
        "implemented": [
            "one-to-one greedy nearest-first candidate matching",
            "per-nodule sensitivity with Wilson 95% intervals",
            "false positives per scan over searched scans only",
            "FROC sweep over thresholds candidates actually carried",
            "operating point selection without interpolation",
            "scan accounting that keeps evaluated, OOD-refused, quality-refused, "
            "failed and not-run apart",
            "stratification by any scan-level attribute",
        ],
        "hasEverBeenRunOnADetectorOutput": False,
        "note": (
            "Tested on synthetic geometry invented in the tests. This is engineering "
            "readiness, not model performance and not clinical validation."
        ),
    }


def bar_approved(bar: dict) -> tuple[bool, str]:
    gate = bar.get("proposedGate", {})
    approval = gate.get("approval", {})
    if approval.get("approved") is True:
        return True, str(approval.get("approvedBy"))
    return False, gate.get("status", "PROPOSED — REQUIRES PROJECT DECISION")


def reference_nodules() -> tuple[int, int]:
    """How many reference nodules and patients the local labels hold."""
    if not os.path.exists(LABELS_PATH):
        return 0, 0
    with open(LABELS_PATH, newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return len(rows), len({r["patient"] for r in rows})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true",
                        help="report what is missing and exit without evaluating")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args()

    bar = load_bar()
    has_detector, detector_note = detector_available()
    has_tolerance, tolerance_note = tolerance_defined(bar)
    approved, approval_note = bar_approved(bar)
    nodules, patients = reference_nodules()

    blockers = []
    if not has_detector:
        blockers.append({"blocker": "no_detector", "detail": detector_note})
    if not has_tolerance:
        blockers.append({"blocker": "localisation_tolerance_undefined", "detail": tolerance_note})

    report = {
        "status": "BLOCKED" if blockers else "READY",
        "blockers": blockers,
        "referenceNodulesAvailable": nodules,
        "referencePatientsAvailable": patients,
        "evaluationMachinery": evaluation_machinery(),
        "splitManifest": bar.get("splits", {}).get("manifest"),
        "proposedGate": {
            "sensitivity": bar.get("proposedGate", {}).get("sensitivity"),
            "falsePositivesPerScan": bar.get("proposedGate", {}).get("falsePositivesPerScan"),
            "approved": approved,
            "status": approval_note,
            "note": (
                "PROPOSED / NOT APPROVED. Measuring against it would be informational only; "
                "failing it is not a regulatory failure and passing it is not clinical "
                "validation."
            ),
        },
        "labelProvenance": (
            "Radiologist-derived research impressions, not histopathological diagnosis. "
            "A reference nodule means a radiologist marked something there."
        ),
        "noResultsProduced": True,
    }

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("Detector evaluation on LIDC-IDRI")
        print("=" * 60)
        print(f"status: {report['status']}")
        print()
        for blocker in blockers:
            print(f"  BLOCKED — {blocker['blocker']}")
            print(f"    {blocker['detail']}")
            print()
        print(f"reference nodules available locally: {nodules} across {patients} patients")
        print(f"split manifest: {report['splitManifest']}")
        print("evaluation machinery: implemented and unit-tested "
              "(inference/detection_eval.py); never run on a detector output")
        print(f"proposed gate: {report['proposedGate']['sensitivity']} sensitivity at "
              f"<= {report['proposedGate']['falsePositivesPerScan']} FP/scan")
        print(f"  approved: {approved} — {approval_note}")
        print()
        print("No performance figures were produced, and none should be quoted from this run.")
        print("Label provenance:", report["labelProvenance"])

    # Non-zero while blocked, so a pipeline cannot treat "no output" as a pass.
    return 1 if blockers else 0


if __name__ == "__main__":
    raise SystemExit(main())
