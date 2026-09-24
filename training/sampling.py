"""
Positive and negative training samples from one loaded series.

── What a positive is ─────────────────────────────────────────────────────

A patch centred on a labelled nodule from `dataset/lidc-labels.csv` — a
location where LIDC readers marked a nodule of at least 3 mm whose median
rating was not indeterminate. The malignancy label in that table is ignored
entirely: benign-rated and malignant-rated nodules are both positives, because
the detector's question is "was something marked here", not "is it cancer".

── What a negative is ─────────────────────────────────────────────────────

A patch centred on a lung-mask voxel at least `negative_exclusion_radius_mm`
from every location any reader marked — rated, indeterminate and sub-3 mm
nodules and non-nodules alike (`scripts/lidc_build_annotation_exclusions.py`).
The places between those two definitions — indeterminate and small nodules —
are an ignore zone: never positive, never negative.

The exclusion radius is a sampling parameter. It is not a localisation
tolerance, it says nothing about how a detection would be matched to a
nodule in evaluation, and it is recorded as an initial engineering default.

── Determinism ────────────────────────────────────────────────────────────

Each series' negatives come from a generator seeded by the sampling seed and
the series' own identifier, hashed. The same series yields the same negatives
whichever order series are loaded in and whatever else is in the split — the
same stability property the split itself has.

── Same patch as the service ──────────────────────────────────────────────

Context windows are cut with `inference/detection_service._extract_patch`,
the function the service uses to cut the patches it scores. A training patch
and a serving patch at the same location are the same array.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Dict, List

import numpy as np

from training import _paths

_paths.ensure_inference_on_path()

from detection_preprocess import PreprocessConfig, to_hu_window  # noqa: E402
from detection_service import DetectionConfig, _extract_patch  # noqa: E402

SAMPLING_VERSION = "detect-sampling-v1"


@dataclass
class SeriesSamples:
    contexts: np.ndarray        # (N, C, S, S) float16, normalised
    labels: np.ndarray          # (N,) int8 — 1 marked location, 0 background
    target_rc: np.ndarray       # (N, 2) float32 — target in context coordinates
    stats: Dict[str, int] = field(default_factory=dict)
    # (N, 3) voxel (k, j, i) each sample is centred on. Kept in memory and in
    # the gitignored cache for verification; never logged or put in a manifest.
    centres: np.ndarray = field(default_factory=lambda: np.zeros((0, 3), dtype=np.float32))


def series_rng(seed: int, series_key: str) -> np.random.Generator:
    digest = hashlib.sha256(("%d|%s" % (seed, series_key)).encode("utf-8")).digest()
    return np.random.default_rng(int.from_bytes(digest[:8], "big"))


def prepare(volume: Any, preprocessing: Dict[str, Any]) -> np.ndarray:
    """HU to model input through the service's own transform."""
    config = PreprocessConfig(
        hu_min=float(preprocessing["hu_min"]),
        hu_max=float(preprocessing["hu_max"]),
        normalise=bool(preprocessing["normalise"]),
        resample_slice_spacing_mm=None,
        channels=int(preprocessing["channels"]),
    )
    return to_hu_window(volume.array, config)


def cut_context(prepared: np.ndarray, k: int, j: int, i: int, side: int, channels: int) -> np.ndarray:
    return _extract_patch(prepared, k, j, i, DetectionConfig(patch_px=side, channels=channels))


def sample_series(
    loaded: Any,
    series_key: str,
    config: Dict[str, Any],
    context_side: int,
) -> SeriesSamples:
    """All samples for one series. `loaded` is a series_loader.LoadedSeries."""
    sampling = config["sampling"]
    channels = int(config["patch"]["channels"])
    prepared = prepare(loaded.volume, config["preprocessing"])
    half = context_side // 2

    contexts: List[np.ndarray] = []
    centres: List[List[float]] = []
    labels: List[int] = []
    targets: List[List[float]] = []
    stats = {"positives": 0, "negatives": 0, "targetsOutsideLungMask": 0,
             "negativeAttempts": 0, "negativeRejectedNearMark": 0, "negativeShortfall": 0}

    # ── positives ──────────────────────────────────────────────────────────
    for target in loaded.targets:
        if not loaded.lung_mask.contains(target.i, target.j, target.k):
            # Kept, and counted: the label is the evidence, not the mask. The
            # count is reported because a target outside the search constraint
            # is one the service would never score.
            stats["targetsOutsideLungMask"] += 1
        ir, jr = int(round(target.i)), int(round(target.j))
        for _ in range(int(sampling["positives_per_target"])):
            contexts.append(cut_context(prepared, target.k, jr, ir, context_side, channels))
            labels.append(1)
            targets.append([half + (target.j - jr), half + (target.i - ir)])
            centres.append([float(target.k), float(jr), float(ir)])
            stats["positives"] += 1

    # ── negatives ──────────────────────────────────────────────────────────
    wanted = int(sampling["negatives_per_series"])
    radius = float(sampling["negative_exclusion_radius_mm"])
    budget = int(sampling["max_negative_attempts_per_series"])
    mask = loaded.lung_mask.mask
    candidates = np.flatnonzero(mask)
    exclusions = np.asarray(loaded.exclusion_points_mm, dtype=np.float64).reshape(-1, 3)
    rng = series_rng(int(sampling["seed"]), series_key)

    made = 0
    if candidates.size and wanted:
        while made < wanted and stats["negativeAttempts"] < budget:
            stats["negativeAttempts"] += 1
            flat = int(candidates[int(rng.integers(0, candidates.size))])
            k, j, i = np.unravel_index(flat, mask.shape)
            point = np.asarray(loaded.volume.voxel_to_patient(float(i), float(j), int(k)))
            if exclusions.size:
                nearest = float(np.sqrt(((exclusions - point) ** 2).sum(axis=1)).min())
                if nearest < radius:
                    stats["negativeRejectedNearMark"] += 1
                    continue
            contexts.append(cut_context(prepared, int(k), int(j), int(i), context_side, channels))
            labels.append(0)
            targets.append([float(half), float(half)])
            centres.append([float(k), float(j), float(i)])
            made += 1
    stats["negatives"] = made
    stats["negativeShortfall"] = wanted - made

    if contexts:
        stacked = np.stack(contexts).astype(np.float16)
    else:
        stacked = np.zeros((0, channels, context_side, context_side), dtype=np.float16)
    return SeriesSamples(
        contexts=stacked,
        labels=np.asarray(labels, dtype=np.int8),
        target_rc=np.asarray(targets, dtype=np.float32).reshape(-1, 2),
        stats=stats,
        centres=np.asarray(centres, dtype=np.float32).reshape(-1, 3),
    )


def sampling_material(config: Dict[str, Any], context_side: int) -> Dict[str, Any]:
    sampling = config["sampling"]
    return {
        "version": SAMPLING_VERSION,
        "seed": int(sampling["seed"]),
        "positivesPerTarget": int(sampling["positives_per_target"]),
        "negativesPerSeries": int(sampling["negatives_per_series"]),
        "negativeExclusionRadiusMm": float(sampling["negative_exclusion_radius_mm"]),
        "negativesWithinLungMask": bool(sampling["negatives_within_lung_mask"]),
        "maxNegativeAttemptsPerSeries": int(sampling["max_negative_attempts_per_series"]),
        "contextSidePx": int(context_side),
        "positiveCentreJitterPx": int(config["target"]["positive_centre_jitter_px"]),
        "ignoreZone": "indeterminate (median 3), sub-3 mm and non-nodule marks: never positive, never negative",
    }
