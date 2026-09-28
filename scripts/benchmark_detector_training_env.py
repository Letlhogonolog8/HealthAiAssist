#!/usr/bin/env python3
"""
Benchmark a machine for detector training — without training a detector.

    python scripts/benchmark_detector_training_env.py
    python scripts/benchmark_detector_training_env.py --batch-sizes 32,64,128,256 --steps 20
    python scripts/benchmark_detector_training_env.py --json out.json

── What it measures ───────────────────────────────────────────────────────

On a CUDA device, with the detector architecture from the training
configuration, on **random synthetic tensors**:

  * GPU model, VRAM, CUDA and PyTorch versions, system RAM
  * for each batch size: peak allocated and reserved GPU memory for one
    training step (forward, backward, AdamW update) and for inference, and
    patches per second
  * whether 8 / 12 / 16 / 24 GB would hold the configured batch with headroom

And, on any machine, from the configuration and the committed split
artefacts: how many samples a run makes, the sample-cache size, the checkpoint
size, the DICOM storage on disk, and a projected time per epoch.

── What it is not ─────────────────────────────────────────────────────────

**Not training and not a detector.** The weights are random and are thrown
away; no checkpoint is written; nothing is registered. The inputs are random
numbers, never patient images and never the test split. Nothing it prints is a
detection metric. Its output says so.

**Not authorisation.** A machine that benchmarks well is still refused by the
training harness until every decision in
docs/P2_TRAINING_GATE_DECISION_REGISTER.md is approved.

**Throughput excludes data loading.** It is the model's rate on tensors
already on the GPU — an upper bound on training speed. Real epochs also read
the sample cache and augment on the CPU.

── Exit codes ─────────────────────────────────────────────────────────────

    0  benchmark completed on a CUDA device
    2  GPU TRAINING BLOCKED — NO CUDA DEVICE (estimates are still printed)
    3  the configuration or split artefacts could not be read

`--cpu-smoke` runs the same measurement on the CPU with a tiny workload so the
script itself can be tested on a machine without a GPU. Its output is labelled
CPU SMOKE — NOT A BENCHMARK and its figures mean nothing about a GPU.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from training import _paths  # noqa: E402
from training import config as training_config  # noqa: E402
from training import environment as env  # noqa: E402

EXIT_OK = 0
EXIT_NO_CUDA = 2
EXIT_UNREADABLE = 3

LABEL = "BENCHMARK ON SYNTHETIC TENSORS — NOT TRAINING, NOT A DETECTOR, NOT A METRIC"
SMOKE_LABEL = "CPU SMOKE — NOT A BENCHMARK"
CAPACITIES_GB = (8, 12, 16, 24)
# Fraction of a card the configured batch may use and still be called
# sufficient: allocator fragmentation, the CUDA context and a second process
# (an evaluation, a viewer) all need room. An engineering margin, stated.
HEADROOM = 0.8
GIB = float(1 << 30)


def _bytes(value: Optional[float]) -> Optional[float]:
    return None if value is None else round(value / GIB, 3)


def estimates(config: Dict[str, Any], scan_dicom: bool) -> Dict[str, Any]:
    """What a real run would need, from the configuration and committed artefacts."""
    from training import dataset as ds
    from training import model as mdl

    availability = json.load(open(_paths.AVAILABILITY_INDEX, encoding="utf-8"))
    per_split = availability.get("perSplit", {})

    def split_counts(name: str) -> Dict[str, int]:
        entry = per_split.get(name, {})
        return {"series": int(entry.get("seriesAvailable", 0)), "nodules": int(entry.get("nodulesAvailable", 0))}

    fit, select = split_counts(config["data"]["fit_split"]), split_counts(config["data"]["select_split"])
    sampling = config["sampling"]
    negatives = int(sampling["negatives_per_series"])
    positives_per = int(sampling["positives_per_target"])

    channels = int(config["patch"]["channels"])
    side = ds.context_side_for(config)
    bytes_per_sample = channels * side * side * 2  # float16 contexts, as dataset.py stores them
    samples = {
        "train": fit["nodules"] * positives_per + fit["series"] * negatives,
        "validation": select["nodules"] * positives_per + select["series"] * negatives,
    }
    cache_bytes = sum(samples.values()) * bytes_per_sample

    params = mdl.parameter_count(mdl.build(config))
    # Weights plus AdamW's two moment buffers, float32, for best and last.
    checkpoint_bytes = params * 4 * 3 * 2

    dicom_bytes = None
    dicom_files = None
    root = config["data"]["dicom_root"]
    root = root if os.path.isabs(root) else os.path.join(_paths.ROOT, root)
    if scan_dicom and os.path.isdir(root):
        dicom_bytes, dicom_files = 0, 0
        for directory, _subdirs, files in os.walk(root):
            for name in files:
                if name.lower().endswith(".dcm"):
                    dicom_files += 1
                    dicom_bytes += os.path.getsize(os.path.join(directory, name))

    return {
        "fitSplit": fit,
        "selectSplit": select,
        "samplesPerEpoch": samples,
        "contextShape": [channels, side, side],
        "bytesPerCachedSample": bytes_per_sample,
        "sampleCacheGB": _bytes(cache_bytes),
        "parameters": params,
        "checkpointsGB": _bytes(checkpoint_bytes),
        "dicomOnDiskGB": _bytes(dicom_bytes),
        "dicomFiles": dicom_files,
        "workingSpaceGB": _bytes(cache_bytes + checkpoint_bytes) if cache_bytes else None,
        "note": "Samples use the committed availability index; the test and calibration splits are "
                "never counted. Storage for the rest of LIDC-IDRI (about 60 GB more) is not included.",
    }


def measure(config: Dict[str, Any], device: str, batch_sizes: List[int], steps: int,
            warmup: int) -> List[Dict[str, Any]]:
    """Peak memory and throughput per batch size, on random tensors."""
    import torch

    from training import model as mdl

    channels = int(config["patch"]["channels"])
    patch = int(config["patch"]["patch_px"])
    optimisation = config["optimisation"]
    results = []
    for batch in batch_sizes:
        row: Dict[str, Any] = {"batchSize": batch, "inputShape": [batch, channels, patch, patch]}
        try:
            torch.manual_seed(0)
            model = mdl.build(config).to(device)
            optimiser = torch.optim.AdamW(model.parameters(), lr=float(optimisation["learning_rate"]),
                                          weight_decay=float(optimisation["weight_decay"]))
            loss_fn = torch.nn.BCEWithLogitsLoss()
            x = torch.rand(batch, channels, patch, patch, device=device)
            y = (torch.rand(batch, device=device) > 0.5).float()
            if device == "cuda":
                torch.cuda.synchronize()
                torch.cuda.reset_peak_memory_stats()
            model.train()
            for _ in range(warmup):
                optimiser.zero_grad(set_to_none=True)
                loss_fn(model(x).reshape(-1), y).backward()
                optimiser.step()
            if device == "cuda":
                torch.cuda.synchronize()
            started = time.perf_counter()
            for _ in range(steps):
                optimiser.zero_grad(set_to_none=True)
                loss_fn(model(x).reshape(-1), y).backward()
                optimiser.step()
            if device == "cuda":
                torch.cuda.synchronize()
            elapsed = time.perf_counter() - started
            row["trainPatchesPerSecond"] = round(batch * steps / elapsed, 1) if elapsed > 0 else None
            if device == "cuda":
                row["trainPeakAllocatedGB"] = _bytes(torch.cuda.max_memory_allocated())
                row["trainPeakReservedGB"] = _bytes(torch.cuda.max_memory_reserved())
                torch.cuda.reset_peak_memory_stats()
            model.eval()
            with torch.no_grad():
                started = time.perf_counter()
                for _ in range(steps):
                    model(x)
                if device == "cuda":
                    torch.cuda.synchronize()
                elapsed = time.perf_counter() - started
            row["inferencePatchesPerSecond"] = round(batch * steps / elapsed, 1) if elapsed > 0 else None
            if device == "cuda":
                row["inferencePeakAllocatedGB"] = _bytes(torch.cuda.max_memory_allocated())
            row["status"] = "ok"
        except RuntimeError as exc:
            if "out of memory" not in str(exc).lower():
                raise
            row["status"] = "out_of_memory"
        finally:
            if device == "cuda":
                import torch as _t

                _t.cuda.empty_cache()
        results.append(row)
    return results


def sufficiency(rows: List[Dict[str, Any]], configured_batch: int) -> Dict[str, Any]:
    """Which card sizes hold the configured batch with headroom. Measured, not assumed."""
    row = next((r for r in rows if r["batchSize"] == configured_batch), None)
    if row is None or row.get("status") != "ok" or row.get("trainPeakReservedGB") is None:
        return {"configuredBatch": configured_batch, "measured": False,
                "note": "the configured batch size was not measured on a CUDA device"}
    peak = row["trainPeakReservedGB"]
    return {
        "configuredBatch": configured_batch,
        "measured": True,
        "peakReservedGB": peak,
        "headroom": HEADROOM,
        "sufficient": {"%dGB" % gb: peak <= gb * HEADROOM for gb in CAPACITIES_GB},
        "note": "Model memory only. The CUDA context adds several hundred MB; data loading adds none "
                "on the GPU.",
    }


def projections(est: Dict[str, Any], rows: List[Dict[str, Any]], config: Dict[str, Any]) -> Dict[str, Any]:
    batch = int(config["optimisation"]["batch_size"])
    row = next((r for r in rows if r["batchSize"] == batch and r.get("status") == "ok"), None)
    if row is None or not row.get("trainPatchesPerSecond"):
        return {"measured": False}
    train, val = est["samplesPerEpoch"]["train"], est["samplesPerEpoch"]["validation"]
    epoch_seconds = train / row["trainPatchesPerSecond"] + val / row["inferencePatchesPerSecond"]
    epochs = int(config["optimisation"]["epochs"])
    return {
        "measured": True,
        "secondsPerEpochLowerBound": round(epoch_seconds, 1),
        "configuredEpochs": epochs,
        "hoursForConfiguredEpochsLowerBound": round(epoch_seconds * epochs / 3600.0, 2),
        "note": "Lower bound: model time only. Data loading, augmentation and sample-cache building "
                "(about 30 s to several minutes per series on first use) are excluded.",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=_paths.DEFAULT_CONFIG)
    parser.add_argument("--batch-sizes", default=None,
                        help="comma-separated; default is 32, 64, the configured size and twice it")
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--warmup", type=int, default=3)
    parser.add_argument("--json", default=None, help="also write the report here")
    parser.add_argument("--no-dicom-scan", action="store_true", help="skip summing the DICOM tree")
    parser.add_argument("--cpu-smoke", action="store_true",
                        help="exercise the measurement on CPU with a tiny workload; not a benchmark")
    args = parser.parse_args()

    try:
        config = training_config.load(args.config)
        est = estimates(config, scan_dicom=not args.no_dicom_scan)
    except Exception as exc:  # noqa: BLE001 - reported, with the reason
        print("BENCHMARK NOT RUN — the configuration or split artefacts could not be read: %s" % exc)
        return EXIT_UNREADABLE

    probe = env.probe()
    import torch

    cuda = bool(torch.cuda.is_available())
    report: Dict[str, Any] = {
        "label": SMOKE_LABEL if args.cpu_smoke else LABEL,
        "createdAt": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "configFingerprint": training_config.fingerprint(config),
        "environment": {
            "python": probe.get("python"),
            "torch": (probe.get("packages") or {}).get("torch") or torch.__version__,
            "cudaAvailable": cuda,
            "cudaVersion": (probe.get("torch") or {}).get("cudaVersion"),
            "cudnnVersion": (probe.get("torch") or {}).get("cudnnVersion"),
            "gpus": (probe.get("torch") or {}).get("gpus"),
            "systemMemoryGB": probe.get("systemMemoryGb"),
            "cpus": probe.get("cpuCount"),
        },
        "estimates": est,
        "configured": {"batchSize": int(config["optimisation"]["batch_size"]),
                       "patchPx": int(config["patch"]["patch_px"]),
                       "channels": int(config["patch"]["channels"])},
    }

    configured = int(config["optimisation"]["batch_size"])
    if args.cpu_smoke:
        rows = measure(config, "cpu", [2, 4], steps=2, warmup=1)
        report["measurements"] = rows
        report["verdict"] = SMOKE_LABEL
        code = EXIT_OK
    elif not cuda:
        report["measurements"] = []
        report["verdict"] = "GPU TRAINING BLOCKED — NO CUDA DEVICE"
        code = EXIT_NO_CUDA
    else:
        sizes = ([int(s) for s in args.batch_sizes.split(",")] if args.batch_sizes
                 else sorted({32, 64, configured, configured * 2}))
        rows = measure(config, "cuda", sizes, steps=args.steps, warmup=args.warmup)
        report["measurements"] = rows
        report["sufficiency"] = sufficiency(rows, configured)
        report["projection"] = projections(est, rows, config)
        report["verdict"] = "BENCHMARK COMPLETE — TRAINING NOT EXECUTED, NOT AUTHORISED BY THIS"
        code = EXIT_OK

    print(report["label"])
    print("=" * 72)
    e = report["environment"]
    print("python %s · torch %s · CUDA %s · RAM %s GB · CPUs %s"
          % (e["python"], e["torch"], e["cudaVersion"] if cuda else "none", e["systemMemoryGB"], e["cpus"]))
    for gpu in e["gpus"] or []:
        print("GPU  %s" % gpu)
    print("samples per epoch  train %d, validation %d (context %s, float16)"
          % (est["samplesPerEpoch"]["train"], est["samplesPerEpoch"]["validation"], est["contextShape"]))
    print("sample cache       %s GB · checkpoints %s GB · DICOM on disk %s GB (%s files)"
          % (est["sampleCacheGB"], est["checkpointsGB"], est["dicomOnDiskGB"], est["dicomFiles"]))
    for row in report.get("measurements", []):
        print("batch %4d  %s  train %s patch/s  infer %s patch/s  peak reserved %s GB"
              % (row["batchSize"], row["status"], row.get("trainPatchesPerSecond"),
                 row.get("inferencePatchesPerSecond"), row.get("trainPeakReservedGB")))
    if "sufficiency" in report:
        print("sufficient cards   %s" % report["sufficiency"].get("sufficient"))
    if report.get("projection", {}).get("measured"):
        print("epoch lower bound  %s s; %s epochs ≥ %s h"
              % (report["projection"]["secondsPerEpochLowerBound"], report["projection"]["configuredEpochs"],
                 report["projection"]["hoursForConfiguredEpochsLowerBound"]))
    print()
    print(report["verdict"])

    target = args.json
    if target is None and not args.cpu_smoke:
        stamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        target = os.path.join(_paths.ARTIFACT_ROOT, "benchmarks", "benchmark-%s.json" % stamp)
    if target:
        os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
        with open(target, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2)
        try:
            shown = os.path.relpath(target, _paths.ROOT)
        except ValueError:  # a different drive on Windows
            shown = os.path.abspath(target)
        print("report written to %s" % shown.replace(os.sep, "/"))
    return code


if __name__ == "__main__":
    sys.exit(main())
