"""
Serves the LIDC-IDRI lung nodule characteriser — route 1.

A clinician marks a nodule on one CT slice; this returns the probability that a
radiologist would rate that nodule malignant. It answers nothing else. There is
no detector in front of it, a whole slice is out of distribution for it and is
refused, and its evidence is 97 held-out nodules (29 malignant), which is the
size of interval it publishes.

── Inputs, and why only DICOM ─────────────────────────────────────────────

The model was trained on 64 px crops at the CT's native pixel scale, rendered
at the lung window by `dicom_ingest.training_window()`. A DICOM object carries
that scale; a PNG or JPEG export does not — it may be the full 512 px slice, a
downsampled preview, or a screenshot at any zoom — so a 64 px crop of it has an
unknown physical size and the model's answer would be about an unknown
question. Raster input is therefore refused for this modality, with the
reason. This is the opposite decision from the withdrawn lung model, which
accepted rasters it had no measured performance on, and it is deliberate.

── What travels with the answer ───────────────────────────────────────────

Everything a reviewer needs to weigh it, as numbers: the calibrated
probability, the temperature (1.0 — fitted, measured, not applied, see the
calibration file), the operating threshold and where it was chosen, the OOD
score against its threshold, the quality-gate outcome, the crop centre and
size, and the acquisition. Nothing here is rendered as a percentage string.

── One implementation of everything ───────────────────────────────────────

Windowing: `dicom_ingest._window` with `training_window`. Crop and resize:
`nodule_patch`. Both are the functions the training extractor imported. The
OOD reference and calibration are the files `scripts/build-ood-reference.py`
and `scripts/calibrate-model.py` wrote for this artifact.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

import numpy as np

from dicom_ingest import DicomRejected, dicom_to_model_frame, looks_like_dicom
from nodule_patch import PATCH_PX, crop, patch_to_model_input

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_MODEL_PATH = os.path.join(
    REPO_ROOT, "dataset", "lung_nodule_model", "resnet50v2_lung_nodule_model.h5"
)

# Class index order fixed by training; recorded in lung_nodule_training.json.
CLASSES = ("cancer", "no_cancer")

# Pixel-level floors, measured on 2,900 training patches on 2026-09-21 rather
# than copied from the chest model: an upsampled 64 px crop is smooth by
# construction (Laplacian variance min 1.57, median 4.4 on the training set;
# the chest model's floor of 8.0 would refuse every valid patch) and its
# contrast is modest (std min 8.0). The floors sit below the training minimum
# so that no valid input is refused by them; they catch a blank or saturated
# crop, which is what they are for.
MIN_STD = 4.0
MIN_LAPLACIAN_VAR = 1.0
MIN_MEAN = 15.0
MAX_MEAN = 240.0


class LungNoduleCharacteriser:
    def __init__(self, model_path: str | None = None):
        self.model_path = model_path or os.environ.get("LUNG_NODULE_MODEL_PATH", DEFAULT_MODEL_PATH)
        self.model_dir = os.path.dirname(self.model_path)
        self.model = None
        self.load_error: str | None = None
        self._trunk = None
        self.training = self._read_json("lung_nodule_training.json") or {}
        self.calibration = self._read_json("lung_nodule_model_calibration.json") or {}
        self.threshold = self._load_threshold()
        self.temperature = self._load_temperature()
        self.load_model()

    # ── configuration ──────────────────────────────────────────────────────

    def _read_json(self, name: str) -> dict | None:
        path = os.path.join(self.model_dir, name)
        try:
            with open(path) as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return None

    def _load_threshold(self) -> float:
        """The operating point chosen on validation nodules, from the training record.

        No environment override: the threshold and the published figures were
        chosen together, and a deployment that moves one without the other
        publishes figures about a different operating point.
        """
        try:
            return float(self.training["operatingPoint"]["threshold"])
        except (KeyError, TypeError, ValueError):
            self.load_error = "lung_nodule_training.json has no operatingPoint.threshold"
            return float("nan")

    def _load_temperature(self) -> float:
        """1.0 unless calibration was fitted AND applied. It was fitted (1.265)
        and deliberately not applied — validation ECE did not improve by a
        meaningful margin — so the raw output is already read as a probability."""
        if self.calibration.get("applied"):
            return float(self.calibration.get("temperature", 1.0)) or 1.0
        return 1.0

    def load_model(self) -> None:
        try:
            if not os.path.exists(self.model_path):
                self.model = None
                self.load_error = f"Model file not found at {self.model_path}"
                return
            import tensorflow as tf

            self.model = tf.keras.models.load_model(self.model_path)
            print("Lung nodule characteriser loaded", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            self.model = None
            self.load_error = f"Error loading lung nodule model: {exc}"
            print(self.load_error, file=sys.stderr)

    # ── screens ────────────────────────────────────────────────────────────

    @staticmethod
    def _quality_failures(batch: np.ndarray) -> list[str]:
        grey = batch[0].mean(axis=2)
        reasons = []
        if float(grey.std()) < MIN_STD:
            reasons.append("The marked region is nearly uniform; there is no visible structure to assess.")
        level = float(grey.mean())
        if level < MIN_MEAN:
            reasons.append("The marked region is almost entirely black.")
        elif level > MAX_MEAN:
            reasons.append("The marked region is saturated to near-white.")
        laplacian = (
            -4.0 * grey[1:-1, 1:-1]
            + grey[:-2, 1:-1] + grey[2:, 1:-1]
            + grey[1:-1, :-2] + grey[1:-1, 2:]
        )
        if float(laplacian.var()) < MIN_LAPLACIAN_VAR:
            reasons.append("The marked region has no discernible detail.")
        return reasons

    def _feature_extractor(self):
        if self._trunk is None:
            import tensorflow as tf

            inputs = self.model.input
            x = self.model.get_layer("resnet_v2_preprocess")(inputs)
            self._trunk = tf.keras.Model(inputs, self.model.get_layer("resnet50v2")(x))
        return self._trunk

    def _out_of_distribution(self, batch: np.ndarray) -> tuple[bool | None, dict | None, str | None]:
        """PCA reconstruction error against the reference built for THIS model.

        Validated in both directions (lung_nodule_model_ood.json): held-out
        benign patches accepted at 96.7%, off-nodule parenchyma at 99.2%; whole
        CT slices refused at 90.8%, skin lesions at 92.5%. A missing reference
        is reported, never silently passed.
        """
        reference_path = os.path.join(self.model_dir, "lung_nodule_ood_reference.npz")
        if not os.path.exists(reference_path):
            return None, None, "No OOD reference installed; domain check skipped."
        try:
            reference = np.load(reference_path)
            mean = reference["mean"].astype(np.float64)
            components = reference["components"].astype(np.float64)
            threshold = float(reference["threshold"])
            features = self._feature_extractor().predict(batch, verbose=0).astype(np.float64)
            centred = features - mean
            reconstructed = (centred @ components.T) @ components
            error = float(np.linalg.norm(centred - reconstructed, axis=1)[0])
            return error > threshold, {"score": round(error, 3), "threshold": round(threshold, 3)}, None
        except Exception as exc:  # noqa: BLE001
            return None, None, f"OOD check failed to run: {exc}"

    # ── the answer ─────────────────────────────────────────────────────────

    def _apply_temperature(self, probabilities: np.ndarray) -> np.ndarray:
        if self.temperature == 1.0:
            return probabilities
        logits = np.log(np.clip(probabilities, 1e-12, 1.0)) / self.temperature
        logits -= logits.max()
        exp = np.exp(logits)
        return exp / exp.sum()

    def prepare(self, data: bytes, cx: float, cy: float) -> tuple[np.ndarray, dict]:
        """Bytes plus a marked centre to the (1, 224, 224, 3) model input.

        DICOM only — see the module docstring. Raises DicomRejected for a
        raster, a non-CT object, or a centre outside the frame.
        """
        if not looks_like_dicom(data):
            raise DicomRejected(
                "The nodule characteriser takes the DICOM object, not a PNG or JPEG "
                "export: it was trained on 64-pixel crops at the CT's native pixel "
                "scale, and a rendered image carries no scale. Upload the .dcm slice "
                "and mark the nodule on it."
            )
        frame, acquisition, deidentified = dicom_to_model_frame(data)

        if acquisition.get("modality", "").upper() != "CT":
            raise DicomRejected(
                f"This object is {acquisition.get('modality') or 'of unknown modality'}, not CT. "
                "The nodule characteriser was trained on chest CT only."
            )

        rows, cols = frame.shape[:2]
        if not (0 <= cx < cols and 0 <= cy < rows):
            raise DicomRejected(
                f"The marked centre ({cx:.0f}, {cy:.0f}) lies outside the {cols}x{rows} frame."
            )

        patch = crop(frame, cx, cy, PATCH_PX)
        batch = patch_to_model_input(patch)
        acquisition = dict(acquisition)
        acquisition["deidentifiedObject"] = deidentified
        acquisition["region"] = {
            "cx": float(cx), "cy": float(cy), "sizePx": PATCH_PX,
            "sizeMm": (
                [round(PATCH_PX * acquisition["pixelSpacingMm"][0], 1),
                 round(PATCH_PX * acquisition["pixelSpacingMm"][1], 1)]
                if acquisition.get("pixelSpacingMm") else None
            ),
            "frameRows": rows, "frameColumns": cols,
        }
        return batch, acquisition

    def characterise(self, data: bytes, cx: float, cy: float) -> dict[str, Any]:
        """The full answer, or a refusal in the same shape the other services use."""
        timestamp = datetime.now(timezone.utc).isoformat()
        if self.model is None or self.threshold != self.threshold:  # NaN check
            return {
                "prediction": None, "status": "model_unavailable",
                "message": self.load_error or "Lung nodule model is not loaded",
                "inferenceAt": timestamp,
            }

        try:
            batch, acquisition = self.prepare(data, cx, cy)
        except DicomRejected as exc:
            return {
                "prediction": "rejected_input", "status": "rejected_input",
                "reasons": [str(exc)], "qualityGate": "rejected",
                "message": "The input was not something the nodule characteriser can assess.",
                "inferenceAt": timestamp,
            }

        failures = self._quality_failures(batch)
        if failures:
            return {
                "prediction": "rejected_input", "status": "rejected_input",
                "reasons": failures, "qualityGate": "failed",
                "acquisition": {k: v for k, v in acquisition.items() if k != "deidentifiedObject"},
                "message": "The marked region failed quality checks and was not classified.",
                "inferenceAt": timestamp,
            }

        is_ood, ood_detail, ood_note = self._out_of_distribution(batch)
        if is_ood:
            return {
                "prediction": "rejected_input", "status": "rejected_input",
                "reasons": [
                    "The marked region does not resemble the nodule crops the model was "
                    "trained on, so no probability was produced. A whole slice, a region "
                    "away from the lung, or a non-CT image all look like this."
                ],
                "qualityGate": "passed", "oodScore": ood_detail,
                "acquisition": {k: v for k, v in acquisition.items() if k != "deidentifiedObject"},
                "message": "Input is outside the model's training distribution.",
                "inferenceAt": timestamp,
            }

        raw = self.model.predict(batch, verbose=0)[0]
        probabilities = self._apply_temperature(raw)
        p_malignant = float(probabilities[0])
        flagged = p_malignant >= self.threshold

        return {
            "prediction": "cancer" if flagged else "no_cancer",
            "status": "success",
            "probability": p_malignant,
            "probabilities": {c: float(p) for c, p in zip(CLASSES, probabilities)},
            "threshold": self.threshold,
            "thresholdChosenOn": self.training.get("operatingPoint", {}).get("chosenOn"),
            "temperature": self.temperature,
            "calibrationApplied": bool(self.calibration.get("applied")),
            "calibrationEce": (self.calibration.get("before") or {}).get("expectedCalibrationError"),
            "oodScore": ood_detail,
            "oodNote": ood_note,
            "qualityGate": "passed",
            "acquisition": acquisition,  # includes deidentifiedObject for the caller to persist
            "answers": self.training.get("answers"),
            "doesNotAnswer": self.training.get("doesNotAnswer"),
            "inferenceAt": timestamp,
        }


lung_nodule_characteriser = LungNoduleCharacteriser()


def characterise_nodule(data: bytes, cx: float, cy: float) -> dict[str, Any]:
    return lung_nodule_characteriser.characterise(data, cx, cy)
