"""
The training configuration: loaded, validated, checked against the service,
and fingerprinted.

── Three kinds of check ───────────────────────────────────────────────────

**Shape.** Every section present, every value of the right type and in a sane
range. Unknown keys are refused rather than ignored: a misspelt key that is
silently dropped leaves the default in force while the author believes the
change was made.

**Agreement with the service.** Preprocessing must equal
`inference/detection_preprocess.PreprocessConfig`, and the patch geometry
must equal `inference/detection_service.DetectionConfig`. A detector trained
on patches the service would never produce is a detector nobody has measured.

**Agreement with the repository's governance record.** The configuration
states the localisation methodology and performance bar status. Those are
compared with what the repository actually says, and a configuration that
claims an approval the repository does not contain is refused. The harness
never needs a localisation tolerance to *train*; it refuses the claim so that
no experiment manifest can carry a false one.

── The forbidden transforms ───────────────────────────────────────────────

Flips mirror the anatomy and scaling changes physical size; both are refused
at load. A shift larger than the positive jitter is refused, because it could
crop a "positive" with its nodule pushed off-centre while keeping the label.
"""
from __future__ import annotations

import copy
import json
import os
from typing import Any, Dict, List

from training import _paths
from training.fingerprint import sha256_json

EXPECTED_SECTIONS = {
    "config_version", "status", "governance", "data", "preprocessing", "patch", "sampling",
    "balancing", "augmentation", "target", "model", "optimisation", "output",
}
BALANCING_METHODS = ("none", "pos_weight", "weighted_sampler")
OPTIMIZERS = ("adamw", "sgd")
SCHEDULERS = ("none", "cosine", "step")

MAX_ROTATION_DEG = 20.0


class ConfigInvalid(Exception):
    def __init__(self, problems: List[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def load_yaml(path: str) -> Dict[str, Any]:
    import yaml

    if not os.path.exists(path):
        raise ConfigInvalid(["configuration not found: %s" % path])
    with open(path, encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle)
    if not isinstance(loaded, dict):
        raise ConfigInvalid(["configuration is not a mapping"])
    return loaded


def repository_governance() -> Dict[str, str]:
    """What the repository itself records, read from the files of record."""
    methodology = "UNKNOWN"
    if os.path.exists(_paths.LOCALISATION_METHODOLOGY):
        with open(_paths.LOCALISATION_METHODOLOGY, encoding="utf-8") as handle:
            text = handle.read()
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("STATUS:"):
                methodology = stripped.split(":", 1)[1].strip()
                break

    bar_status, bar_approved = "UNKNOWN", None
    if os.path.exists(_paths.BAR):
        with open(_paths.BAR, encoding="utf-8") as handle:
            bar = json.load(handle)
        bar_status = bar.get("status", "UNKNOWN")
        bar_approved = bar.get("proposedGate", {}).get("approval", {}).get("approved")

    return {
        "localization_methodology_status": methodology,
        "performance_bar_status": bar_status if bar_approved is not True else "APPROVED",
    }


def _require(problems: List[str], condition: bool, message: str) -> None:
    if not condition:
        problems.append(message)


def validate(config: Dict[str, Any]) -> List[str]:
    problems: List[str] = []

    unknown = set(config) - EXPECTED_SECTIONS
    missing = EXPECTED_SECTIONS - set(config)
    if unknown:
        problems.append("unknown top-level keys: %s" % ", ".join(sorted(unknown)))
    if missing:
        problems.append("missing sections: %s" % ", ".join(sorted(missing)))
        return problems

    # ── governance: recorded, never claimed ────────────────────────────────
    recorded = repository_governance()
    governance = config["governance"]
    for key in ("localization_methodology_status", "performance_bar_status"):
        if governance.get(key) != recorded[key]:
            problems.append(
                "governance.%s is %r but the repository records %r. The configuration may "
                "state the repository's status; it may not claim a different one."
                % (key, governance.get(key), recorded[key])
            )
    _require(problems, governance.get("luna16") == "NOT_INTEGRATED",
             "governance.luna16 must be NOT_INTEGRATED: no project decision selects LUNA16")

    # ── data ───────────────────────────────────────────────────────────────
    data = config["data"]
    _require(problems, data.get("fit_split") == "train", "data.fit_split must be 'train'")
    _require(problems, data.get("select_split") == "validation",
             "data.select_split must be 'validation'")
    _require(problems, bool(data.get("expected_split_fingerprint")),
             "data.expected_split_fingerprint must pin the split")

    # ── preprocessing and patch must match the service ─────────────────────
    _paths.ensure_inference_on_path()
    from detection_preprocess import PREPROCESSING_VERSION, PreprocessConfig
    from detection_service import DetectionConfig

    pre = config["preprocessing"]
    service_pre = PreprocessConfig()
    _require(problems, pre.get("version") == PREPROCESSING_VERSION,
             "preprocessing.version %r is not the service's %r"
             % (pre.get("version"), PREPROCESSING_VERSION))
    for key in ("hu_min", "hu_max", "normalise", "channels"):
        _require(problems, pre.get(key) == getattr(service_pre, key),
                 "preprocessing.%s = %r does not match the service's %r"
                 % (key, pre.get(key), getattr(service_pre, key)))
    _require(problems, pre.get("resample_slice_spacing_mm") is None,
             "preprocessing.resample_slice_spacing_mm must be null: harness v1 does not "
             "transform label coordinates onto a resampled grid")

    patch = config["patch"]
    service_patch = DetectionConfig()
    _require(problems, patch.get("patch_px") == service_patch.patch_px,
             "patch.patch_px %r does not match the service's %r"
             % (patch.get("patch_px"), service_patch.patch_px))
    _require(problems, patch.get("channels") == service_patch.channels == pre.get("channels"),
             "patch.channels must equal the service's channels and preprocessing.channels")

    # ── sampling ───────────────────────────────────────────────────────────
    sampling = config["sampling"]
    _require(problems, isinstance(sampling.get("seed"), int), "sampling.seed must be an integer")
    _require(problems, int(sampling.get("positives_per_target", 0)) >= 1,
             "sampling.positives_per_target must be at least 1")
    _require(problems, int(sampling.get("negatives_per_series", -1)) >= 0,
             "sampling.negatives_per_series must be non-negative")
    _require(problems, float(sampling.get("negative_exclusion_radius_mm", 0)) > 0,
             "sampling.negative_exclusion_radius_mm must be positive")
    _require(problems, sampling.get("negatives_within_lung_mask") is True,
             "sampling.negatives_within_lung_mask must be true")

    _require(problems, config["balancing"].get("method") in BALANCING_METHODS,
             "balancing.method must be one of %s" % (BALANCING_METHODS,))

    # ── augmentation ───────────────────────────────────────────────────────
    augment = config["augmentation"]
    target = config["target"]
    _require(problems, augment.get("flip") is False,
             "augmentation.flip must be false: a flip mirrors the anatomy")
    _require(problems, augment.get("scale") is False,
             "augmentation.scale must be false: scaling changes physical size")
    _require(problems, 0 <= float(augment.get("max_rotation_deg", -1)) <= MAX_ROTATION_DEG,
             "augmentation.max_rotation_deg must be within [0, %.0f]" % MAX_ROTATION_DEG)
    _require(problems, 0 <= int(augment.get("max_shift_px", -1))
             <= int(target.get("positive_centre_jitter_px", -1)),
             "augmentation.max_shift_px must not exceed target.positive_centre_jitter_px")
    for key in ("hu_offset_max", "noise_sigma_hu", "contrast_scale_max"):
        _require(problems, float(augment.get(key, -1)) >= 0, "augmentation.%s must be >= 0" % key)
    _require(problems, float(augment.get("contrast_scale_max", 1)) < 0.5,
             "augmentation.contrast_scale_max must be below 0.5")
    _require(problems, isinstance(augment.get("seed"), int), "augmentation.seed must be an integer")

    meaning = str(target.get("meaning", "")).lower()
    for word in ("malignan", "cancer", "risk", "diagnos"):
        _require(problems, word not in meaning,
                 "target.meaning must describe a marked location, not %r" % word)

    # ── model and optimisation ─────────────────────────────────────────────
    model = config["model"]
    widths = model.get("widths")
    _require(problems, isinstance(widths, list) and len(widths) >= 1
             and all(isinstance(w, int) and w > 0 for w in widths),
             "model.widths must be a non-empty list of positive integers")
    _require(problems, 0 <= float(model.get("dropout", -1)) < 1, "model.dropout must be in [0, 1)")

    opt = config["optimisation"]
    _require(problems, opt.get("optimizer") in OPTIMIZERS, "optimisation.optimizer must be one of %s" % (OPTIMIZERS,))
    _require(problems, opt.get("scheduler") in SCHEDULERS, "optimisation.scheduler must be one of %s" % (SCHEDULERS,))
    _require(problems, float(opt.get("learning_rate", 0)) > 0, "optimisation.learning_rate must be positive")
    _require(problems, int(opt.get("batch_size", 0)) >= 1, "optimisation.batch_size must be positive")
    _require(problems, int(opt.get("epochs", 0)) >= 1, "optimisation.epochs must be positive")
    _require(problems, int(opt.get("early_stopping_patience", 0)) >= 1,
             "optimisation.early_stopping_patience must be positive")
    _require(problems, opt.get("selection_metric") == "validation_loss",
             "optimisation.selection_metric must be validation_loss")
    _require(problems, isinstance(opt.get("seed"), int), "optimisation.seed must be an integer")

    return problems


def load(path: str = _paths.DEFAULT_CONFIG) -> Dict[str, Any]:
    config = load_yaml(path)
    problems = validate(config)
    if problems:
        raise ConfigInvalid(problems)
    return config


def fingerprint(config: Dict[str, Any]) -> str:
    """Of the whole configuration, output paths excluded: where artifacts are
    written does not change what is trained."""
    material = copy.deepcopy(config)
    material.pop("output", None)
    return sha256_json(material)
