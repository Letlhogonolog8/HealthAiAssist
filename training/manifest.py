"""
The committed split, verified before anything is allowed to read from it.

── Nothing here makes a split ─────────────────────────────────────────────

The split is `docs/splits/lidc-split-v1.json`, built once by
`scripts/lidc_build_splits.py` and committed. This module reads it, checks
it, and refuses. It never re-derives an assignment, never reshuffles, and
never moves a patient — not even one whose series turns out to have no pixel
data on this machine. A split that bends to what happens to be downloaded is
not a split.

── What "verified" means ──────────────────────────────────────────────────

Every check fails closed, and all of them run so that every problem is
reported at once:

  - the manifest has the fields it must have;
  - its recorded fingerprint matches one recomputed from its own contents,
    so an edited assignment is caught;
  - that fingerprint is the one the configuration pins, so a different split
    cannot be substituted without a visible configuration change;
  - every patient identity is a source LIDC identifier — never a salted
    production UID, never blank;
  - every label row's patient is assigned;
  - the six pairwise patient intersections between the four splits are empty,
    and no series or nodule lands in two splits
    (`scripts/lidc_build_splits.audit_splits`, reused rather than rewritten).

── Who may read which split ───────────────────────────────────────────────

`require_split` is the gate. Fitting reads train, and only train. Model
selection reads validation. Calibration reads calibration. Test is reachable
only for evaluation, which this harness never performs. A request outside
that table raises `SplitAccessDenied`; it does not warn and continue.
"""
from __future__ import annotations

import csv
import importlib.util
import json
import os
import re
from typing import Any, Dict, Iterable, List, Optional

from training import _paths
from training.fingerprint import sha256_file, sha256_json

SPLITS = ("train", "validation", "calibration", "test")

# Purpose -> the only splits that purpose may read.
PURPOSE_FIT = "fit"
PURPOSE_SELECT = "select"
PURPOSE_CALIBRATE = "calibrate"
PURPOSE_EVALUATE = "evaluate"

ALLOWED_SPLITS = {
    PURPOSE_FIT: frozenset({"train"}),
    PURPOSE_SELECT: frozenset({"validation"}),
    PURPOSE_CALIBRATE: frozenset({"calibration"}),
    PURPOSE_EVALUATE: frozenset({"test"}),
}

REQUIRED_MANIFEST_FIELDS = ("version", "seed", "fractions", "assignment", "fingerprint", "identity")
REQUIRED_LABEL_FIELDS = ("patient", "series_uid", "nodule_index", "sop_uid", "cx", "cy", "z")

# Source LIDC-IDRI patient identifiers. A salted production UID is a
# 2.25.<decimal> OID and fails this, which is the point.
SOURCE_PATIENT_ID = re.compile(r"^LIDC-IDRI-\d{4}$")


class SplitAccessDenied(Exception):
    """A split was requested for a purpose that may not read it."""


class ManifestInvalid(Exception):
    """The split manifest or the label table failed verification."""

    def __init__(self, problems: List[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def require_split(split: str, purpose: str) -> None:
    """Raise unless `purpose` may read `split`. The single enforcement point."""
    if purpose not in ALLOWED_SPLITS:
        raise SplitAccessDenied("unknown purpose %r" % purpose)
    if split not in SPLITS:
        raise SplitAccessDenied("unknown split %r" % split)
    if split not in ALLOWED_SPLITS[purpose]:
        raise SplitAccessDenied(
            "the %r split may not be read for %r. Allowed: %s. Test data is reachable only "
            "for final evaluation, and calibration data only for calibration."
            % (split, purpose, sorted(ALLOWED_SPLITS[purpose]))
        )


def split_fingerprint(manifest: Dict[str, Any]) -> str:
    """Recomputed exactly as scripts/lidc_build_splits.fingerprint does."""
    import hashlib

    blob = json.dumps(
        {"seed": manifest["seed"], "fractions": manifest["fractions"],
         "assignment": manifest["assignment"]},
        sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def load_manifest(path: str = _paths.SPLIT_MANIFEST) -> Dict[str, Any]:
    if not os.path.exists(path):
        raise ManifestInvalid(["split manifest not found: %s" % path])
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load_label_rows(path: str = _paths.LABEL_TABLE) -> List[Dict[str, str]]:
    if not os.path.exists(path):
        raise ManifestInvalid(["label table not found: %s" % path])
    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _audit_module():
    """scripts/lidc_build_splits.py, loaded by path — it is a script, not a package."""
    path = os.path.join(_paths.ROOT, "scripts", "lidc_build_splits.py")
    spec = importlib.util.spec_from_file_location("lidc_build_splits", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def verify(
    manifest: Dict[str, Any],
    rows: List[Dict[str, str]],
    expected_fingerprint: Optional[str],
) -> Dict[str, Any]:
    """Every check, all at once. Returns a report; `clean` is the verdict."""
    problems: List[str] = []

    missing = [f for f in REQUIRED_MANIFEST_FIELDS if f not in manifest]
    if missing:
        problems.append("manifest is missing required fields: %s" % ", ".join(missing))
        return {"clean": False, "problems": problems}

    assignment = manifest["assignment"]

    recomputed = split_fingerprint(manifest)
    if recomputed != manifest["fingerprint"]:
        problems.append(
            "manifest fingerprint %s does not match its own contents (recomputed %s): the "
            "assignment has been edited since it was built"
            % (manifest["fingerprint"], recomputed)
        )
    if expected_fingerprint is None:
        problems.append("no expected split fingerprint is pinned in the configuration")
    elif manifest["fingerprint"] != expected_fingerprint:
        problems.append(
            "split fingerprint %s is not the pinned %s: a different split has been "
            "substituted" % (manifest["fingerprint"], expected_fingerprint)
        )

    bad_identity = sorted(p for p in assignment if not SOURCE_PATIENT_ID.match(p or ""))
    if bad_identity:
        problems.append(
            "%d patient identifier(s) are not source LIDC ids (e.g. %r); patient identity "
            "cannot be established" % (len(bad_identity), bad_identity[0])
        )
    bad_split = sorted(p for p, s in assignment.items() if s not in SPLITS)
    if bad_split:
        problems.append("%d patient(s) assigned to an unknown split" % len(bad_split))

    for index, row in enumerate(rows):
        absent = [f for f in REQUIRED_LABEL_FIELDS if not (row.get(f) or "").strip()]
        if absent:
            problems.append(
                "label row %d is missing %s; its identity cannot be established"
                % (index, ", ".join(absent))
            )
            break

    # Six pairwise patient-level intersections, stated explicitly.
    members = dict((name, set()) for name in SPLITS)
    for patient, split in assignment.items():
        if split in members:
            members[split].add(patient)
    intersections = {}
    for position, first in enumerate(SPLITS):
        for second in SPLITS[position + 1:]:
            overlap = members[first] & members[second]
            # ASCII key: this report is printed to Windows consoles that
            # cannot encode an intersection sign.
            intersections["%s & %s" % (first, second)] = len(overlap)
            if overlap:
                problems.append("%d patient(s) in both %s and %s" % (len(overlap), first, second))

    audit = _audit_module().audit_splits(rows, assignment)
    for key, value in audit.items():
        if key != "clean" and value:
            problems.append("leakage audit: %s = %d" % (key, len(value)))

    return {
        "clean": not problems,
        "problems": problems,
        "fingerprint": manifest["fingerprint"],
        "recomputedFingerprint": recomputed,
        "patientIntersections": intersections,
        "patientsPerSplit": dict((name, len(members[name])) for name in SPLITS),
    }


def verified_manifest(
    expected_fingerprint: Optional[str],
    manifest_path: str = _paths.SPLIT_MANIFEST,
    labels_path: str = _paths.LABEL_TABLE,
) -> Dict[str, Any]:
    """Load and verify, raising ManifestInvalid on any problem."""
    manifest = load_manifest(manifest_path)
    rows = load_label_rows(labels_path)
    report = verify(manifest, rows, expected_fingerprint)
    if not report["clean"]:
        raise ManifestInvalid(report["problems"])
    return {"manifest": manifest, "rows": rows, "report": report}


def rows_for_split(
    rows: Iterable[Dict[str, str]], assignment: Dict[str, str], split: str, purpose: str
) -> List[Dict[str, str]]:
    """Label rows of one split, after the access check. The only row filter."""
    require_split(split, purpose)
    return [row for row in rows if assignment.get(row["patient"]) == split]


def dataset_fingerprint(
    *,
    manifest_path: str,
    labels_path: str,
    exclusions_path: Optional[str],
    decision_path: str,
    preprocessing: Dict[str, Any],
    sampling: Dict[str, Any],
    series_by_split: Dict[str, List[str]],
) -> Dict[str, Any]:
    """Which data definition produced a checkpoint.

    Source series identifiers are hashed rather than listed: they are public
    research identifiers, but an experiment manifest travels and there is no
    reason for it to carry them. The hash is enough to prove two runs used the
    same series, and the lists are reproducible from the split and the
    availability index.
    """
    parts = {
        "splitManifestSha256": sha256_file(manifest_path),
        "labelTableSha256": sha256_file(labels_path),
        "annotationExclusionsSha256": (
            sha256_file(exclusions_path) if exclusions_path and os.path.exists(exclusions_path) else None
        ),
        "datasetDecisionSha256": sha256_file(decision_path) if os.path.exists(decision_path) else None,
        "preprocessing": preprocessing,
        "sampling": sampling,
        "seriesBySplitSha256": dict(
            (name, sha256_json(sorted(series))) for name, series in sorted(series_by_split.items())
        ),
        "seriesCountBySplit": dict((name, len(series)) for name, series in sorted(series_by_split.items())),
    }
    return {"fingerprint": sha256_json(parts), "parts": parts}
