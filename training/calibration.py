"""
Detector score calibration: the infrastructure, not a calibration.

── Status: NOT PERFORMED ──────────────────────────────────────────────────

There is no trained detector, so there is nothing to calibrate, and nothing
here has been run on real data. The nodule characteriser's calibration
(`dataset/lung_nodule_model/lung_nodule_model_calibration.json`) belongs to a
different model answering a different question and is never reused.

── What is ready ──────────────────────────────────────────────────────────

Temperature scaling — the method `scripts/calibrate-model.py` already uses for
the characteriser — fitted on the calibration split and only the calibration
split. `fit_temperature` calls `require_split(split, "calibrate")` before it
looks at a single logit, so validation or test data cannot be used to fit it.

── Raw is not calibrated ──────────────────────────────────────────────────

`calibrated_score` returns None when no calibration record exists. It never
returns the raw score under the calibrated name: `score_calibrated` is NULL in
every candidate the service has persisted, and it stays NULL until a
calibration fitted on the calibration split says otherwise.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Optional, Sequence

import numpy as np

from training import manifest as mf
from training.fingerprint import sha256_json

CALIBRATION_METHOD = "temperature_scaling"
CALIBRATION_VERSION = "detect-calibration-v1"
CALIBRATION_STATUS = "NOT PERFORMED — no trained detector checkpoint"


class CalibrationRefused(Exception):
    pass


@dataclass(frozen=True)
class CalibrationRecord:
    method: str
    version: str
    temperature: float
    fitted_on_split: str
    checkpoint_weights_sha256: str
    samples: int

    @property
    def fingerprint(self) -> str:
        return sha256_json(asdict(self))


def _nll(logits: np.ndarray, labels: np.ndarray, temperature: float) -> float:
    scaled = logits / temperature
    # log(1 + exp(-|x|)) form, stable for large magnitudes.
    log_p = -np.logaddexp(0.0, -scaled)
    log_not_p = -np.logaddexp(0.0, scaled)
    return float(-(labels * log_p + (1 - labels) * log_not_p).mean())


def fit_temperature(
    logits: Sequence[float],
    labels: Sequence[int],
    *,
    split: str,
    checkpoint_weights_sha256: str,
) -> CalibrationRecord:
    """Fit T on the calibration split. Refuses any other split."""
    mf.require_split(split, mf.PURPOSE_CALIBRATE)
    if not checkpoint_weights_sha256:
        raise CalibrationRefused("a calibration must name the checkpoint it calibrates")
    x = np.asarray(logits, dtype=np.float64)
    y = np.asarray(labels, dtype=np.float64)
    if x.shape != y.shape or x.size == 0:
        raise CalibrationRefused("logits and labels must be non-empty and the same length")
    if not ((y == 0) | (y == 1)).all():
        raise CalibrationRefused("labels must be 0 or 1")
    if y.min() == y.max():
        raise CalibrationRefused("the calibration set needs both classes")

    # Golden-section search on log T: NLL is unimodal in T for fixed logits.
    low, high = math.log(0.05), math.log(20.0)
    ratio = (math.sqrt(5.0) - 1.0) / 2.0
    a, b = high - ratio * (high - low), low + ratio * (high - low)
    for _ in range(80):
        if _nll(x, y, math.exp(a)) < _nll(x, y, math.exp(b)):
            high = b
        else:
            low = a
        a, b = high - ratio * (high - low), low + ratio * (high - low)
    temperature = math.exp((low + high) / 2.0)

    return CalibrationRecord(
        method=CALIBRATION_METHOD,
        version=CALIBRATION_VERSION,
        temperature=round(temperature, 6),
        fitted_on_split=split,
        checkpoint_weights_sha256=checkpoint_weights_sha256,
        samples=int(x.size),
    )


def calibrated_score(raw_logit: float, record: Optional[CalibrationRecord]) -> Optional[float]:
    """The calibrated candidate score, or None. Never the raw score renamed."""
    if record is None:
        return None
    return float(1.0 / (1.0 + math.exp(-raw_logit / record.temperature)))
