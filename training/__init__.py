"""
Lung nodule candidate detector: the training harness.

── What this package is ───────────────────────────────────────────────────

The infrastructure that would train the 2.5D candidate detector whose empty
slot `inference/detection_service.py` already defines: dataset loading from
the committed patient-disjoint split, HU volumes through the same validated
path the service uses, deterministic sampling and augmentation, the model
architecture, the training loop, checkpoints and experiment manifests, each
carrying a fingerprint.

── What it is not ─────────────────────────────────────────────────────────

It is not a trained detector, and nothing in it produces one on this machine.
Four states are kept apart everywhere in this package, because a reader who
confuses them draws a conclusion the evidence does not support:

    MODEL ARCHITECTURE            code that defines a network         — exists
    TRAINED CHECKPOINT            weights produced by a training run  — absent
    VALIDATED RESEARCH MODEL      a checkpoint evaluated under an
                                  approved methodology                — absent
    CLINICALLY VALIDATED MODEL    evidence from clinical use          — absent

── The boundary with the service ──────────────────────────────────────────

Imports run one way. This package imports from `inference/` — series
assembly, the quality gate, the volume builder, the lung mask and the
detector preprocessing — so that training and serving cannot drift apart.
Nothing in `inference/` imports from here, and a test asserts it: training is
never in the request path.

The code stays importable under the service's Python 3.8 so that the whole
harness is covered by the existing test suite. Real training runs in the
separate ≥3.10 environment described in `inference/py310/README.md`, with the
stack pinned in `training/requirements-training.txt`.
"""

HARNESS_VERSION = "lung-detector-harness-v1"
