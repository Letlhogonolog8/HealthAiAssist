"""
training/environment.py: CPU is never training readiness.

The assessments here are made on constructed reports, so they test the rule
rather than whatever machine the suite happens to run on. One test reads the
real machine and asserts only what is true of every machine without CUDA.
"""
from __future__ import annotations

import copy
import platform

import pytest

from training import environment as env


def ready_report():
    """A report that meets every requirement. Constructed, not measured."""
    return {
        "python": "3.10.14",
        "pythonImplementation": "CPython",
        "platform": "Linux",
        "machine": "x86_64",
        "cpuCount": 16,
        "systemMemoryGb": 64.0,
        "packages": {"torch": "2.3.1+cu121", "numpy": "1.26.4", "pydicom": "2.4.4",
                     "scipy": "1.13.1", "pyyaml": "6.0.1"},
        "torch": {"importable": True, "cudaAvailable": True, "cudaVersion": "12.1",
                  "cudnnVersion": 8902, "gpuCount": 1,
                  "gpus": [{"index": 0, "name": "Constructed GPU", "capability": "8.6", "memoryGb": 24.0}]},
    }


def test_a_complete_gpu_environment_is_ready():
    verdict = env.assess(ready_report())
    assert verdict["verdict"] == env.TRAINING_READY
    assert verdict["reasons"] == []


def test_no_cuda_is_not_available_however_large_the_cpu():
    report = ready_report()
    report["cpuCount"] = 128
    report["systemMemoryGb"] = 1024.0
    report["torch"].update(cudaAvailable=False, gpuCount=0, gpus=[])
    verdict = env.assess(report)
    assert verdict["verdict"] == env.TRAINING_NOT_AVAILABLE
    assert any("CUDA is not available" in reason for reason in verdict["reasons"])


def test_the_serving_interpreter_is_not_the_training_one():
    report = ready_report()
    report["python"] = "3.8.10"
    verdict = env.assess(report)
    assert verdict["verdict"] == env.TRAINING_NOT_AVAILABLE
    assert any("3.10" in reason for reason in verdict["reasons"])


def test_a_small_gpu_is_below_the_floor():
    report = ready_report()
    report["torch"]["gpus"][0]["memoryGb"] = 4.0
    assert env.assess(report)["verdict"] == env.TRAINING_NOT_AVAILABLE


def test_a_missing_package_is_named():
    report = ready_report()
    report["packages"]["pydicom"] = None
    verdict = env.assess(report)
    assert any("pydicom" in reason for reason in verdict["reasons"])


def test_every_failure_is_reported_not_just_the_first():
    report = ready_report()
    report["python"] = "3.8.10"
    report["packages"]["scipy"] = None
    report["torch"].update(cudaAvailable=False, gpuCount=0, gpus=[])
    assert len(env.assess(report)["reasons"]) == 3


def test_the_floors_say_they_are_engineering_floors():
    assert "ENGINEERING FLOOR" in env.assess(ready_report())["minimums"]["status"]


def test_the_fingerprint_is_stable_and_moves_with_the_stack():
    a = env.environment_fingerprint(ready_report())
    assert a == env.environment_fingerprint(copy.deepcopy(ready_report()))
    changed = ready_report()
    changed["packages"]["torch"] = "2.4.0+cu121"
    assert env.environment_fingerprint(changed) != a


def test_the_fingerprint_ignores_things_that_identify_a_machine():
    """Host names and platform strings do not belong in a travelling manifest."""
    a = ready_report()
    b = ready_report()
    b["platform"] = "some-other-host-name"
    b["cpuCount"] = 2
    assert env.environment_fingerprint(a) == env.environment_fingerprint(b)


def test_the_real_probe_reports_this_interpreter():
    report = env.probe()
    assert report["python"] == platform.python_version()


def test_this_machine_without_cuda_is_reported_unavailable():
    report = env.probe()
    if report["torch"]["cudaAvailable"]:
        pytest.skip("this machine has CUDA; the rule is covered by the constructed reports")
    assert env.assess(report)["verdict"] == env.TRAINING_NOT_AVAILABLE
