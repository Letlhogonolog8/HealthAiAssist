"""
Whether this machine can train the detector, measured rather than assumed.

── CPU is not a smaller GPU ───────────────────────────────────────────────

A CPU can run every line of the harness, and the synthetic tests do exactly
that. It cannot train the detector: measured on this repository's own
hardware, a 69,953-parameter toy 3D backbone managed 2.3 patches per second
(docs/P2_TRAINING_FEASIBILITY.md). So "torch imports and a forward pass runs"
is never reported as training readiness. Readiness means a CUDA device with
enough memory, the pinned stack, and the interpreter the training environment
was specified for.

── The verdict is binary, the report is not ───────────────────────────────

`probe()` records everything it can find; `assess()` turns that into
TRAINING READY or TRAINING NOT AVAILABLE with every reason listed, not just
the first. A machine missing both a GPU and the right Python is told both.

The minimums below are INITIAL ENGINEERING FLOORS — the smallest setup on
which a run of the configured patch size and batch is expected to fit. They
are not performance requirements and they say nothing about what a trained
model would do.
"""
from __future__ import annotations

import os
import platform
import sys
from typing import Any, Dict, List, Optional

from training.fingerprint import sha256_json

TRAINING_READY = "TRAINING READY"
TRAINING_NOT_AVAILABLE = "TRAINING NOT AVAILABLE"

# INITIAL ENGINEERING FLOOR. inference/py310/README.md records the decision
# that training runs on a separate interpreter of at least 3.10, so that the
# 3.8 serving runtime is never upgraded for the sake of offline work.
MIN_TRAINING_PYTHON = (3, 10)

# INITIAL ENGINEERING FLOOR, not a measured requirement: comfortably above
# what a 64x64x3 patch classifier at batch 256 needs, so an out-of-memory
# failure is not the first thing a real run discovers.
MIN_GPU_MEMORY_GB = 8.0

# Packages the harness imports, and the module name each is imported by.
REQUIRED_PACKAGES = {
    "torch": "torch",
    "numpy": "numpy",
    "pydicom": "pydicom",
    "scipy": "scipy",
    "pyyaml": "yaml",
}


def _version(module_name: str) -> Optional[str]:
    try:
        module = __import__(module_name)
    except Exception:  # noqa: BLE001 - absence is the answer, not an error
        return None
    return str(getattr(module, "__version__", "unknown"))


def _system_memory_gb() -> Optional[float]:
    """Physical memory, without adding psutil as a dependency."""
    try:
        if sys.platform.startswith("win"):
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            status = MemoryStatus()
            status.dwLength = ctypes.sizeof(MemoryStatus)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):  # type: ignore[attr-defined]
                return round(status.ullTotalPhys / float(1 << 30), 2)
            return None
        pages = os.sysconf("SC_PHYS_PAGES")
        size = os.sysconf("SC_PAGE_SIZE")
        return round(pages * size / float(1 << 30), 2)
    except Exception:  # noqa: BLE001
        return None


def probe() -> Dict[str, Any]:
    """Everything observable about the environment. Changes nothing."""
    report: Dict[str, Any] = {
        "python": platform.python_version(),
        "pythonImplementation": platform.python_implementation(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "cpuCount": os.cpu_count(),
        "systemMemoryGb": _system_memory_gb(),
        "packages": {name: _version(module) for name, module in REQUIRED_PACKAGES.items()},
        "torch": {
            "importable": False,
            "cudaAvailable": False,
            "cudaVersion": None,
            "cudnnVersion": None,
            "gpuCount": 0,
            "gpus": [],
        },
    }

    try:
        import torch
    except Exception:  # noqa: BLE001
        return report

    info = report["torch"]
    info["importable"] = True
    info["cudaVersion"] = getattr(torch.version, "cuda", None)
    try:
        info["cudaAvailable"] = bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        info["cudaAvailable"] = False
    if info["cudaAvailable"]:
        try:
            info["cudnnVersion"] = torch.backends.cudnn.version()
        except Exception:  # noqa: BLE001
            info["cudnnVersion"] = None
        count = torch.cuda.device_count()
        info["gpuCount"] = int(count)
        for index in range(count):
            properties = torch.cuda.get_device_properties(index)
            info["gpus"].append({
                "index": index,
                "name": properties.name,
                "capability": "%d.%d" % (properties.major, properties.minor),
                "memoryGb": round(properties.total_memory / float(1 << 30), 2),
            })
    return report


def assess(report: Dict[str, Any]) -> Dict[str, Any]:
    """TRAINING READY only if every requirement holds; every failure named."""
    reasons: List[str] = []

    version = tuple(int(part) for part in report["python"].split(".")[:2])
    if version < MIN_TRAINING_PYTHON:
        reasons.append(
            "Python %s is below the training minimum %d.%d recorded in "
            "inference/py310/README.md. The serving interpreter is not the training one."
            % (report["python"], MIN_TRAINING_PYTHON[0], MIN_TRAINING_PYTHON[1])
        )

    missing = [name for name, found in report["packages"].items() if found is None]
    if missing:
        reasons.append("Required packages are not installed: %s." % ", ".join(sorted(missing)))

    torch_info = report["torch"]
    if not torch_info["importable"]:
        reasons.append("PyTorch cannot be imported.")
    elif not torch_info["cudaAvailable"]:
        reasons.append(
            "CUDA is not available (torch %s). The detector is not trained on CPU: measured "
            "throughput on this hardware class is about 2.3 patches per second "
            "(docs/P2_TRAINING_FEASIBILITY.md)." % (report["packages"].get("torch") or "?")
        )
    elif not torch_info["gpus"]:
        reasons.append("CUDA reports available but no device was enumerated.")
    else:
        largest = max(gpu["memoryGb"] for gpu in torch_info["gpus"])
        if largest < MIN_GPU_MEMORY_GB:
            reasons.append(
                "The largest GPU has %.1f GB, below the %.1f GB engineering floor."
                % (largest, MIN_GPU_MEMORY_GB)
            )

    return {
        "verdict": TRAINING_READY if not reasons else TRAINING_NOT_AVAILABLE,
        "reasons": reasons,
        "minimums": {
            "python": "%d.%d" % MIN_TRAINING_PYTHON,
            "gpuMemoryGb": MIN_GPU_MEMORY_GB,
            "status": "INITIAL ENGINEERING FLOOR — not a measured requirement",
        },
    }


def environment_fingerprint(report: Dict[str, Any]) -> str:
    """What a checkpoint records about where it was made.

    Covers the interpreter, the package versions and the device model, and
    deliberately not hostnames, paths or user names — an experiment manifest
    travels, and none of those belong in it.
    """
    torch_info = report["torch"]
    return sha256_json({
        "python": report["python"],
        "implementation": report["pythonImplementation"],
        "machine": report["machine"],
        "packages": report["packages"],
        "cudaVersion": torch_info["cudaVersion"],
        "cudnnVersion": torch_info["cudnnVersion"],
        "gpus": [(gpu["name"], gpu["capability"]) for gpu in torch_info["gpus"]],
    })
