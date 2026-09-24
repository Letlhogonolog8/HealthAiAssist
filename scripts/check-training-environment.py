#!/usr/bin/env python3
"""
Can this machine train the lung nodule candidate detector?

    python scripts/check-training-environment.py
    python scripts/check-training-environment.py --json

Prints everything observable — interpreter, package versions, CUDA, every GPU
and its memory, system memory — and then a verdict:

    TRAINING READY            exit 0
    TRAINING NOT AVAILABLE    exit 1, with every reason listed

A CPU is never reported as training-ready, however capable. See
training/environment.py for the floors and why each exists.
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

from training import environment  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    report = environment.probe()
    verdict = environment.assess(report)
    fingerprint = environment.environment_fingerprint(report)

    if args.json:
        print(json.dumps({"environment": report, "assessment": verdict,
                          "environmentFingerprint": fingerprint}, indent=2))
        return 0 if verdict["verdict"] == environment.TRAINING_READY else 1

    torch_info = report["torch"]
    print("Detector training environment")
    print("=" * 60)
    print("python          %s (%s)" % (report["python"], report["pythonImplementation"]))
    print("platform        %s" % report["platform"])
    print("cpus            %s" % report["cpuCount"])
    print("system memory   %s GB" % report["systemMemoryGb"])
    for name, version in sorted(report["packages"].items()):
        print("%-15s %s" % (name, version or "NOT INSTALLED"))
    print("cuda available  %s" % torch_info["cudaAvailable"])
    print("cuda version    %s" % torch_info["cudaVersion"])
    print("cudnn version   %s" % torch_info["cudnnVersion"])
    print("gpu count       %d" % torch_info["gpuCount"])
    for gpu in torch_info["gpus"]:
        print("  gpu %d         %s, capability %s, %.1f GB"
              % (gpu["index"], gpu["name"], gpu["capability"], gpu["memoryGb"]))
    print("fingerprint     %s" % fingerprint[:16])
    print()
    print(verdict["verdict"])
    for reason in verdict["reasons"]:
        print("  - %s" % reason)
    print()
    print("Minimums are %s." % verdict["minimums"]["status"])
    return 0 if verdict["verdict"] == environment.TRAINING_READY else 1


if __name__ == "__main__":
    raise SystemExit(main())
