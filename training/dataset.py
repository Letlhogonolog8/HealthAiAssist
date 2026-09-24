"""
Sample sets per split, and the torch Dataset that serves them.

── Where the test split is stopped ────────────────────────────────────────

Three gates, deliberately redundant:

  1. `SampleSet` records the split it was built from, and building one calls
     `manifest.require_split(split, purpose)` before any row is read.
  2. `PatchDataset` calls `require_split` again with the purpose it is being
     constructed for — so a sample set built legitimately for evaluation still
     cannot be handed to a training loader.
  3. The trainer refuses any dataset whose purpose is not fit or select.

`TrainingDataset(split="test")` therefore raises at construction. It does not
warn and continue, and there is no flag that turns the check off.

── Where the samples come from ────────────────────────────────────────────

`build_lidc_sample_set` walks the series of one split that have pixel data on
this machine, loads each through `series_loader`, samples it, and caches the
result under the gitignored artifact tree keyed by the dataset material, so a
second run with the same definition does not repeat 30 seconds of mask
construction per series. A refused series is counted by its reason code and
left out; nothing is substituted and no patient moves.

`synthetic_sample_set` builds a tiny CT-like set in memory for tests. It is
labelled SYNTHETIC — TEST ARTIFACT everywhere it appears and can never be
mistaken for LIDC data: the trainer refuses to mix the two.
"""
from __future__ import annotations

import collections
import hashlib
import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np

from training import _paths
from training import augment as aug
from training import manifest as mf
from training.fingerprint import sha256_json

KIND_LIDC = "lidc"
KIND_SYNTHETIC = "synthetic"
SYNTHETIC_LABEL = "SYNTHETIC — TEST ARTIFACT"


@dataclass
class SampleSet:
    split: str
    purpose: str
    kind: str
    contexts: np.ndarray          # (N, C, S, S) float16
    labels: np.ndarray            # (N,) int8
    target_rc: np.ndarray         # (N, 2) float32
    series_ordinal: np.ndarray    # (N,) int32 — opaque, never a UID
    report: Dict[str, Any] = field(default_factory=dict)

    def __len__(self) -> int:
        return int(self.labels.shape[0])

    @property
    def positives(self) -> int:
        return int((self.labels == 1).sum())

    @property
    def negatives(self) -> int:
        return int((self.labels == 0).sum())


def mask_version() -> str:
    """The service's lung-mask version, so a mask change invalidates the sample cache."""
    _paths.ensure_inference_on_path()
    from lung_mask import MASK_VERSION

    return MASK_VERSION


def context_side_for(config: Dict[str, Any]) -> int:
    patch_px = int(config["patch"]["patch_px"])
    margin = aug.context_margin(patch_px, int(config["augmentation"]["max_shift_px"]))
    return patch_px + 2 * margin


# ── the torch view ─────────────────────────────────────────────────────────

class PatchDataset(object):
    """Serves (patch, label). Augments only when fitting."""

    def __init__(self, sample_set: SampleSet, purpose: str, patch_px: int,
                 augment_config: Optional[aug.AugmentConfig]):
        mf.require_split(sample_set.split, purpose)
        if purpose not in (mf.PURPOSE_FIT, mf.PURPOSE_SELECT):
            raise mf.SplitAccessDenied(
                "a PatchDataset serves training and model selection only, not %r" % purpose
            )
        self.samples = sample_set
        self.purpose = purpose
        self.patch_px = patch_px
        # Validation is never augmented: model selection compares like with like.
        self.augment_config = augment_config if purpose == mf.PURPOSE_FIT else None
        self.epoch = 0

    def set_epoch(self, epoch: int) -> None:
        self.epoch = int(epoch)

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        import torch

        context = self.samples.contexts[index].astype(np.float32)
        target = tuple(float(v) for v in self.samples.target_rc[index])
        if self.augment_config is not None and self.augment_config.enabled:
            patch, _moved, _params = aug.apply(
                context, target, self.patch_px, self.augment_config, self.epoch, index
            )
        else:
            patch = aug.centre_crop(context, self.patch_px).astype(np.float32)
        label = float(self.samples.labels[index])
        return torch.from_numpy(np.ascontiguousarray(patch)), torch.tensor(label, dtype=torch.float32)


def TrainingDataset(split: str, sample_set: Optional[SampleSet] = None, **kwargs: Any) -> PatchDataset:
    """The training loader's dataset. Refuses anything but the train split.

    Checked on the split name before anything else, so a request for the test
    split fails without a sample set ever existing.
    """
    mf.require_split(split, mf.PURPOSE_FIT)
    if sample_set is None:
        raise ValueError("a sample set is required")
    if sample_set.split != split:
        raise mf.SplitAccessDenied(
            "sample set is from %r, not %r" % (sample_set.split, split)
        )
    return PatchDataset(sample_set, mf.PURPOSE_FIT, **kwargs)


# ── LIDC ───────────────────────────────────────────────────────────────────

def series_for_split(assignment: Dict[str, str], rows: List[Dict[str, str]], available: List[str],
                     split: str, purpose: str) -> List[str]:
    """Source series of one split that have pixel data here, sorted."""
    split_rows = mf.rows_for_split(rows, assignment, split, purpose)
    present = set(available)
    return sorted({r["series_uid"] for r in split_rows if r["series_uid"] in present})


def _cache_key(material: Dict[str, Any], series_uid: str) -> str:
    return hashlib.sha256((sha256_json(material) + "|" + series_uid).encode("utf-8")).hexdigest()[:32]


def build_lidc_sample_set(
    config: Dict[str, Any],
    split: str,
    purpose: str,
    *,
    verified: Dict[str, Any],
    available: List[str],
    series_index: Dict[str, str],
    exclusions: Dict[str, List[Dict[str, str]]],
    cache_dir: Optional[str] = None,
    limit: Optional[int] = None,
    progress: Any = None,
) -> SampleSet:
    from training import sampling
    from training import series_loader as sl

    mf.require_split(split, purpose)
    assignment = verified["manifest"]["assignment"]
    rows = verified["rows"]
    series = series_for_split(assignment, rows, available, split, purpose)
    if limit is not None:
        series = series[:limit]

    side = context_side_for(config)
    material = {
        "preprocessing": config["preprocessing"],
        "sampling": sampling.sampling_material(config, side),
        "mask": mask_version(),
    }
    by_series = collections.defaultdict(list)
    for row in rows:
        by_series[row["series_uid"]].append(row)

    contexts, labels, targets, ordinals = [], [], [], []
    refused = collections.Counter()
    totals = collections.Counter()
    for ordinal, uid in enumerate(series):
        cache_path = os.path.join(cache_dir, _cache_key(material, uid) + ".npz") if cache_dir else None
        if cache_path and os.path.exists(cache_path):
            cached = np.load(cache_path)
            result = sampling.SeriesSamples(cached["contexts"], cached["labels"], cached["target_rc"],
                                            json.loads(str(cached["stats"])), cached["centres"])
        else:
            directory = series_index.get(uid)
            if directory is None:
                refused["not_on_disk"] += 1
                continue
            try:
                loaded = sl.load_series(uid, directory, by_series[uid], exclusions.get(uid, []), ordinal)
            except sl.SeriesUnavailable as exc:
                refused[exc.code] += 1
                continue
            result = sampling.sample_series(loaded, uid, config, side)
            result.stats["unresolvedLabels"] = len(loaded.unresolved_labels)
            result.stats["unresolvedExclusions"] = loaded.unresolved_exclusions
            if cache_path:
                os.makedirs(cache_dir, exist_ok=True)
                np.savez(cache_path, contexts=result.contexts, labels=result.labels,
                         target_rc=result.target_rc, stats=json.dumps(result.stats),
                         centres=result.centres)
        for key, value in result.stats.items():
            totals[key] += int(value)
        contexts.append(result.contexts)
        labels.append(result.labels)
        targets.append(result.target_rc)
        ordinals.append(np.full(result.labels.shape[0], ordinal, dtype=np.int32))
        if progress:
            progress(ordinal + 1, len(series))

    channels = int(config["patch"]["channels"])
    return SampleSet(
        split=split,
        purpose=purpose,
        kind=KIND_LIDC,
        contexts=np.concatenate(contexts) if contexts else np.zeros((0, channels, side, side), np.float16),
        labels=np.concatenate(labels) if labels else np.zeros((0,), np.int8),
        target_rc=np.concatenate(targets) if targets else np.zeros((0, 2), np.float32),
        series_ordinal=np.concatenate(ordinals) if ordinals else np.zeros((0,), np.int32),
        report={
            "seriesInSplitWithPixelData": len(series),
            "seriesUsed": len(series) - sum(refused.values()),
            "seriesRefusedByReason": dict(refused),
            "sampling": dict(totals),
            "seriesUids": series,        # kept in memory for the fingerprint only; never logged
        },
    )


# ── synthetic, for tests ───────────────────────────────────────────────────

def synthetic_sample_set(config: Dict[str, Any], split: str, purpose: str,
                         count: int = 64, seed: int = 0) -> SampleSet:
    """A tiny CT-like set: bright blobs on a noisy lung-like background.

    Positives carry a Gaussian blob at the centre; negatives do not. It is a
    TEST ARTIFACT — it exists so the harness can be exercised without patient
    data, and nothing trained on it means anything.
    """
    mf.require_split(split, purpose)
    side = context_side_for(config)
    channels = int(config["patch"]["channels"])
    rng = np.random.default_rng(seed)
    grid = np.arange(side, dtype=np.float32) - side / 2.0
    radius2 = grid[:, None] ** 2 + grid[None, :] ** 2
    blob = np.exp(-radius2 / (2 * 3.0 ** 2)).astype(np.float32)

    contexts = np.empty((count, channels, side, side), dtype=np.float16)
    labels = np.empty((count,), dtype=np.int8)
    for n in range(count):
        base = 0.1 + 0.05 * rng.standard_normal((channels, side, side)).astype(np.float32)
        positive = n % 2 == 0
        if positive:
            base = base + 0.6 * blob[None, :, :]
        contexts[n] = np.clip(base, 0, 1).astype(np.float16)
        labels[n] = 1 if positive else 0
    return SampleSet(
        split=split, purpose=purpose, kind=KIND_SYNTHETIC,
        contexts=contexts, labels=labels,
        target_rc=np.full((count, 2), side / 2.0, dtype=np.float32),
        series_ordinal=np.zeros((count,), dtype=np.int32),
        report={"label": SYNTHETIC_LABEL, "count": count, "seed": seed},
    )
