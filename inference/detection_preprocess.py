"""
HU volume to detector input.

── Why this is not dicom_ingest's render ──────────────────────────────────

`inference/dicom_ingest.py` renders a slice to 8-bit through the lung window
(WC -600 / WW 1500) because the nodule characteriser was trained on exactly
that. A detector is a different model with different training, and handing it
the characteriser's render would be the same class of mistake that withdrew
the legacy lung model: a model meeting a distribution nobody measured it on,
with every individual number looking reasonable.

So this is a separate path with its own version and its own fingerprint, and
the two must never be substituted for one another. `inference/nodule_patch.py`
remains the only route to the characteriser.

── Determinism, and why it is fingerprinted ───────────────────────────────

Every published detector figure describes a model *and* the preprocessing that
fed it. Change the clip range, the resample spacing or the channel count and
the figure stops describing the deployed system, silently. So the parameters
live in a frozen dataclass, the version is a string that must be bumped when
they change, and the fingerprint is a hash over the actual values — which
means a mismatch is detectable rather than a matter of remembering.

`scripts/build-ood-reference.py` and `server/model-governance.ts` already work
this way for models. This is the same idea for the transform.

── What is deliberately configurable ──────────────────────────────────────

Clip range, resample spacing, patch size, channel count and stride are
parameters, not constants, because none of them has been chosen by
measurement yet. The defaults below are starting points drawn from the
acquisition characteristics on disk, not optima, and the docstring says so
rather than letting a reader infer authority from a number.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:  # pragma: no cover - typing only
    from volume import CtVolume

# Bump on any change to what the transform produces. The fingerprint catches
# a changed *value*; this records a changed *intent*.
PREPROCESSING_VERSION = "detect-hu-v1"


@dataclass(frozen=True)
class PreprocessConfig:
    """Everything that changes the numbers a detector sees.

    None of these is an optimum. They are starting points, and the values a
    detector is finally trained and validated with must be recorded in its
    model card and pinned by the fingerprint below.
    """

    # Air is about -1000 HU and dense bone runs past +1000. Lung parenchyma and
    # nodules both sit well inside [-1000, 400]; clipping above that spends
    # dynamic range on ribs and the table. A wider range is not wrong, it is a
    # different transform, which is why it is pinned rather than assumed.
    hu_min: float = -1000.0
    hu_max: float = 400.0

    # Scale the clipped range to [0, 1]. Deliberately not z-scoring per volume:
    # a per-volume mean and standard deviation make the same anatomy map to
    # different numbers depending on how much of the patient is in the frame.
    normalise: bool = True

    # Through-plane spacing to resample to, in millimetres. LIDC runs 1.25 to
    # 3.0 mm, so a detector consuming adjacent slices sees a different physical
    # thickness per study unless they are put on a common grid. `None` leaves
    # the acquisition spacing untouched.
    resample_slice_spacing_mm: float | None = None

    # Number of adjacent slices stacked as channels. Odd, so a patch has a
    # centre slice. Three is the smallest stack that carries any through-plane
    # context at all — which is what separates a nodule from a vessel in
    # cross-section — and is a starting point, not a result.
    channels: int = 3

    def fingerprint(self) -> str:
        """A stable digest of the values, so a changed transform is visible.

        Sorted keys and a fixed separator: the digest must depend on the
        values and not on dictionary ordering or formatting.
        """
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]

    def as_dict(self) -> dict:
        return {
            "version": PREPROCESSING_VERSION,
            "fingerprint": self.fingerprint(),
            **asdict(self),
        }


DEFAULT_CONFIG = PreprocessConfig()


def to_hu_window(array: np.ndarray, config: PreprocessConfig = DEFAULT_CONFIG) -> np.ndarray:
    """Clip to the configured HU range and optionally scale to [0, 1].

    Operates on HU and returns float32. The input must already be Hounsfield
    units — `inference/volume.py` is what guarantees that, by refusing a series
    with no modality LUT rather than assuming an identity transform.
    """
    if array.dtype != np.float32:
        array = array.astype(np.float32)
    clipped = np.clip(array, config.hu_min, config.hu_max)
    if not config.normalise:
        return clipped
    span = config.hu_max - config.hu_min
    if span <= 0:
        raise ValueError(f"hu_max ({config.hu_max}) must exceed hu_min ({config.hu_min})")
    return ((clipped - config.hu_min) / span).astype(np.float32)


def resample_slices(
    volume: "CtVolume", config: PreprocessConfig = DEFAULT_CONFIG
) -> tuple[np.ndarray, float]:
    """Put the stack on a uniform through-plane grid, or leave it alone.

    Linear interpolation along z only. In-plane resampling is deliberately not
    done here: it changes the pixel size the model sees, and no detector has
    been chosen whose training spacing could justify a target.

    Returns the array and the slice spacing it is now on, so a caller never
    has to infer which of the two happened.
    """
    if config.resample_slice_spacing_mm is None:
        return volume.array, volume.slice_spacing_mm

    target = float(config.resample_slice_spacing_mm)
    if target <= 0:
        raise ValueError(f"resample_slice_spacing_mm must be positive, got {target}")

    # The real positions, not an assumed grid: the volume already records
    # whether the acquisition was uniform, and extrapolating a nominal spacing
    # would reintroduce the error that tolerance exists to absorb.
    positions = np.array(
        [volume.frame.origins[k][2] for k in range(volume.shape[0])], dtype=np.float64
    )
    axis = np.array([np.dot(volume.frame.origins[k], volume.frame.normal)
                     for k in range(volume.shape[0])], dtype=np.float64)
    del positions

    start, end = float(axis[0]), float(axis[-1])
    if end <= start:
        raise ValueError("slice positions do not increase; the volume is not ordered")

    count = int(np.floor((end - start) / target)) + 1
    if count < 2:
        raise ValueError(
            f"resampling to {target} mm would leave {count} slice(s) across "
            f"{end - start:.1f} mm of anatomy"
        )
    wanted = start + np.arange(count) * target

    slices, rows, columns = volume.shape
    flat = volume.array.reshape(slices, rows * columns)
    out = np.empty((count, rows * columns), dtype=np.float32)
    for column in range(flat.shape[1]):
        out[:, column] = np.interp(wanted, axis, flat[:, column])
    return out.reshape(count, rows, columns), target


def build_channel_stack(
    array: np.ndarray, centre: int, channels: int = 3
) -> np.ndarray:
    """`channels` adjacent slices around `centre`, edge-padded.

    Edge padding rather than wrapping or shifting the centre: a nodule at the
    apex of the lung is exactly the case where moving the window would put the
    lesion off-centre and teach a model that findings live at the edge of the
    stack. The same argument as the characteriser's crop padding, one
    dimension up.
    """
    if channels < 1:
        raise ValueError("channels must be at least 1")
    if channels % 2 == 0:
        raise ValueError(f"channels must be odd so the stack has a centre slice, got {channels}")
    half = channels // 2
    indices = np.clip(np.arange(centre - half, centre + half + 1), 0, array.shape[0] - 1)
    return array[indices]


def prepare_volume(
    volume: "CtVolume", config: PreprocessConfig = DEFAULT_CONFIG
) -> tuple[np.ndarray, dict]:
    """The full transform: resample, clip, normalise.

    Returns the prepared array and a record of exactly what was done to it,
    which is what gets persisted alongside any candidate so that a result can
    be tied to the transform that produced it.
    """
    resampled, spacing = resample_slices(volume, config)
    prepared = to_hu_window(resampled, config)
    record = config.as_dict()
    record.update({
        "inputShape": list(volume.shape),
        "outputShape": list(prepared.shape),
        "sliceSpacingMmIn": round(volume.slice_spacing_mm, 4),
        "sliceSpacingMmOut": round(float(spacing), 4),
        "resampled": config.resample_slice_spacing_mm is not None,
    })
    return prepared, record
