"""
The lung nodule detector does not exist, and nothing may make it look as if it does.

Pinned here, so that registering a detector, committing a checkpoint or
filling in a result is a deliberate change that fails a test, never a side
effect:

  * no model binary is tracked in git;
  * nothing outside tests registers a detector, and the slot reports empty;
  * the pre-registration still records every result as absent and every
    approval as not given.

Promotion is not forbidden. It is required to be visible: it means changing
this file in the same change that records the evidence and the approval.
"""
from __future__ import annotations

import json
import os
import re
import subprocess

import pytest

import detection_service

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _tracked_files():
    try:
        out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("git is not available")
    return out.stdout.splitlines()


def test_no_model_binary_is_tracked():
    binaries = [f for f in _tracked_files()
                if re.search(r"\.(pt|pth|ckpt|onnx|h5|keras|safetensors|tflite)$", f, re.IGNORECASE)]
    assert binaries == [], binaries


def test_nothing_outside_tests_registers_a_detector():
    callers = []
    for directory in ("inference", "server", "scripts", "training"):
        for base, _dirs, files in os.walk(os.path.join(ROOT, directory)):
            if "tests" in base.split(os.sep) or "node_modules" in base or "__pycache__" in base:
                continue
            for name in files:
                if not name.endswith(".py"):
                    continue
                path = os.path.join(base, name)
                source = open(path, encoding="utf-8", errors="ignore").read()
                if re.search(r"\bregister_detector\(", source) and not name == "detection_service.py":
                    callers.append(os.path.relpath(path, ROOT))
    assert callers == [], "register_detector is called outside tests: %s" % callers


def test_the_detector_slot_is_empty():
    status = detection_service.detector_status()
    assert status["available"] is False
    assert status["version"] is None
    assert "refuses" in status["note"]


def test_the_pre_registration_records_nothing_as_done():
    with open(os.path.join(ROOT, "docs", "bars", "p2.json"), encoding="utf-8") as handle:
        bar = json.load(handle)
    assert bar["status"] == "DRAFT_NOT_APPROVED"
    assert bar["proposedGate"]["approval"]["approved"] is False
    assert bar["proposedGate"]["approval"]["approvedBy"] is None
    assert bar["metrics"]["localisationTolerance"]["status"] == "BLOCKED"
    assert bar["validationState"]["current"] == "not started"
    assert bar["ood"]["status"] == "NOT YET BUILT"
    assert bar["calibration"]["status"] == "NOT YET PERFORMED"
    assert bar["trainingHarness"]["checkpoint"] == "ABSENT"
    assert bar["evaluationMachinery"]["hasEverBeenRunOnADetectorOutput"] is False


def test_no_detector_measurement_is_bound_on_the_node_side():
    with open(os.path.join(ROOT, "server", "model-governance.ts"), encoding="utf-8") as handle:
        governance = handle.read()
    assert not re.search(r"lung[_-]?detector|nodule[_-]detection", governance, re.IGNORECASE)
