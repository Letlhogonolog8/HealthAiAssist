"""
The experiment manifest: exactly which data, code, configuration and machine
produced a checkpoint.

One manifest per run, at `artifacts/training/experiments/<id>/manifest.json`,
written at the start (status RUNNING), updated after every epoch, and closed
with the outcome. A run that crashes therefore still leaves a record of what
it was attempting, rather than an orphaned checkpoint nobody can explain.

── What it never contains ─────────────────────────────────────────────────

Patient identifiers, series or SOP UIDs, candidate coordinates, file paths
under dataset/, host names or user names. Series are represented by a hash of
the sorted list and a count; the lists themselves are reproducible from the
committed split and availability index. A test scans a written manifest for
anything shaped like a DICOM UID or an LIDC patient id.
"""
from __future__ import annotations

import datetime
import json
import os
import subprocess
from typing import Any, Dict, Optional

from training import HARNESS_VERSION, _paths
from training.fingerprint import sha256_json, short

STATUS_RUNNING = "RUNNING"
STATUS_COMPLETED = "COMPLETED"
STATUS_STOPPED_EARLY = "STOPPED_EARLY"
# Stopped deliberately before the configured epochs; resumable, not finished.
STATUS_PAUSED = "PAUSED"
STATUS_FAILED = "FAILED"


def git_state() -> Dict[str, Any]:
    """HEAD and whether the tree was clean. A dirty tree is recorded, not hidden."""
    def run(*args: str) -> Optional[str]:
        try:
            return subprocess.check_output(["git"] + list(args), cwd=_paths.ROOT,
                                           stderr=subprocess.DEVNULL).decode("utf-8").strip()
        except Exception:  # noqa: BLE001
            return None

    commit = run("rev-parse", "HEAD")
    porcelain = run("status", "--porcelain")
    return {"commit": commit, "dirty": bool(porcelain) if porcelain is not None else None}


def utc_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def experiment_id(config_fingerprint: str, dataset_fingerprint: str, started: str) -> str:
    stamp = started.replace(":", "").replace("-", "").replace("+0000", "Z").replace("+00:00", "Z")
    return "%s-%s" % (stamp, short(sha256_json([config_fingerprint, dataset_fingerprint]))[:8])


class ExperimentRecord(object):
    def __init__(self, directory: str, record: Dict[str, Any]):
        self.directory = directory
        self.record = record

    @property
    def path(self) -> str:
        return os.path.join(self.directory, "manifest.json")

    def write(self) -> None:
        os.makedirs(self.directory, exist_ok=True)
        temporary = self.path + ".partial"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(self.record, handle, indent=2, sort_keys=True)
        os.replace(temporary, self.path)

    def update(self, **fields: Any) -> None:
        self.record.update(fields)
        self.write()


def start(
    *,
    artifact_root: str,
    kind: str,
    config: Dict[str, Any],
    config_fingerprint: str,
    dataset: Dict[str, Any],
    split_fingerprint: str,
    model_spec: Dict[str, Any],
    model_fingerprint: str,
    preprocessing_fingerprint: str,
    augmentation: Dict[str, Any],
    environment: Dict[str, Any],
    environment_fingerprint: str,
    seed: int,
) -> ExperimentRecord:
    started = utc_now()
    identifier = experiment_id(config_fingerprint, dataset["fingerprint"], started)
    directory = os.path.join(artifact_root, "experiments", identifier)
    record = {
        "experiment_id": identifier,
        "harness_version": HARNESS_VERSION,
        "kind": kind,
        "status": STATUS_RUNNING,
        "started": started,
        "finished": None,
        "git": git_state(),
        "dataset_fingerprint": dataset["fingerprint"],
        "dataset": dataset["parts"],
        "split_fingerprint": split_fingerprint,
        "label_version": config["data"]["label_version"],
        "model_version": model_spec["version"],
        "model_spec": model_spec,
        "model_fingerprint": model_fingerprint,
        "preprocessing_version": config["preprocessing"]["version"],
        "preprocessing_fingerprint": preprocessing_fingerprint,
        "augmentation_version": augmentation.get("version"),
        "augmentation": augmentation,
        "training_config": config,
        "training_config_fingerprint": config_fingerprint,
        "seed": seed,
        "hardware": {
            "gpus": environment["torch"]["gpus"],
            "cudaVersion": environment["torch"]["cudaVersion"],
            "cpuCount": environment["cpuCount"],
            "systemMemoryGb": environment["systemMemoryGb"],
        },
        "environment": {"python": environment["python"], "packages": environment["packages"]},
        "environment_fingerprint": environment_fingerprint,
        "governance": {
            "localization_methodology_status": config["governance"]["localization_methodology_status"],
            "performance_bar_status": config["governance"]["performance_bar_status"],
            "checkpoint_status_on_completion": (
                "TEST_ARTIFACT" if kind == "synthetic" else "TRAINED_UNVALIDATED"
            ),
            "note": "A completed run produces an unvalidated checkpoint. No evaluation, "
                    "calibration or OOD assessment is performed by the training harness.",
        },
        "epochs": [],
        "checkpoint": None,
        "outcome": None,
    }
    experiment = ExperimentRecord(directory, record)
    experiment.write()
    return experiment
