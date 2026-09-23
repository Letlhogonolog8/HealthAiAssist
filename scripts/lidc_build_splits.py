#!/usr/bin/env python3
"""
Deterministic, patient-disjoint splits for detector training and evaluation.

    python scripts/lidc_build_splits.py            # rewrites the tracked manifest
    python scripts/lidc_build_splits.py --audit-only   # report only, write nothing

The manifest lives in docs/splits/, which is tracked, rather than in dataset/,
which is gitignored. scripts/materialise-lung-test-split.py exists because an
earlier split was recorded only where git could not see it, which left
published figures unverifiable in a fresh working copy. One of those is enough.

── Why the split unit is the patient ──────────────────────────────────────

A patient can have several series, a series has many slices, and a slice can
carry several nodules. Splitting on any of those puts the same person's
anatomy on both sides of the line: the model sees a chest in training and is
then asked about the same chest at test time. The figure that comes out
measures memorisation and looks like success.

So the unit is the patient, and every series, nodule and slice belonging to
one patient lands in exactly one split. That is checked rather than assumed —
`audit_splits` re-derives the overlap from the assignment and refuses to
write a manifest that fails.

── Why it is hashed rather than shuffled ──────────────────────────────────

`random.shuffle` with a seed is reproducible only for a fixed input list. Add
one patient to the collection and every subsequent assignment moves, so a
model trained last month can no longer be compared with one trained today.

Assignment here is `HMAC-SHA256(seed, patient_id) -> [0, 1)`, compared against
cumulative split boundaries. Adding a patient changes that patient's
assignment and nobody else's, which is what makes two runs comparable.

── Identity ───────────────────────────────────────────────────────────────

The scientific identity is the **source** LIDC patient id, from the dataset
manifest. Not the salted production UIDs: `inference/uid_remap.py` maps those
through a keyed HMAC precisely so they cannot be joined back, and using them
here would make the split depend on a deployment secret and be irreproducible
for anybody else.

── What this does not decide ──────────────────────────────────────────────

Nothing about how a detection is matched to a nodule, and nothing about what
performance would be acceptable. Those are methodology decisions recorded as
PENDING in docs/bars/p2.json. This only fixes who is in which split, before
anyone can see a result and be tempted to move the line.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import hmac
import json
import os
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABELS = os.path.join(ROOT, "dataset", "lidc-labels.csv")
MANIFEST = os.path.join(ROOT, "docs", "splits", "lidc-split-v1.json")

# Changing any of these changes every assignment, which is why the manifest
# records them and the fingerprint covers them.
DEFAULT_SEED = "healthai-lidc-split-v1"
DEFAULT_FRACTIONS = {"train": 0.60, "validation": 0.15, "calibration": 0.10, "test": 0.15}

# Four splits, not three. Calibration is separate from validation because
# fitting a temperature on the set that chose the operating point measures the
# fit, not the model — and separate from test because the test set must stay
# untouched until the end.
SPLIT_ORDER = ("train", "validation", "calibration", "test")


def assign(patient: str, seed: str) -> float:
    """A stable number in [0, 1) for one patient.

    Keyed rather than plain-hashed so that a different seed gives a genuinely
    different partition rather than a rotation of the same one.
    """
    digest = hmac.new(seed.encode("utf-8"), patient.encode("utf-8"), hashlib.sha256).digest()
    return int.from_bytes(digest[:8], "big") / float(1 << 64)


def split_for(value: float, fractions: dict[str, float]) -> str:
    cumulative = 0.0
    for name in SPLIT_ORDER:
        cumulative += fractions[name]
        if value < cumulative:
            return name
    return SPLIT_ORDER[-1]  # float dust at the very top of the range


def load_labels(path: str) -> list[dict]:
    if not os.path.exists(path):
        raise SystemExit(f"label table not found: {path}")
    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def build(rows: list[dict], seed: str, fractions: dict[str, float]) -> dict:
    patients = sorted({r["patient"] for r in rows})
    assignment = {p: split_for(assign(p, seed), fractions) for p in patients}

    by_split: dict[str, dict] = {
        name: {"patients": [], "series": set(), "nodules": 0, "malignant": 0, "benign": 0}
        for name in SPLIT_ORDER
    }
    for patient in patients:
        by_split[assignment[patient]]["patients"].append(patient)
    for row in rows:
        bucket = by_split[assignment[row["patient"]]]
        bucket["series"].add(row["series_uid"])
        bucket["nodules"] += 1
        bucket["malignant" if row["label"] == "malignant" else "benign"] += 1

    return {
        "assignment": assignment,
        "summary": {
            name: {
                "patients": len(b["patients"]),
                "series": len(b["series"]),
                "nodules": b["nodules"],
                "malignant": b["malignant"],
                "benign": b["benign"],
            }
            for name, b in by_split.items()
        },
        "seriesBySplit": {name: sorted(b["series"]) for name, b in by_split.items()},
    }


def audit_splits(rows: list[dict], assignment: dict[str, str]) -> dict:
    """Re-derives the overlaps from the assignment.

    Deliberately not trusting `build`: this recomputes which split every
    patient, series and nodule landed in and reports anything appearing more
    than once. A split manifest that fails this must not be written.
    """
    patient_splits = defaultdict(set)
    series_splits = defaultdict(set)
    nodule_splits = defaultdict(set)

    for row in rows:
        split = assignment.get(row["patient"])
        if split is None:
            continue
        patient_splits[row["patient"]].add(split)
        series_splits[row["series_uid"]].add(split)
        nodule_splits[(row["series_uid"], row["nodule_index"])].add(split)

    # One series belonging to two patients would break the patient-disjoint
    # guarantee even with a correct assignment, so it is checked separately.
    series_patients = defaultdict(set)
    for row in rows:
        series_patients[row["series_uid"]].add(row["patient"])

    findings = {
        "patientsInMultipleSplits": sorted(p for p, s in patient_splits.items() if len(s) > 1),
        "seriesInMultipleSplits": sorted(s for s, v in series_splits.items() if len(v) > 1),
        "nodulesInMultipleSplits": [k for k, v in nodule_splits.items() if len(v) > 1],
        "seriesSharedByMultiplePatients": sorted(
            s for s, p in series_patients.items() if len(p) > 1
        ),
        "unassignedPatients": sorted({r["patient"] for r in rows} - set(assignment)),
        "duplicateNoduleKeys": [
            key for key, count in Counter(
                (r["series_uid"], r["nodule_index"]) for r in rows
            ).items() if count > 1
        ],
    }
    findings["clean"] = all(not v for k, v in findings.items() if k != "clean")
    return findings


def fingerprint(payload: dict) -> str:
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("out_json", nargs="?", default=MANIFEST)
    parser.add_argument("--labels", default=LABELS)
    parser.add_argument("--seed", default=DEFAULT_SEED)
    parser.add_argument("--audit-only", action="store_true",
                        help="report the leakage audit and write nothing")
    args = parser.parse_args()

    rows = load_labels(args.labels)
    built = build(rows, args.seed, DEFAULT_FRACTIONS)
    findings = audit_splits(rows, built["assignment"])

    manifest = {
        "version": "lidc-split-v1",
        "createdFrom": os.path.relpath(args.labels, ROOT).replace(os.sep, "/"),
        "identity": "source LIDC patient id — never the salted production UID",
        "unit": "patient",
        "seed": args.seed,
        "fractions": DEFAULT_FRACTIONS,
        "method": "HMAC-SHA256(seed, patient) -> [0,1), compared against cumulative bounds. "
                  "Adding a patient moves only that patient.",
        "labelProvenance": "Radiologist malignancy impressions from LIDC-IDRI. NOT "
                           "histopathological diagnosis, and not a clinical label.",
        "totals": {
            "patients": len({r["patient"] for r in rows}),
            "series": len({r["series_uid"] for r in rows}),
            "nodules": len(rows),
        },
        "summary": built["summary"],
        "leakageAudit": {k: (len(v) if isinstance(v, list) else v) for k, v in findings.items()},
        "assignment": built["assignment"],
    }
    manifest["fingerprint"] = fingerprint(
        {"seed": args.seed, "fractions": DEFAULT_FRACTIONS, "assignment": built["assignment"]}
    )

    print(f"patients {manifest['totals']['patients']}  series {manifest['totals']['series']}  "
          f"nodules {manifest['totals']['nodules']}", file=sys.stderr)
    for name in SPLIT_ORDER:
        s = built["summary"][name]
        print(f"  {name:<12} patients {s['patients']:>4}  series {s['series']:>4}  "
              f"nodules {s['nodules']:>5}  (malignant {s['malignant']}, benign {s['benign']})",
              file=sys.stderr)
    print(f"  fingerprint {manifest['fingerprint']}", file=sys.stderr)

    if not findings["clean"]:
        print("\nLEAKAGE AUDIT FAILED — no manifest written:", file=sys.stderr)
        for key, value in findings.items():
            if key != "clean" and value:
                print(f"  {key}: {len(value) if isinstance(value, list) else value}",
                      file=sys.stderr)
        return 2

    print("  leakage audit: clean (no patient, series or nodule in more than one split)",
          file=sys.stderr)

    if args.audit_only or not args.out_json:
        return 0

    with open(args.out_json, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
    print(f"  written -> {args.out_json}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
