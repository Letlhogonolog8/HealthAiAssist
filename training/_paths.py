"""
Where things are, resolved once.

`inference/` modules import each other by bare name (`from geometry import
...`), because the service runs with `inference/` as its working directory.
The harness reuses those modules rather than copying them, so it has to put
that directory on the path the same way the test suite's conftest does.
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INFERENCE_DIR = os.path.join(ROOT, "inference")

SPLIT_MANIFEST = os.path.join(ROOT, "docs", "splits", "lidc-split-v1.json")
AVAILABILITY_INDEX = os.path.join(ROOT, "docs", "splits", "lidc-availability.json")
LABEL_TABLE = os.path.join(ROOT, "dataset", "lidc-labels.csv")
ANNOTATION_EXCLUSIONS = os.path.join(ROOT, "dataset", "lidc-annotation-exclusions.csv")
DATASET_DECISION = os.path.join(ROOT, "docs", "P2_DATASET_DECISION.md")
LOCALISATION_METHODOLOGY = os.path.join(ROOT, "docs", "P2_LOCALIZATION_METHODOLOGY.md")
BAR = os.path.join(ROOT, "docs", "bars", "p2.json")
TRAINING_AUTHORISATION = os.path.join(ROOT, "docs", "decisions", "p2-training-authorisation.json")
DEFAULT_CONFIG = os.path.join(ROOT, "training", "configs", "lung_nodule_detector.yaml")
DICOM_ROOT = os.path.join(ROOT, "dataset", "manifest-1600709154662")

# Training outputs. Gitignored; see .gitignore and docs/P2_TRAINING_READINESS.md.
ARTIFACT_ROOT = os.path.join(ROOT, "artifacts", "training")


def ensure_inference_on_path() -> None:
    if INFERENCE_DIR not in sys.path:
        sys.path.insert(0, INFERENCE_DIR)
