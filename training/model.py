"""
The candidate detector's architecture. An architecture — not a trained model.

── What it computes ───────────────────────────────────────────────────────

The 2.5D design the service already committed to in
`inference/detection_service.py`: a (channels, patch, patch) stack of adjacent
HU slices in, one logit out. The sigmoid of that logit is a *candidate
score* — how strongly the network associates the patch centre with a location
a radiologist marked. It is not a probability of cancer, of malignancy, or of
anything clinical, and it is not calibrated.

    input   (N, 3, 64, 64)   three adjacent slices, HU clipped and scaled
    blocks  conv3x3-BN-ReLU x2, then 2x2 max-pool, per configured width
    head    global average pool -> dropout -> linear -> 1 logit

Deliberately plain. The first question a real run has to answer is whether
the data and labels support a detector at all, and an elaborate network would
make a failure harder to attribute.

── Four states, kept apart ────────────────────────────────────────────────

`LungNoduleCandidateNet()` is MODEL ARCHITECTURE: randomly initialised
weights that encode nothing. A TRAINED CHECKPOINT is what
`training/checkpoint.py` writes after a run, marked TRAINED_UNVALIDATED. A
VALIDATED RESEARCH MODEL needs an approved localisation methodology and an
evaluation that has not happened. A CLINICALLY VALIDATED MODEL needs clinical
evidence that does not exist. Nothing in this module moves anything between
those states.

── The architecture fingerprint ───────────────────────────────────────────

Covers the specification and every parameter's name and shape — what the
network *is* — and deliberately not the weights, which are what training
changes. The weight fingerprint is the checkpoint's job.
"""
from __future__ import annotations

from typing import Any, Dict, List, Sequence

import torch
from torch import nn

from training.fingerprint import sha256_json

ARCHITECTURE = "lung-nodule-candidate-2p5d-cnn"
ARCHITECTURE_VERSION = "arch-v1"
STATE_ARCHITECTURE_ONLY = "MODEL_ARCHITECTURE_UNTRAINED"


class ModelInvalid(Exception):
    pass


def _block(in_channels: int, out_channels: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=False),
        nn.BatchNorm2d(out_channels),
        nn.ReLU(inplace=True),
        nn.Conv2d(out_channels, out_channels, kernel_size=3, padding=1, bias=False),
        nn.BatchNorm2d(out_channels),
        nn.ReLU(inplace=True),
        nn.MaxPool2d(2),
    )


class LungNoduleCandidateNet(nn.Module):
    def __init__(self, channels: int = 3, patch_px: int = 64,
                 widths: Sequence[int] = (32, 64, 128, 256), dropout: float = 0.2):
        super().__init__()
        if channels < 1 or channels % 2 == 0:
            raise ModelInvalid("channels must be a positive odd number, got %d" % channels)
        if not widths:
            raise ModelInvalid("at least one block width is required")
        if patch_px % (2 ** len(widths)) != 0:
            raise ModelInvalid(
                "patch_px %d must be divisible by 2^%d for %d pooling blocks"
                % (patch_px, len(widths), len(widths))
            )
        self.channels = channels
        self.patch_px = patch_px
        self.widths = list(widths)
        self.dropout_p = float(dropout)

        blocks: List[nn.Module] = []
        previous = channels
        for width in widths:
            blocks.append(_block(previous, width))
            previous = width
        self.features = nn.Sequential(*blocks)
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(previous, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if x.dim() != 4 or x.shape[1] != self.channels or x.shape[2] != self.patch_px \
                or x.shape[3] != self.patch_px:
            raise ModelInvalid(
                "expected (N, %d, %d, %d), got %s"
                % (self.channels, self.patch_px, self.patch_px, tuple(x.shape))
            )
        features = self.pool(self.features(x)).flatten(1)
        return self.head(self.dropout(features)).squeeze(1)

    def spec(self) -> Dict[str, Any]:
        return {
            "architecture": ARCHITECTURE,
            "version": ARCHITECTURE_VERSION,
            "channels": self.channels,
            "patchPx": self.patch_px,
            "widths": self.widths,
            "dropout": self.dropout_p,
        }


def build(config: Dict[str, Any]) -> LungNoduleCandidateNet:
    model_section = config["model"]
    if model_section.get("architecture") != ARCHITECTURE:
        raise ModelInvalid("unknown architecture %r" % model_section.get("architecture"))
    if model_section.get("version") != ARCHITECTURE_VERSION:
        raise ModelInvalid("unknown architecture version %r" % model_section.get("version"))
    return LungNoduleCandidateNet(
        channels=int(config["patch"]["channels"]),
        patch_px=int(config["patch"]["patch_px"]),
        widths=[int(w) for w in model_section["widths"]],
        dropout=float(model_section["dropout"]),
    )


def parameter_count(model: nn.Module) -> int:
    return int(sum(p.numel() for p in model.parameters()))


def architecture_fingerprint(model: LungNoduleCandidateNet) -> str:
    """What the network is, independent of what it has learned."""
    shapes = [(name, list(tensor.shape)) for name, tensor in sorted(model.state_dict().items())]
    return sha256_json({"spec": model.spec(), "parameters": shapes})


def candidate_scores(model: nn.Module, patches: torch.Tensor) -> torch.Tensor:
    """Sigmoid of the logits: a raw candidate score in [0, 1]. Uncalibrated."""
    model.eval()
    with torch.no_grad():
        return torch.sigmoid(model(patches))
