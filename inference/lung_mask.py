"""
Where in a CT volume the lungs are, so candidates cannot be proposed outside
them.

── What this is for ───────────────────────────────────────────────────────

A candidate generator run over a whole chest CT proposes things in the heart,
the liver, the chest wall, the scanner table and the air outside the patient.
Constraining it to lung parenchyma removes the most obvious of those before
they ever reach a radiologist's list. It is a false-positive constraint, not
a finding, and nothing here is evidence about a patient.

── What it is not ─────────────────────────────────────────────────────────

**Not a validated segmentation.** This is deterministic thresholding and
connected-component analysis on Hounsfield units, not a learned organ
segmenter, and it has not been measured against reference masks. It must never
be shown to a clinician as an organ boundary, used to compute a lung volume,
or described as segmentation output. P3 is where a validated segmenter and its
Dice would come from.

Its one job is to answer "could a candidate here plausibly be in the lung",
and the honest answer to that is conservative: the mask is deliberately
dilated so that a juxtapleural nodule sitting against the chest wall — which
is exactly the kind a threshold would exclude, because it is dense — is not
cut out of the search. A constraint that removes true findings is worse than
one that removes fewer false ones.

── Failure is explicit ────────────────────────────────────────────────────

A mask that cannot be produced is reported as unavailable, with a reason. It
is never returned empty and never silently skipped: an empty mask and a
missing mask are different things, and a detector that treats "no mask" as "no
lung" finds nothing and looks like it worked.

The policy for what a detector does with an unavailable mask belongs to the
detector, not here. This reports; `inference/detection_service.py` decides,
and records which it did.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:  # pragma: no cover - typing only
    from volume import CtVolume

MASK_VERSION = "lung-threshold-v1"

# Aerated lung parenchyma sits around -700 to -900 HU; air outside the patient
# is near -1000 and soft tissue is above -300. The band is wide because it has
# to hold emphysematous lung (lower) and consolidated or fibrotic lung
# (higher) without tuning to either.
LUNG_HU_MIN = -950.0
LUNG_HU_MAX = -300.0

# A region smaller than this is noise, bowel gas, or a bronchus, not a lung.
# Expressed as a fraction of the slice so it does not depend on the matrix.
MIN_COMPONENT_FRACTION = 0.005

# How far the mask is grown, in voxels, after the lung regions are found.
# Juxtapleural nodules are dense and touch the pleura, so a threshold-based
# mask cuts them off; growing the boundary keeps them inside the search at the
# cost of admitting some chest wall. Erring towards including a true finding.
DILATION_VOXELS = 3

# Real CT carries a padding value outside the reconstruction circle — the
# corners of the frame, where no measurement was made. LIDC writes -2048 there;
# other scanners use -3024. It is not air and not anatomy, and a candidate
# proposed in it would be anatomically impossible.
#
# The threshold already excludes it, but the dilation below grows back into it:
# measured on a real 45-slice LIDC series, 7,836 voxels of padding ended up
# inside the mask, 0.6% of it. Small, and still a hole in exactly the thing
# this module exists to provide. The floor sits below any real air — lung is
# around -800, air in the trachea and outside the body around -1000 to -1024 —
# so removing everything under it cost zero lung-band voxels on that series.
OUT_OF_FIELD_HU = -1100.0

# Below this fraction of the volume the result is not plausibly two lungs, and
# saying so is better than handing a detector a mask that excludes the organ.
MIN_LUNG_FRACTION = 0.01
# Above this, the "lung" has swallowed the patient and the threshold has not
# separated anything.
MAX_LUNG_FRACTION = 0.70


class LungMaskUnavailable(Exception):
    """No mask could be produced, and why.

    Raised rather than returning an empty mask, because an empty mask and a
    missing one mean opposite things to a detector and the difference is
    invisible once it is an array of False.
    """

    def __init__(self, code: str, message: str, detail: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, **self.detail}


@dataclass
class LungMask:
    """A boolean mask over the volume, and how it was arrived at."""

    mask: np.ndarray
    version: str
    lung_fraction: float
    warnings: list[str] = field(default_factory=list)

    @property
    def voxel_count(self) -> int:
        return int(self.mask.sum())

    def contains(self, i: float, j: float, k: int) -> bool:
        """Whether a voxel is inside the constraint. Out of bounds is False."""
        slices, rows, columns = self.mask.shape
        ii, jj = int(round(i)), int(round(j))
        if not (0 <= k < slices and 0 <= jj < rows and 0 <= ii < columns):
            return False
        return bool(self.mask[k, jj, ii])

    def as_dict(self) -> dict:
        return {
            "version": self.version,
            "lungFraction": round(self.lung_fraction, 5),
            "voxelCount": self.voxel_count,
            "warnings": self.warnings,
        }


def _label_components(binary: np.ndarray) -> tuple[np.ndarray, int]:
    """Connected components of a 2-D boolean array, 4-connected.

    Written out rather than pulling in scikit-image: one function is not worth
    a dependency with its own licence and wheel, and this keeps the module
    importable in the 3.8 serving environment where scikit-image is absent.

    Two-pass union-find, which is deterministic — a flood fill ordered by a
    set would not be.
    """
    rows, columns = binary.shape
    labels = np.zeros((rows, columns), dtype=np.int32)
    parent: list[int] = [0]

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    next_label = 1
    for r in range(rows):
        for c in range(columns):
            if not binary[r, c]:
                continue
            up = labels[r - 1, c] if r > 0 else 0
            left = labels[r, c - 1] if c > 0 else 0
            if up and left:
                labels[r, c] = min(up, left)
                union(up, left)
            elif up or left:
                labels[r, c] = up or left
            else:
                labels[r, c] = next_label
                parent.append(next_label)
                next_label += 1

    remap: dict[int, int] = {}
    for r in range(rows):
        for c in range(columns):
            if labels[r, c]:
                root = find(labels[r, c])
                if root not in remap:
                    remap[root] = len(remap) + 1
                labels[r, c] = remap[root]
    return labels, len(remap)


def _dilate(mask: np.ndarray, voxels: int) -> np.ndarray:
    """Grow the mask in-plane by shifting and OR-ing.

    A square structuring element via four shifts per step: cheap, exact, and
    no dependency. In-plane only — growing through the slices would merge
    lungs across a gap the acquisition does not have.
    """
    if voxels <= 0:
        return mask
    grown = mask.copy()
    for _ in range(voxels):
        shifted = grown.copy()
        shifted[:, 1:, :] |= grown[:, :-1, :]
        shifted[:, :-1, :] |= grown[:, 1:, :]
        shifted[:, :, 1:] |= grown[:, :, :-1]
        shifted[:, :, :-1] |= grown[:, :, 1:]
        grown = shifted
    return grown


def build_lung_mask(
    volume: "CtVolume",
    *,
    hu_min: float = LUNG_HU_MIN,
    hu_max: float = LUNG_HU_MAX,
    dilation_voxels: int = DILATION_VOXELS,
) -> LungMask:
    """A conservative lung-region constraint, or an explicit unavailability.

    The volume must be in Hounsfield units — `inference/volume.py` is what
    guarantees that. Handing this a normalised or windowed array would find
    nothing in the HU band and report an implausible mask, which is at least
    loud rather than silent.
    """
    array = volume.array
    if array.ndim != 3:
        raise LungMaskUnavailable(
            "not_a_volume",
            f"Expected a three-dimensional volume, got {array.ndim} dimensions.",
            {"ndim": int(array.ndim)},
        )
    if array.size == 0:
        raise LungMaskUnavailable("empty_volume", "The volume has no voxels.")

    # A quick sanity check that these really are Hounsfield units. Normalised
    # data lives in [0, 1] and would silently produce an empty mask.
    if float(array.min()) > -100.0:
        raise LungMaskUnavailable(
            "not_hounsfield_units",
            f"The volume's minimum value is {float(array.min()):.1f}. Air in a CT is near "
            "-1000 HU, so this array has already been windowed or normalised and the lung "
            "band would find nothing in it.",
            {"minValue": round(float(array.min()), 2)},
        )

    warnings: list[str] = []
    aerated = (array >= hu_min) & (array <= hu_max)

    # Per slice, keep only components large enough to be a lung and drop those
    # touching the border, which is the air around the patient and the table.
    slices, rows, columns = array.shape
    min_area = max(1, int(MIN_COMPONENT_FRACTION * rows * columns))
    keep = np.zeros_like(aerated, dtype=bool)

    for k in range(slices):
        labels, count = _label_components(aerated[k])
        if count == 0:
            continue
        for label in range(1, count + 1):
            component = labels == label
            if component.sum() < min_area:
                continue
            # Air outside the patient reaches the edge of the frame; lung does
            # not. A component touching the border on more than one side is
            # the surrounding air, not an organ.
            touches = (
                component[0, :].any().item()
                + component[-1, :].any().item()
                + component[:, 0].any().item()
                + component[:, -1].any().item()
            )
            if touches >= 2:
                continue
            keep[k] |= component

    lung_fraction = float(keep.sum()) / float(keep.size)

    if lung_fraction < MIN_LUNG_FRACTION:
        raise LungMaskUnavailable(
            "implausibly_small_lung_region",
            f"The lung region came to {lung_fraction:.4f} of the volume, below the "
            f"{MIN_LUNG_FRACTION} floor. Either this is not a chest CT, or the thresholding "
            "failed on it. A mask this small would exclude the organ and make a detector "
            "find nothing.",
            {"lungFraction": round(lung_fraction, 5)},
        )
    if lung_fraction > MAX_LUNG_FRACTION:
        raise LungMaskUnavailable(
            "implausibly_large_lung_region",
            f"The lung region came to {lung_fraction:.4f} of the volume, above the "
            f"{MAX_LUNG_FRACTION} ceiling. The threshold has not separated the lungs from "
            "anything, so the constraint would not constrain.",
            {"lungFraction": round(lung_fraction, 5)},
        )

    grown = _dilate(keep, dilation_voxels)

    # Growing the mask must not grow it out of the reconstruction circle. The
    # chest wall the dilation is there to include is dense — well above this
    # floor — so nothing the dilation exists for is lost.
    out_of_field = array < OUT_OF_FIELD_HU
    reclaimed = int((grown & out_of_field).sum())
    grown = grown & ~out_of_field

    grown_fraction = float(grown.sum()) / float(grown.size)
    if dilation_voxels:
        warnings.append(
            f"The mask was grown by {dilation_voxels} voxels in plane so that a nodule "
            "against the pleura is not excluded by the threshold. It therefore includes "
            "some chest wall and is not an organ boundary."
        )
    if reclaimed:
        warnings.append(
            f"{reclaimed} voxel(s) of out-of-field padding were removed from the grown mask. "
            "Outside the reconstruction circle nothing was measured, so a candidate there "
            "would be anatomically impossible."
        )

    return LungMask(
        mask=grown,
        version=MASK_VERSION,
        lung_fraction=grown_fraction,
        warnings=warnings,
    )
