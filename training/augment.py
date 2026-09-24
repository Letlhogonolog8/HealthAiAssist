"""
Deterministic augmentation that moves the target with the pixels.

── Why the target is carried explicitly ───────────────────────────────────

A patch's label is a claim about a location: "a nodule is centred here".
Shift or rotate the pixels and that location moves. An augmentation that
changes the pixels and leaves the label's meaning untouched teaches the model
a different claim than the one being made. So every transform here returns the
new target position in patch coordinates alongside the new pixels, and a test
checks the two against each other.

── What is allowed ────────────────────────────────────────────────────────

  translation   in plane, integer pixels, bounded by the positive jitter
  rotation      in plane about the slice normal, small angles only
  intensity     HU offset, contrast scale and Gaussian noise, applied in the
                normalised space but parameterised in Hounsfield units

What is refused, and why:

  flips         a left-right or anterior-posterior flip produces a mirrored
                chest; a cranio-caudal flip reverses the slice order the
                2.5D channels encode. None is anatomy a scanner produces.
  scaling       changes the physical size a pixel represents, which the
                volume's millimetre frame exists to keep fixed.
  through-plane anything that mixes the channel slices.

── Determinism ────────────────────────────────────────────────────────────

The random stream for a sample is derived from (augmentation seed, epoch,
sample index) by hashing, not drawn from a shared generator. The same sample
in the same epoch gets the same transform regardless of batch order, worker
count or which samples came before it.
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Any, Dict, Tuple

import numpy as np

AUGMENTATION_VERSION = "detect-augment-v1"


class AugmentationRefused(Exception):
    """A transform the harness does not permit, or one that loses the target."""


@dataclass(frozen=True)
class AugmentConfig:
    enabled: bool
    seed: int
    max_shift_px: int
    max_rotation_deg: float
    hu_offset_max: float
    contrast_scale_max: float
    noise_sigma_hu: float
    hu_span: float           # hu_max - hu_min of the preprocessing, for unit conversion
    flip: bool = False
    scale: bool = False

    def __post_init__(self) -> None:
        if self.flip:
            raise AugmentationRefused("flips mirror the anatomy and are not permitted")
        if self.scale:
            raise AugmentationRefused("scaling changes physical size and is not permitted")
        if self.max_shift_px < 0 or self.max_rotation_deg < 0:
            raise AugmentationRefused("shift and rotation bounds must be non-negative")
        if self.max_rotation_deg > 20.0:
            raise AugmentationRefused("rotations above 20 degrees are not permitted")
        if self.hu_span <= 0:
            raise AugmentationRefused("hu_span must be positive")

    @classmethod
    def from_config(cls, section: Dict[str, Any], preprocessing: Dict[str, Any]) -> "AugmentConfig":
        return cls(
            enabled=bool(section["enabled"]),
            seed=int(section["seed"]),
            max_shift_px=int(section["max_shift_px"]),
            max_rotation_deg=float(section["max_rotation_deg"]),
            hu_offset_max=float(section["hu_offset_max"]),
            contrast_scale_max=float(section["contrast_scale_max"]),
            noise_sigma_hu=float(section["noise_sigma_hu"]),
            hu_span=float(preprocessing["hu_max"]) - float(preprocessing["hu_min"]),
            flip=bool(section.get("flip", False)),
            scale=bool(section.get("scale", False)),
        )


def context_margin(patch_px: int, max_shift_px: int) -> int:
    """How much context around the output patch a rotation plus shift needs.

    Rotating a square about its centre sweeps its corners out to half the
    diagonal, so the source must extend that far plus the largest shift.
    """
    return int(math.ceil(patch_px * (math.sqrt(2.0) - 1.0) / 2.0)) + max_shift_px + 1


def sample_rng(seed: int, epoch: int, index: int) -> np.random.Generator:
    digest = hashlib.sha256(("%d:%d:%d" % (seed, epoch, index)).encode("ascii")).digest()
    return np.random.default_rng(int.from_bytes(digest[:8], "big"))


def _rotate_point(point: Tuple[float, float], centre: Tuple[float, float], degrees: float) -> Tuple[float, float]:
    """Where (row, col) goes under the same rotation scipy.ndimage.rotate applies."""
    theta = math.radians(degrees)
    dr, dc = point[0] - centre[0], point[1] - centre[1]
    # ndimage.rotate in the (row, col) plane rotates the image counter-clockwise
    # as displayed; a point moves by the matching rotation of its offset.
    new_r = centre[0] + dr * math.cos(theta) - dc * math.sin(theta)
    new_c = centre[1] + dr * math.sin(theta) + dc * math.cos(theta)
    return new_r, new_c


def centre_crop(context: np.ndarray, patch_px: int) -> np.ndarray:
    """The unaugmented patch: the centre of the context window."""
    side = context.shape[-1]
    start = (side - patch_px) // 2
    return context[:, start:start + patch_px, start:start + patch_px]


def apply(
    context: np.ndarray,
    target_rc: Tuple[float, float],
    patch_px: int,
    config: AugmentConfig,
    epoch: int,
    index: int,
) -> Tuple[np.ndarray, Tuple[float, float], Dict[str, float]]:
    """(patch, target position in patch coordinates, parameters used).

    `context` is (channels, S, S) in normalised units with the sample's centre
    at the middle; `target_rc` is where the target sits in context coordinates
    (row, col). The same rotation and shift are applied to every channel,
    because the channels are adjacent slices of one location and must stay
    registered to each other.
    """
    channels, side, side_c = context.shape
    if side != side_c:
        raise AugmentationRefused("context window must be square")
    start = (side - patch_px) // 2

    if not config.enabled:
        patch = context[:, start:start + patch_px, start:start + patch_px].astype(np.float32)
        return patch, (target_rc[0] - start, target_rc[1] - start), {}

    needed = context_margin(patch_px, config.max_shift_px)
    if start < needed - 1:
        raise AugmentationRefused(
            "context window %d is too small for a %d px patch with %d px shift and rotation"
            % (side, patch_px, config.max_shift_px)
        )

    rng = sample_rng(config.seed, epoch, index)
    angle = float(rng.uniform(-config.max_rotation_deg, config.max_rotation_deg))
    shift_r = int(rng.integers(-config.max_shift_px, config.max_shift_px + 1))
    shift_c = int(rng.integers(-config.max_shift_px, config.max_shift_px + 1))
    offset = float(rng.uniform(-config.hu_offset_max, config.hu_offset_max)) / config.hu_span
    contrast = 1.0 + float(rng.uniform(-config.contrast_scale_max, config.contrast_scale_max))
    noise_sigma = config.noise_sigma_hu / config.hu_span

    work = context.astype(np.float32)
    centre = ((side - 1) / 2.0, (side - 1) / 2.0)
    if angle != 0.0:
        from scipy import ndimage

        work = np.stack([
            ndimage.rotate(work[c], angle, reshape=False, order=1, mode="nearest")
            for c in range(channels)
        ])
    rotated_target = _rotate_point(target_rc, centre, angle)

    # Shifting the crop window by (+r, +c) moves the content by (-r, -c).
    r0, c0 = start + shift_r, start + shift_c
    patch = work[:, r0:r0 + patch_px, c0:c0 + patch_px]
    new_target = (rotated_target[0] - r0, rotated_target[1] - c0)

    if not (0 <= new_target[0] < patch_px and 0 <= new_target[1] < patch_px):
        raise AugmentationRefused("the transform moved the target out of the patch")

    # Intensity: contrast about the patch mean, then offset, then noise.
    mean = float(patch.mean())
    patch = (patch - mean) * contrast + mean + offset
    if noise_sigma > 0:
        patch = patch + rng.normal(0.0, noise_sigma, size=patch.shape).astype(np.float32)
    patch = np.clip(patch, 0.0, 1.0).astype(np.float32)

    return patch, new_target, {
        "rotationDeg": angle, "shiftRow": shift_r, "shiftCol": shift_c,
        "huOffset": offset * config.hu_span, "contrast": contrast,
    }


def fingerprint_material(config: AugmentConfig) -> Dict[str, Any]:
    return {
        "version": AUGMENTATION_VERSION,
        "enabled": config.enabled,
        "seed": config.seed,
        "maxShiftPx": config.max_shift_px,
        "maxRotationDeg": config.max_rotation_deg,
        "huOffsetMax": config.hu_offset_max,
        "contrastScaleMax": config.contrast_scale_max,
        "noiseSigmaHu": config.noise_sigma_hu,
    }
