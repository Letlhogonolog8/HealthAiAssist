#!/usr/bin/env python3
"""
Train the lung nodule candidate detector — or say exactly why not.

    python scripts/train_lung_detector.py --dry-run
    python scripts/train_lung_detector.py --config training/configs/lung_nodule_detector.yaml
    python scripts/train_lung_detector.py --stop-after-epochs 10        # pause; resumable
    python scripts/train_lung_detector.py --resume artifacts/training/experiments/<id>/checkpoints/last.pt
    python scripts/train_lung_detector.py --synthetic --epochs 2      # harness test only

The number of epochs for a real run is the configuration's and nothing else's,
so the configuration fingerprint recorded in every checkpoint describes the
run that was made. `--epochs` is accepted only with `--synthetic`, where it is
written into the configuration before it is fingerprinted.

── The gates ──────────────────────────────────────────────────────────────

Every run, dry or real, checks the same things in the same order and reports
each as PASS or FAIL:

    configuration    loads, validates, matches the service, claims no approval
    governance       localisation and bar status agree with the repository record
    authorisation    all nine decisions APPROVED by a named owner (real runs only)
    manifest         patient-disjoint, fingerprint pinned, source identities
    availability     index present and computed against this split
    exclusions       the all-annotation index exists (negatives depend on it)
    model            builds, and a forward pass has the service's shapes
    checkpointing    a checkpoint can be written, reloaded and fingerprinted
    output           the artifact directory is writable
    environment      CUDA, GPU memory, training interpreter, pinned packages

A dry run stops there and never trains:

    DRY RUN SUCCESS — TRAINING NOT EXECUTED                       exit 0
    DRY RUN FAILED — HARNESS READY, TRAINING NOT AUTHORISED       exit 4
    DRY RUN FAILED — HARNESS READY, ENVIRONMENT NOT AVAILABLE     exit 3
    DRY RUN FAILED — HARNESS NOT READY                            exit 2

Authorisation is checked before the environment and reported alongside it: a
machine with a GPU is not permission to train. The record is
docs/decisions/p2-training-authorisation.json, read by training/authorisation.py,
with no override.

A real run trains only if every gate passes, and otherwise prints
TRAINING REFUSED and exits non-zero. There is no CPU fallback for LIDC data.

── --synthetic ────────────────────────────────────────────────────────────

Builds a tiny in-memory CT-like set and trains on CPU, writing into
artifacts/training/test-artifacts/. Every output is labelled SYNTHETIC — TEST
ARTIFACT and every checkpoint has status TEST_ARTIFACT. It exists to exercise
the loop; nothing it produces is a detector.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from typing import Any, Callable, Dict, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Reports use em dashes and other non-ASCII; Windows consoles default to cp1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from training import _paths  # noqa: E402
from training import checkpoint as ckpt  # noqa: E402
from training import config as training_config  # noqa: E402
from training import dataset as ds  # noqa: E402
from training import environment as env  # noqa: E402
from training import manifest as mf  # noqa: E402
from training import authorisation  # noqa: E402

EXIT_OK = 0
EXIT_REFUSED = 1
EXIT_HARNESS = 2
EXIT_ENVIRONMENT = 3
EXIT_NOT_AUTHORISED = 4


def _resolve(path: str) -> str:
    return path if os.path.isabs(path) else os.path.join(_paths.ROOT, path)


class Gates(object):
    def __init__(self) -> None:
        self.results: List[Tuple[str, bool, str]] = []

    def run(self, name: str, check: Callable[[], str]) -> Any:
        try:
            detail = check()
            self.results.append((name, True, detail or ""))
            return True
        except Exception as exc:  # noqa: BLE001 - every failure is reported, none swallowed
            problems = getattr(exc, "problems", None) or getattr(exc, "reasons", None) or [str(exc)]
            self.results.append((name, False, "; ".join(str(p) for p in problems)))
            return False

    def failed(self, names: Tuple[str, ...] = ()) -> List[str]:
        return [n for n, ok, _ in self.results if not ok and (not names or n in names)]

    def print(self) -> None:
        for name, ok, detail in self.results:
            print("  %-14s %s  %s" % (name, "PASS" if ok else "FAIL", detail))


def gate_all(config_path: str, synthetic: bool) -> Tuple[Gates, Dict[str, Any]]:
    gates = Gates()
    state: Dict[str, Any] = {}

    def configuration() -> str:
        state["config"] = training_config.load(config_path)
        state["config_fingerprint"] = training_config.fingerprint(state["config"])
        return "fingerprint %s" % state["config_fingerprint"][:16]

    def governance() -> str:
        recorded = training_config.repository_governance()
        if recorded["localization_methodology_status"] != "PENDING" and \
                recorded["localization_methodology_status"] != "APPROVED":
            raise RuntimeError("localisation methodology status is unreadable: %r"
                               % recorded["localization_methodology_status"])
        return "localisation %s, bar %s (approval is checked by the authorisation gate)" % (
            recorded["localization_methodology_status"], recorded["performance_bar_status"])

    def manifest() -> str:
        expected = state["config"]["data"]["expected_split_fingerprint"]
        state["verified"] = mf.verified_manifest(
            expected, _resolve(state["config"]["data"]["split_manifest"]),
            _resolve(state["config"]["data"]["label_table"]))
        return "split %s verified, patient-disjoint" % expected

    def availability() -> str:
        with open(_paths.AVAILABILITY_INDEX, encoding="utf-8") as handle:
            index = json.load(handle)
        if index.get("splitFingerprint") != state["verified"]["manifest"]["fingerprint"]:
            raise RuntimeError("availability index was computed against a different split")
        state["available"] = index["availableSeries"]
        return "%d series with pixel data" % len(state["available"])

    def exclusions() -> str:
        path = _resolve(state["config"]["data"]["annotation_exclusions"])
        if not os.path.exists(path):
            raise RuntimeError("annotation exclusions missing: build with "
                               "scripts/lidc_build_annotation_exclusions.py")
        state["exclusions_path"] = path
        return os.path.relpath(path, _paths.ROOT).replace(os.sep, "/")

    def model() -> str:
        import torch

        from training import model as mdl

        net = mdl.build(state["config"])
        patch = int(state["config"]["patch"]["patch_px"])
        channels = int(state["config"]["patch"]["channels"])
        out = net.eval()(torch.zeros(2, channels, patch, patch))
        if tuple(out.shape) != (2,):
            raise RuntimeError("model output shape %s, expected (2,)" % (tuple(out.shape),))
        state["model"] = net
        return "%s, %d parameters, architecture %s — UNTRAINED" % (
            net.spec()["architecture"], mdl.parameter_count(net), mdl.architecture_fingerprint(net)[:16])

    def checkpointing() -> str:
        from training import model as mdl

        directory = tempfile.mkdtemp(prefix="healthai-ckpt-probe-")
        try:
            path = os.path.join(directory, "probe.pt")
            meta = dict((key, "probe") for key in ckpt.REQUIRED_METADATA)
            meta.update(seed=0, epoch=0)
            ckpt.save(path, model=state["model"], optimizer=None, scheduler=None,
                      status=ckpt.STATUS_TEST_ARTIFACT, metadata=meta)
            record = ckpt.load(path)
            return "write/reload verified, weights %s (probe, deleted)" % record["weights_fingerprint"][:16]
        finally:
            shutil.rmtree(directory, ignore_errors=True)

    def output() -> str:
        root = _resolve(state["config"]["output"]["artifact_root"])
        if synthetic:
            root = os.path.join(root, "test-artifacts")
        os.makedirs(root, exist_ok=True)
        probe = os.path.join(root, ".write-probe")
        with open(probe, "w") as handle:
            handle.write("ok")
        os.remove(probe)
        state["artifact_root"] = root
        return os.path.relpath(root, _paths.ROOT).replace(os.sep, "/")

    def environment() -> str:
        state["environment"] = env.probe()
        state["environment_fingerprint"] = env.environment_fingerprint(state["environment"])
        verdict = env.assess(state["environment"])
        state["environment_verdict"] = verdict
        if verdict["verdict"] != env.TRAINING_READY:
            raise RuntimeError("%s: %s" % (verdict["verdict"], " ".join(verdict["reasons"])))
        return env.TRAINING_READY

    if gates.run("configuration", configuration):
        gates.run("governance", governance)
        manifest_ok = gates.run("manifest", manifest)
        if manifest_ok:
            gates.run("availability", availability)
        gates.run("exclusions", exclusions)
        if gates.run("model", model):
            gates.run("checkpointing", checkpointing)
        gates.run("output", output)
    if not synthetic:
        gates.run("authorisation", authorisation.require_authorisation)
    gates.run("environment", environment)
    return gates, state


def preprocessing_fingerprint(config: Dict[str, Any]) -> str:
    _paths.ensure_inference_on_path()
    from detection_preprocess import PREPROCESSING_VERSION, PreprocessConfig

    pre = config["preprocessing"]
    service = PreprocessConfig(hu_min=float(pre["hu_min"]), hu_max=float(pre["hu_max"]),
                               normalise=bool(pre["normalise"]), resample_slice_spacing_mm=None,
                               channels=int(pre["channels"]))
    return "%s:%s" % (PREPROCESSING_VERSION, service.fingerprint())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=_paths.DEFAULT_CONFIG)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--synthetic", action="store_true",
                        help="harness test on synthetic data, CPU permitted, TEST_ARTIFACT outputs")
    parser.add_argument("--resume", default=None)
    parser.add_argument("--epochs", type=int, default=None,
                        help="synthetic runs only; real runs take epochs from the configuration")
    parser.add_argument("--stop-after-epochs", type=int, default=None,
                        help="pause after this many epochs in this session; resume later")
    args = parser.parse_args()
    if args.epochs is not None and not args.synthetic:
        parser.error("--epochs is only accepted with --synthetic; edit the configuration for a real run")

    print("Lung nodule candidate detector — %s"
          % ("dry run" if args.dry_run else "synthetic harness test" if args.synthetic else "training"))
    print("=" * 72)
    gates, state = gate_all(args.config, args.synthetic)
    gates.print()
    print()

    harness_failures = gates.failed(tuple(n for n, _, _ in gates.results
                                          if n not in ("environment", "authorisation")))
    environment_failed = bool(gates.failed(("environment",)))
    not_authorised = bool(gates.failed(("authorisation",)))

    if args.dry_run:
        if harness_failures:
            print("DRY RUN FAILED — HARNESS NOT READY (%s). TRAINING NOT EXECUTED." % ", ".join(harness_failures))
            return EXIT_HARNESS
        if not_authorised:
            print("DRY RUN FAILED — HARNESS READY, TRAINING NOT AUTHORISED. TRAINING NOT EXECUTED.")
            return EXIT_NOT_AUTHORISED
        if environment_failed:
            print("DRY RUN FAILED — HARNESS READY, ENVIRONMENT NOT AVAILABLE. TRAINING NOT EXECUTED.")
            return EXIT_ENVIRONMENT
        print("DRY RUN SUCCESS — TRAINING NOT EXECUTED")
        return EXIT_OK

    if harness_failures:
        print("TRAINING REFUSED — %s" % ", ".join(harness_failures))
        return EXIT_REFUSED
    if not_authorised and not args.synthetic:
        print("TRAINING REFUSED — not authorised: the methodology decisions in "
              "docs/P2_TRAINING_GATE_DECISION_REGISTER.md are not all approved.")
        return EXIT_REFUSED

    from training import trainer

    config = state["config"]
    if args.synthetic and args.epochs is not None:
        import copy

        config = copy.deepcopy(config)
        config["optimisation"]["epochs"] = int(args.epochs)
        state["config_fingerprint"] = training_config.fingerprint(config)
    if args.synthetic:
        train_set = ds.synthetic_sample_set(config, "train", mf.PURPOSE_FIT, count=64, seed=1)
        val_set = ds.synthetic_sample_set(config, "validation", mf.PURPOSE_SELECT, count=32, seed=2)
        dataset_fp = {"fingerprint": "synthetic-test-artifact", "parts": {"label": ds.SYNTHETIC_LABEL}}
        device = "cpu"
        print("SYNTHETIC — TEST ARTIFACT. Nothing produced by this run is a detector.")
    else:
        if environment_failed:
            print("TRAINING REFUSED — environment: %s" % " ".join(state["environment_verdict"]["reasons"]))
            return EXIT_REFUSED
        from training import series_loader as sl

        index = sl.cached_series_index(_resolve(config["data"]["dicom_root"]),
                                       os.path.join(state["artifact_root"], "cache", "series-index.json"))
        exclusions = sl.load_exclusions(state["exclusions_path"])
        cache = os.path.join(state["artifact_root"], "cache", "samples")
        common = dict(verified=state["verified"], available=state["available"], series_index=index,
                      exclusions=exclusions, cache_dir=cache)
        train_set = ds.build_lidc_sample_set(config, config["data"]["fit_split"], mf.PURPOSE_FIT, **common)
        val_set = ds.build_lidc_sample_set(config, config["data"]["select_split"], mf.PURPOSE_SELECT, **common)
        from training import sampling

        dataset_fp = mf.dataset_fingerprint(
            manifest_path=_resolve(config["data"]["split_manifest"]),
            labels_path=_resolve(config["data"]["label_table"]),
            exclusions_path=state["exclusions_path"],
            decision_path=_paths.DATASET_DECISION,
            preprocessing=config["preprocessing"],
            sampling=sampling.sampling_material(config, ds.context_side_for(config)),
            series_by_split={"train": train_set.report["seriesUids"],
                             "validation": val_set.report["seriesUids"]},
        )
        device = "cuda"
        for name, sample_set in (("train", train_set), ("validation", val_set)):
            report = dict(sample_set.report)
            report.pop("seriesUids", None)
            print("%-11s %d positives, %d negatives  %s" % (
                name, sample_set.positives, sample_set.negatives, json.dumps(report, sort_keys=True)))

    try:
        result = trainer.train(
            config=config, train_set=train_set, val_set=val_set, device=device,
            artifact_root=state["artifact_root"], dataset_fingerprint=dataset_fp,
            split_fingerprint=state["verified"]["manifest"]["fingerprint"],
            environment=state["environment"], environment_fingerprint=state["environment_fingerprint"],
            config_fingerprint=state["config_fingerprint"],
            preprocessing_fingerprint=preprocessing_fingerprint(config),
            stop_after_epochs=args.stop_after_epochs, resume_from=args.resume, log=print,
        )
    except trainer.TrainingRefused as exc:
        print("TRAINING REFUSED — %s" % "; ".join(exc.reasons))
        return EXIT_REFUSED

    record = result["experiment"]
    print()
    print("experiment  %s  %s" % (record["experiment_id"], record["status"]))
    print("checkpoint  %s — %s" % (result["best"], record["checkpoint"]["status"]))
    print("NOT VALIDATED. NOT REGISTERED. No evaluation, calibration or OOD assessment was performed.")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
