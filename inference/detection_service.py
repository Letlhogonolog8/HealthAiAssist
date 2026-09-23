"""
Candidate proposal: where in a CT volume something might be worth a look.

── What a candidate is ────────────────────────────────────────────────────

A location, a score, and nothing else. It is a hypothesis for a radiologist to
accept or reject, not a finding, not a nodule, and emphatically not a
malignancy. The score answers one question — *would a radiologist have marked
something here* — and that is the only question the LIDC annotations can
support. It is not a probability of cancer, not a risk, and not a priority.

The vocabulary is enforced rather than hoped for: the fields are
`score_raw` and `score_calibrated`, and there is no field a malignancy could
be written into.

── There is no detector yet ───────────────────────────────────────────────

No trained checkpoint exists in this repository, and none can be trained on
the hardware it runs on (`torch.cuda.is_available()` is False). So the model
is a slot, not an implementation: `CandidateDetector` is the interface a real
one would satisfy, and with nothing registered a detection run **refuses** with
`model_unavailable` rather than returning an empty candidate list.

That distinction is the whole reason this module is shaped the way it is. An
empty list means "this volume was searched and nothing scored above the
threshold". A refusal means "no search happened". Collapsing the two would let
an infrastructure failure read as a normal negative result, which is the
failure mode the whole platform is built to avoid.

── What this does not do ──────────────────────────────────────────────────

No malignancy classification. No triage. No characterisation — that is the
existing `lung_nodule` model, reached only after a clinician has reviewed a
candidate, and it keeps its own fingerprint, OOD screen and calibration.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any, Protocol, Sequence

import numpy as np

if TYPE_CHECKING:  # pragma: no cover - typing only
    from lung_mask import LungMask
    from volume import CtVolume

DETECTION_COORDINATE_SYSTEM = "dicom_patient_lps"


@dataclass(frozen=True)
class DetectionConfig:
    """Search parameters.

    Every one of these needs empirical selection against a validation split,
    and none has had it. They are recorded and fingerprinted so that whatever
    a detector is eventually validated with is the thing that ships, rather
    than whatever was in the file that day.
    """

    # Side of the square search window, in voxels, at the volume's own
    # in-plane spacing.
    patch_px: int = 64
    # How far the window moves between positions. Smaller finds more and costs
    # proportionally more.
    stride_px: int = 16
    # How many adjacent slices the detector sees per position.
    channels: int = 3
    # Slices between search positions along the volume's z axis.
    slice_stride: int = 1
    # Below this a position is not proposed at all. A threshold, not a
    # probability: what it means depends entirely on the detector behind it.
    score_threshold: float = 0.5
    # Two candidates closer than this in patient space are the same finding
    # seen twice. Millimetres, not voxels, so it does not silently change
    # meaning with the acquisition's spacing.
    merge_radius_mm: float = 8.0
    # A cap, so a degenerate volume cannot produce a list nobody can review.
    max_candidates: int = 100

    def fingerprint(self) -> str:
        import hashlib
        import json

        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]

    def as_dict(self) -> dict:
        return {"fingerprint": self.fingerprint(), **asdict(self)}


DEFAULT_DETECTION_CONFIG = DetectionConfig()


@dataclass
class Candidate:
    """One proposed location. Never a finding.

    Both coordinate systems are carried because each answers a different
    question: voxel indices are reproducible against the volume that was
    searched, patient millimetres survive a rebuild and are what a viewer and
    the characteriser need.
    """

    voxel_i: float
    voxel_j: float
    voxel_k: int
    x_mm: float
    y_mm: float
    z_mm: float
    score_raw: float
    score_calibrated: float | None = None
    coordinate_system: str = DETECTION_COORDINATE_SYSTEM
    # The ordered slice a reviewer opens to see this. Equals voxel_k for an
    # unresampled volume and does not when the volume was put on another grid,
    # which is exactly why it is stored rather than derived at read time.
    position_index: int = 0
    merged_from: int = 1

    def as_dict(self) -> dict:
        return {
            "voxelI": round(self.voxel_i, 3),
            "voxelJ": round(self.voxel_j, 3),
            "voxelK": int(self.voxel_k),
            "xMm": round(self.x_mm, 4),
            "yMm": round(self.y_mm, 4),
            "zMm": round(self.z_mm, 4),
            "coordinateSystem": self.coordinate_system,
            "positionIndex": int(self.position_index),
            "scoreRaw": round(self.score_raw, 6),
            "scoreCalibrated": (
                round(self.score_calibrated, 6) if self.score_calibrated is not None else None
            ),
            "mergedFrom": self.merged_from,
        }


class DetectorUnavailable(Exception):
    """No detector is registered, or the registered one cannot run.

    Deliberately not caught and converted into an empty result anywhere in
    this module. A caller has to decide what to tell a clinician, and the only
    correct answers are a refusal or a service error.
    """

    def __init__(self, code: str, message: str, detail: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, **self.detail}


class CandidateDetector(Protocol):
    """What a real detector must provide.

    `score_batch` takes a stack of (channels, height, width) float patches and
    returns one score per patch, in the same order. The scores mean whatever
    the detector was trained and calibrated to mean, which is why the model
    version travels with every result.
    """

    version: str

    def score_batch(self, patches: np.ndarray) -> np.ndarray:  # pragma: no cover - protocol
        ...


# The registry is empty, on purpose, and a run refuses while it stays that
# way. Registering something here is a governance act: it needs a model card,
# an artifact fingerprint, a MEASUREMENT_BINDINGS entry and a validation
# record before it can serve. See docs/ML_CHANGE_PROCESS.md.
_REGISTERED_DETECTOR: CandidateDetector | None = None


def register_detector(detector: CandidateDetector | None) -> None:
    """Install a detector. Used by tests and, eventually, by model loading."""
    global _REGISTERED_DETECTOR
    _REGISTERED_DETECTOR = detector


def registered_detector() -> CandidateDetector | None:
    return _REGISTERED_DETECTOR


def detector_status() -> dict:
    """What `/healthz` and a refusal need to say about the model slot."""
    detector = registered_detector()
    return {
        "available": detector is not None,
        "version": getattr(detector, "version", None),
        "note": (
            "No candidate detector is registered. Detection refuses; it does not "
            "return an empty candidate list."
            if detector is None
            else None
        ),
    }


@dataclass
class DetectionResult:
    """The outcome of searching one volume."""

    candidates: list[Candidate]
    detector_version: str
    config: DetectionConfig
    positions_searched: int
    positions_scored: int
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "candidates": [c.as_dict() for c in self.candidates],
            "candidateCount": len(self.candidates),
            "detectorVersion": self.detector_version,
            "config": self.config.as_dict(),
            "positionsSearched": self.positions_searched,
            "positionsScored": self.positions_scored,
            "warnings": self.warnings,
            "coordinateSystem": DETECTION_COORDINATE_SYSTEM,
        }


def _window_positions(
    volume_shape: tuple[int, int, int], config: DetectionConfig
) -> list[tuple[int, int, int]]:
    """Centres of every search window, as (k, j, i).

    The last position on each axis is pulled back to the edge rather than
    dropped, so the far margin of the volume is searched instead of silently
    excluded.
    """
    slices, rows, columns = volume_shape
    half = config.patch_px // 2

    def axis(extent: int) -> list[int]:
        if extent <= config.patch_px:
            return [extent // 2]
        centres = list(range(half, extent - half + 1, config.stride_px))
        if centres[-1] != extent - half:
            centres.append(extent - half)
        return centres

    return [
        (k, j, i)
        for k in range(0, slices, max(1, config.slice_stride))
        for j in axis(rows)
        for i in axis(columns)
    ]


def _extract_patch(array: np.ndarray, k: int, j: int, i: int, config: DetectionConfig) -> np.ndarray:
    """A (channels, patch, patch) stack centred on (k, j, i), edge-padded."""
    from detection_preprocess import build_channel_stack

    stack = build_channel_stack(array, centre=k, channels=config.channels)
    half = config.patch_px // 2
    j0, i0 = j - half, i - half
    padded = np.pad(
        stack,
        ((0, 0), (half, half), (half, half)),
        mode="edge",
    )
    return padded[:, j0 + half : j0 + half + config.patch_px, i0 + half : i0 + half + config.patch_px]


def merge_candidates(
    candidates: Sequence[Candidate], radius_mm: float, max_candidates: int
) -> list[Candidate]:
    """Collapse detections of the same thing, keeping the strongest.

    Greedy suppression by centre distance in *millimetres*: highest score
    first, and anything within the radius of an already-kept candidate is
    absorbed into it. Distance rather than box overlap because a candidate is
    a point — there are no boxes to intersect — and millimetres rather than
    voxels so the behaviour does not change with the acquisition's spacing.

    Deterministic: ties in score are broken by position, so the same input
    always gives the same output.
    """
    ordered = sorted(
        candidates,
        key=lambda c: (-c.score_raw, c.voxel_k, round(c.voxel_j, 4), round(c.voxel_i, 4)),
    )
    kept: list[Candidate] = []
    for candidate in ordered:
        absorbed = False
        for winner in kept:
            distance = math.sqrt(
                (candidate.x_mm - winner.x_mm) ** 2
                + (candidate.y_mm - winner.y_mm) ** 2
                + (candidate.z_mm - winner.z_mm) ** 2
            )
            if distance <= radius_mm:
                winner.merged_from += 1
                absorbed = True
                break
        if not absorbed:
            kept.append(candidate)
        if len(kept) >= max_candidates:
            break
    return kept


def detect_candidates(
    volume: "CtVolume",
    prepared: np.ndarray,
    lung_mask: "LungMask | None",
    *,
    config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
    detector: CandidateDetector | None = None,
    allow_without_mask: bool = False,
) -> DetectionResult:
    """Search a prepared volume for candidate locations.

    `volume` supplies the coordinate frame, `prepared` the model input from
    `inference/detection_preprocess.py`, and `lung_mask` the search
    constraint.

    Raises `DetectorUnavailable` when there is no model. It never returns an
    empty result to mean that: an empty candidate list means the volume was
    searched and nothing scored above the threshold, and a caller must be able
    to tell the two apart.
    """
    model = detector if detector is not None else registered_detector()
    if model is None:
        raise DetectorUnavailable(
            "model_unavailable",
            "No candidate detector is registered, so no search was performed. This is not a "
            "negative result: the volume has not been examined.",
        )

    warnings: list[str] = []
    if lung_mask is None:
        if not allow_without_mask:
            raise DetectorUnavailable(
                "lung_mask_unavailable",
                "The lung-region constraint could not be produced for this volume, so a "
                "search would propose candidates in the heart, the chest wall and the air "
                "around the patient. No search was performed.",
            )
        warnings.append(
            "Searched without the lung-region constraint. Candidates may lie outside the "
            "lungs and the false-positive rate is not the one any validation measured."
        )

    positions = _window_positions(prepared.shape, config)  # type: ignore[arg-type]
    searched = 0
    patches: list[np.ndarray] = []
    located: list[tuple[int, int, int]] = []

    for k, j, i in positions:
        if lung_mask is not None and not lung_mask.contains(i, j, min(k, volume.shape[0] - 1)):
            continue
        searched += 1
        patches.append(_extract_patch(prepared, k, j, i, config))
        located.append((k, j, i))

    if not patches:
        return DetectionResult(
            candidates=[],
            detector_version=getattr(model, "version", "unknown"),
            config=config,
            positions_searched=0,
            positions_scored=0,
            warnings=warnings
            + [
                "No search position fell inside the lung-region constraint, so nothing was "
                "scored. This is not evidence that the study is clear."
            ],
        )

    scores = np.asarray(model.score_batch(np.stack(patches)), dtype=np.float64)
    if scores.shape[0] != len(patches):
        raise DetectorUnavailable(
            "detector_contract_violated",
            f"The detector returned {scores.shape[0]} scores for {len(patches)} patches. "
            "A result cannot be matched to a location.",
            {"expected": len(patches), "received": int(scores.shape[0])},
        )

    proposals: list[Candidate] = []
    for (k, j, i), score in zip(located, scores):
        if score < config.score_threshold:
            continue
        # The prepared volume may sit on a different z grid from the source
        # series, so the reviewable slice is resolved through patient space
        # rather than assumed equal to k.
        slice_index = min(k, volume.shape[0] - 1)
        x_mm, y_mm, z_mm = volume.voxel_to_patient(i, j, slice_index)
        proposals.append(
            Candidate(
                voxel_i=float(i),
                voxel_j=float(j),
                voxel_k=int(k),
                x_mm=float(x_mm),
                y_mm=float(y_mm),
                z_mm=float(z_mm),
                score_raw=float(score),
                position_index=int(slice_index),
            )
        )

    merged = merge_candidates(proposals, config.merge_radius_mm, config.max_candidates)
    if len(proposals) > len(merged):
        warnings.append(
            f"{len(proposals)} proposals merged to {len(merged)} by {config.merge_radius_mm} mm "
            "suppression."
        )
    if len(merged) >= config.max_candidates:
        warnings.append(
            f"The candidate list was capped at {config.max_candidates}. A study producing this "
            "many proposals is not a normal result and should be reviewed as a whole."
        )

    return DetectionResult(
        candidates=merged,
        detector_version=getattr(model, "version", "unknown"),
        config=config,
        positions_searched=searched,
        positions_scored=len(patches),
        warnings=warnings,
    )
