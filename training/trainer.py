"""
The training loop: seeded, resumable, early-stopping, and refusing.

── What it refuses ────────────────────────────────────────────────────────

  - a training set that is not the train split, read for fitting;
  - a validation set that is not the validation split, read for selection;
  - mixing synthetic and LIDC data in one run;
  - LIDC data on anything but a CUDA device. There is no automatic fallback to
    CPU for the real detector, and no flag that enables one. Synthetic data may
    run on CPU because the test suite has to exercise the loop somewhere.

── What it records ────────────────────────────────────────────────────────

Per epoch: training loss, validation loss, learning rate and wall time, into
the experiment manifest. Per checkpoint: every fingerprint listed in
`training/checkpoint.REQUIRED_METADATA`. Nothing identifying: no UIDs, no
patient ids, no coordinates, no file paths under dataset/.

── Model selection ────────────────────────────────────────────────────────

By validation loss — unweighted binary cross-entropy on unaugmented validation
patches — and nothing else. Patch-level classification numbers are not
detection metrics; sensitivity, false positives per scan and FROC need a
localisation methodology that is still PENDING, and this loop computes none of
them.

── Determinism ────────────────────────────────────────────────────────────

Python, NumPy and torch are seeded, deterministic algorithms are requested,
cuDNN autotuning is disabled, and each epoch's shuffle uses a generator
re-seeded from (seed, epoch) so that a resumed run draws the same batches as
an uninterrupted one. On CPU this reproduces bit for bit, which the tests
check. On GPU, some CUDA kernels have no deterministic implementation and
`torch.use_deterministic_algorithms` will raise rather than run one
nondeterministically; run-to-run agreement on GPU is expected to be close, not
guaranteed identical, and docs/P2_TRAINING_READINESS.md says so.
"""
from __future__ import annotations

import math
import os
import random
import time
from typing import Any, Callable, Dict, List, Optional

import numpy as np

from training import augment as aug
from training import checkpoint as ckpt
from training import dataset as ds
from training import experiment as xp
from training import manifest as mf
from training import model as mdl
from training.config import fingerprint as training_config_fingerprint


class TrainingRefused(Exception):
    def __init__(self, reasons: List[str]):
        super().__init__("; ".join(reasons))
        self.reasons = reasons


def seed_everything(seed: int, deterministic: bool) -> None:
    import torch

    random.seed(seed)
    np.random.seed(seed % (2 ** 32))
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    if deterministic:
        os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
        torch.use_deterministic_algorithms(True)
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False


def check_run(train_set: ds.SampleSet, val_set: ds.SampleSet, device: str) -> None:
    reasons: List[str] = []
    try:
        mf.require_split(train_set.split, mf.PURPOSE_FIT)
    except mf.SplitAccessDenied as exc:
        reasons.append("training set: %s" % exc)
    try:
        mf.require_split(val_set.split, mf.PURPOSE_SELECT)
    except mf.SplitAccessDenied as exc:
        reasons.append("validation set: %s" % exc)
    if train_set.kind != val_set.kind:
        reasons.append("training and validation sets are of different kinds (%s, %s)"
                       % (train_set.kind, val_set.kind))
    if train_set.kind == ds.KIND_LIDC and not str(device).startswith("cuda"):
        reasons.append(
            "LIDC training requires a CUDA device; got %r. The detector is not trained on CPU "
            "and there is no fallback." % device
        )
    if len(train_set) == 0 or train_set.positives == 0 or train_set.negatives == 0:
        reasons.append("the training set needs both positives and negatives (have %d/%d)"
                       % (train_set.positives, train_set.negatives))
    if len(val_set) == 0:
        reasons.append("the validation set is empty")
    if reasons:
        raise TrainingRefused(reasons)


def _optimizer(model: Any, section: Dict[str, Any]) -> Any:
    import torch

    if section["optimizer"] == "adamw":
        return torch.optim.AdamW(model.parameters(), lr=float(section["learning_rate"]),
                                 weight_decay=float(section["weight_decay"]))
    return torch.optim.SGD(model.parameters(), lr=float(section["learning_rate"]), momentum=0.9,
                           weight_decay=float(section["weight_decay"]))


def _scheduler(optimizer: Any, section: Dict[str, Any], epochs: int) -> Any:
    import torch

    if section["scheduler"] == "cosine":
        return torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, epochs))
    if section["scheduler"] == "step":
        return torch.optim.lr_scheduler.StepLR(optimizer, step_size=max(1, epochs // 3), gamma=0.1)
    return None


def _loader(dataset: ds.PatchDataset, labels: np.ndarray, section: Dict[str, Any],
            balancing: str, seed: int, epoch: int, shuffle: bool) -> Any:
    import torch
    from torch.utils.data import DataLoader, RandomSampler, SequentialSampler, WeightedRandomSampler

    generator = torch.Generator()
    generator.manual_seed(int(seed) * 1000 + int(epoch))
    if shuffle and balancing == "weighted_sampler":
        counts = np.bincount(labels.astype(np.int64), minlength=2).astype(np.float64)
        weights = np.where(labels == 1, 1.0 / max(counts[1], 1), 1.0 / max(counts[0], 1))
        sampler = WeightedRandomSampler(torch.as_tensor(weights, dtype=torch.double),
                                        num_samples=len(labels), replacement=True, generator=generator)
    elif shuffle:
        sampler = RandomSampler(dataset, generator=generator)
    else:
        sampler = SequentialSampler(dataset)
    return DataLoader(dataset, batch_size=int(section["batch_size"]), sampler=sampler,
                      num_workers=int(section.get("num_workers", 0)), drop_last=False)


def train(
    *,
    config: Dict[str, Any],
    train_set: ds.SampleSet,
    val_set: ds.SampleSet,
    device: str,
    artifact_root: str,
    dataset_fingerprint: Dict[str, Any],
    split_fingerprint: str,
    environment: Dict[str, Any],
    environment_fingerprint: str,
    config_fingerprint: str,
    preprocessing_fingerprint: str,
    stop_after_epochs: Optional[int] = None,
    resume_from: Optional[str] = None,
    log: Callable[[str], None] = lambda message: None,
) -> Dict[str, Any]:
    import torch

    check_run(train_set, val_set, device)
    section = config["optimisation"]
    seed = int(section["seed"])
    seed_everything(seed, bool(section.get("deterministic", True)))

    # The schedule length comes from the configuration and nowhere else, so the
    # configuration fingerprint in every checkpoint describes the run that was
    # actually made. `stop_after_epochs` pauses a run without changing that
    # schedule — for time-boxed sessions on rented hardware — and a later
    # resume continues exactly where it stopped.
    if config_fingerprint != training_config_fingerprint(config):
        raise TrainingRefused(["the configuration fingerprint passed in does not match the "
                               "configuration: the run would record a config it did not use"])
    total_epochs = int(section["epochs"])
    patch_px = int(config["patch"]["patch_px"])
    augment_config = aug.AugmentConfig.from_config(config["augmentation"], config["preprocessing"])

    train_ds = ds.TrainingDataset(train_set.split, train_set, patch_px=patch_px,
                                  augment_config=augment_config)
    val_ds = ds.PatchDataset(val_set, mf.PURPOSE_SELECT, patch_px=patch_px, augment_config=None)

    model = mdl.build(config).to(device)
    optimizer = _optimizer(model, section)
    scheduler = _scheduler(optimizer, section, total_epochs)
    architecture_fp = mdl.architecture_fingerprint(model)

    balancing = config["balancing"]["method"]
    pos_weight = None
    if balancing == "pos_weight":
        pos_weight = torch.tensor([train_set.negatives / float(max(train_set.positives, 1))],
                                  device=device)
    fit_loss = torch.nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    select_loss = torch.nn.BCEWithLogitsLoss(reduction="sum")

    kind = train_set.kind
    status = ckpt.STATUS_TEST_ARTIFACT if kind == ds.KIND_SYNTHETIC else ckpt.STATUS_TRAINED_UNVALIDATED

    start_epoch, best_val, stale = 0, math.inf, 0
    experiment = None
    if resume_from:
        record = ckpt.load(resume_from)
        meta = record["metadata"]
        for key, expected in (("dataset_fingerprint", dataset_fingerprint["fingerprint"]),
                              ("training_config_fingerprint", config_fingerprint),
                              ("model_fingerprint", architecture_fp)):
            if meta.get(key) != expected:
                raise TrainingRefused(["cannot resume: %s differs from the checkpoint's" % key])
        model.load_state_dict(record["model_state"])
        optimizer.load_state_dict(record["optimizer_state"])
        if scheduler is not None and record["scheduler_state"] is not None:
            scheduler.load_state_dict(record["scheduler_state"])
        ckpt.restore_rng_state(record["rng_state"])
        start_epoch = int(meta["epoch"]) + 1
        best_val = float(meta.get("best_validation_loss", math.inf))
        stale = int(meta.get("epochs_without_improvement", 0))
        directory = os.path.dirname(os.path.dirname(resume_from))
        experiment = xp.ExperimentRecord(directory, _read_json(os.path.join(directory, "manifest.json")))
        experiment.update(status=xp.STATUS_RUNNING, resumed_at_epoch=start_epoch)
    else:
        experiment = xp.start(
            artifact_root=artifact_root, kind=kind, config=config, config_fingerprint=config_fingerprint,
            dataset=dataset_fingerprint, split_fingerprint=split_fingerprint, model_spec=model.spec(),
            model_fingerprint=architecture_fp, preprocessing_fingerprint=preprocessing_fingerprint,
            augmentation=aug.fingerprint_material(augment_config), environment=environment,
            environment_fingerprint=environment_fingerprint, seed=seed,
        )

    checkpoint_dir = os.path.join(experiment.directory, "checkpoints")
    git = experiment.record["git"]

    def metadata(epoch: int) -> Dict[str, Any]:
        return {
            "git_commit": git.get("commit") or "UNAVAILABLE",
            "git_dirty": git.get("dirty"),
            "dataset_fingerprint": dataset_fingerprint["fingerprint"],
            "split_fingerprint": split_fingerprint,
            "model_fingerprint": architecture_fp,
            "preprocessing_fingerprint": preprocessing_fingerprint,
            "training_config_fingerprint": config_fingerprint,
            "environment_fingerprint": environment_fingerprint,
            "seed": seed,
            "epoch": epoch,
            "experiment_id": experiment.record["experiment_id"],
            "best_validation_loss": best_val,
            "epochs_without_improvement": stale,
            "kind": kind,
            "label": ds.SYNTHETIC_LABEL if kind == ds.KIND_SYNTHETIC else "LIDC-IDRI research data",
        }

    outcome = xp.STATUS_COMPLETED
    best_sidecar = None
    last_sidecar = None
    try:
        for epoch in range(start_epoch, total_epochs):
            began = time.time()
            train_ds.set_epoch(epoch)
            model.train()
            running, seen = 0.0, 0
            for patches, labels in _loader(train_ds, train_set.labels, section, balancing, seed, epoch, True):
                patches, labels = patches.to(device), labels.to(device)
                optimizer.zero_grad()
                loss = fit_loss(model(patches), labels)
                loss.backward()
                optimizer.step()
                running += float(loss.item()) * labels.shape[0]
                seen += labels.shape[0]
            if scheduler is not None:
                scheduler.step()

            model.eval()
            total, count = 0.0, 0
            with torch.no_grad():
                for patches, labels in _loader(val_ds, val_set.labels, section, "none", seed, epoch, False):
                    patches, labels = patches.to(device), labels.to(device)
                    total += float(select_loss(model(patches), labels).item())
                    count += labels.shape[0]
            val_loss = total / max(count, 1)
            train_loss = running / max(seen, 1)

            improved = val_loss < best_val
            if improved:
                best_val, stale = val_loss, 0
            else:
                stale += 1

            last_sidecar = ckpt.save(os.path.join(checkpoint_dir, "last.pt"), model=model,
                                     optimizer=optimizer, scheduler=scheduler, status=status,
                                     metadata=metadata(epoch))
            if improved:
                best_sidecar = ckpt.save(os.path.join(checkpoint_dir, "best.pt"), model=model,
                                         optimizer=optimizer, scheduler=scheduler, status=status,
                                         metadata=metadata(epoch))

            entry = {
                "epoch": epoch,
                "trainLoss": round(train_loss, 6),
                "validationLoss": round(val_loss, 6),
                "learningRate": optimizer.param_groups[0]["lr"],
                "seconds": round(time.time() - began, 2),
                "improved": improved,
            }
            experiment.record["epochs"].append(entry)
            experiment.write()
            log("epoch %d  train %.4f  validation %.4f%s"
                % (epoch, train_loss, val_loss, "  (best)" if improved else ""))

            if stale >= int(section["early_stopping_patience"]):
                outcome = xp.STATUS_STOPPED_EARLY
                break
            ran_this_session = epoch + 1 - start_epoch
            if (stop_after_epochs is not None and ran_this_session >= stop_after_epochs
                    and epoch + 1 < total_epochs):
                outcome = xp.STATUS_PAUSED
                break
    except Exception:
        experiment.update(status=xp.STATUS_FAILED, finished=xp.utc_now())
        raise

    if best_sidecar is None:
        best_sidecar = ckpt.verify_sidecar(os.path.join(checkpoint_dir, "best.pt"))
    experiment.update(
        status=outcome,
        finished=xp.utc_now(),
        checkpoint={
            "status": status,
            "best": best_sidecar,
            "last": last_sidecar,
            "note": "Unvalidated. Not registered. The service's detector slot is unchanged.",
        },
        outcome={"bestValidationLoss": best_val, "epochsRun": len(experiment.record["epochs"])},
    )
    return {
        "experiment": experiment.record,
        "directory": experiment.directory,
        "best": os.path.join(checkpoint_dir, "best.pt"),
        "last": os.path.join(checkpoint_dir, "last.pt"),
        "model": model,
    }


def _read_json(path: str) -> Dict[str, Any]:
    import json

    with open(path, encoding="utf-8") as handle:
        return json.load(handle)
