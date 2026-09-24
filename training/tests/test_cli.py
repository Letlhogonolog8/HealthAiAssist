"""
The three commands, run as a person would run them.

Exit codes are the contract a pipeline reads, so they are asserted exactly.
Where the answer depends on the machine — whether CUDA exists, whether the
gitignored LIDC label table is present — the test states which case it is in
rather than skipping silently.
"""
from __future__ import annotations

import os
import subprocess
import sys

import pytest

from training import _paths

ROOT = _paths.ROOT
HAS_LABELS = os.path.exists(_paths.LABEL_TABLE) and os.path.exists(_paths.ANNOTATION_EXCLUSIONS)


def has_cuda():
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        return False


def run(*args):
    completed = subprocess.run([sys.executable] + list(args), cwd=ROOT, capture_output=True,
                               text=True, encoding="utf-8", errors="replace", timeout=600)
    return completed.returncode, completed.stdout + completed.stderr


def test_the_environment_check_reports_not_available_without_cuda():
    if has_cuda():
        pytest.skip("this machine has CUDA; the no-GPU verdict is covered in test_environment.py")
    code, output = run("scripts/check-training-environment.py")
    assert code == 1
    assert "TRAINING NOT AVAILABLE" in output
    assert "CUDA is not available" in output


def test_the_manifest_verifier_passes_the_committed_split():
    if not os.path.exists(_paths.LABEL_TABLE):
        pytest.skip("dataset/lidc-labels.csv is gitignored and absent in this checkout")
    code, output = run("scripts/verify-training-manifest.py")
    assert code == 0, output
    assert "MANIFEST VERIFIED" in output


def test_the_manifest_verifier_fails_a_substituted_split():
    if not os.path.exists(_paths.LABEL_TABLE):
        pytest.skip("dataset/lidc-labels.csv is gitignored and absent in this checkout")
    code, output = run("scripts/verify-training-manifest.py", "--expected-fingerprint", "0" * 16)
    assert code == 1
    assert "MANIFEST INVALID" in output


def _experiments():
    directory = os.path.join(ROOT, "artifacts", "training", "experiments")
    return set(os.listdir(directory)) if os.path.isdir(directory) else set()


def test_the_dry_run_never_trains_and_says_why():
    before = _experiments()
    code, output = run("scripts/train_lung_detector.py", "--dry-run")
    assert "TRAINING NOT EXECUTED" in output
    if HAS_LABELS and not has_cuda():
        assert code == 3, output
        assert "HARNESS READY, ENVIRONMENT NOT AVAILABLE" in output
    elif not HAS_LABELS:
        assert code == 2, output        # the manifest gate cannot pass without the label table
    assert _experiments() == before, "a dry run created an experiment"


def test_a_real_run_is_refused_without_a_gpu():
    if has_cuda():
        pytest.skip("this machine has CUDA; the refusal is covered by test_training.py")
    code, output = run("scripts/train_lung_detector.py")
    assert code == 1, output
    assert "TRAINING REFUSED" in output


def test_epochs_cannot_be_overridden_for_a_real_run():
    code, output = run("scripts/train_lung_detector.py", "--epochs", "3")
    assert code == 2
    assert "only accepted with --synthetic" in output
