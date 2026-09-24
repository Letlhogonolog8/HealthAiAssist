#!/usr/bin/env python3
"""
Verify the committed patient-disjoint split before any training reads it.

    python scripts/verify-training-manifest.py
    python scripts/verify-training-manifest.py --manifest other.json --labels other.csv

Checks, all of them every time (training/manifest.py):

  - required manifest fields are present
  - the manifest's fingerprint matches its own contents
  - that fingerprint is the one the training configuration pins
  - every patient identity is a source LIDC id
  - the six pairwise patient intersections between the four splits are empty
  - no series and no labelled nodule appears in two splits
  - every label row carries the fields its identity depends on

Exit 0 when clean, 1 on any problem. Never rewrites the split.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Reports use em dashes and other non-ASCII; Windows consoles default to cp1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from training import _paths, manifest  # noqa: E402
from training import config as training_config  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=_paths.SPLIT_MANIFEST)
    parser.add_argument("--labels", default=_paths.LABEL_TABLE)
    parser.add_argument("--config", default=_paths.DEFAULT_CONFIG)
    parser.add_argument("--expected-fingerprint", default=None,
                        help="override the fingerprint pinned in the configuration")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    expected = args.expected_fingerprint
    if expected is None:
        expected = training_config.load_yaml(args.config).get("data", {}).get("expected_split_fingerprint")

    try:
        loaded = manifest.load_manifest(args.manifest)
        rows = manifest.load_label_rows(args.labels)
    except manifest.ManifestInvalid as exc:
        print("MANIFEST INVALID")
        for problem in exc.problems:
            print("  - %s" % problem)
        return 1

    report = manifest.verify(loaded, rows, expected)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0 if report["clean"] else 1

    print("Training split manifest")
    print("=" * 60)
    print("fingerprint     %s (recomputed %s, pinned %s)"
          % (report.get("fingerprint"), report.get("recomputedFingerprint"), expected))
    for split, count in sorted(report.get("patientsPerSplit", {}).items()):
        print("  %-12s %d patients" % (split, count))
    print("patient intersections:")
    for pair, count in sorted(report.get("patientIntersections", {}).items()):
        print("  %-26s %d" % (pair, count))
    print()
    if report["clean"]:
        print("MANIFEST VERIFIED — patient-disjoint, fingerprint pinned, identities are source LIDC ids")
        return 0
    print("MANIFEST INVALID")
    for problem in report["problems"]:
        print("  - %s" % problem)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
