"""
Checkpoints: what they contain, how they are identified, and what they are
allowed to call themselves.

── Identity is the weights, not the filename ──────────────────────────────

`weights_fingerprint` is SHA-256 over every tensor in the model's state dict —
name, dtype, shape and raw bytes, in sorted key order. Rename the file and the
fingerprint is unchanged; change one weight and it is not. It is stored in the
checkpoint and recomputed on every load, so a checkpoint whose weights no
longer match its own record is refused rather than trusted.

The whole-file SHA-256 cannot live inside the file it hashes, so it is written
to a sidecar `<name>.sha256.json` next to it, which is what the experiment
manifest and any later model registration cite.

── Status ─────────────────────────────────────────────────────────────────

A checkpoint written by this harness is one of two things:

    TRAINED_UNVALIDATED   produced by a real training run on LIDC data
    TEST_ARTIFACT         produced from synthetic data by the test suite

Nothing here writes VALIDATED_RESEARCH_MODEL or CLINICALLY_VALIDATED. Those
are reached through evaluation and governance that have not happened, and a
checkpoint that claims either is refused on load unless the caller explicitly
says it is reading a governed artifact — which this harness never does.

── Safe loading ───────────────────────────────────────────────────────────

Loaded with `torch.load(..., weights_only=True)`, which refuses arbitrary
pickled objects, so a tampered checkpoint cannot execute code on the machine
that opens it. Everything stored is therefore tensors, numbers, strings,
lists and dicts; RNG state is converted to that form before saving.
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Dict, Optional

import numpy as np

from training.fingerprint import sha256_file

CHECKPOINT_FORMAT = "healthai-lung-detector-checkpoint-v1"

STATUS_TRAINED_UNVALIDATED = "TRAINED_UNVALIDATED"
STATUS_TEST_ARTIFACT = "TEST_ARTIFACT"
STATUS_VALIDATED_RESEARCH = "VALIDATED_RESEARCH_MODEL"
STATUS_CLINICALLY_VALIDATED = "CLINICALLY_VALIDATED"

WRITABLE_STATUSES = (STATUS_TRAINED_UNVALIDATED, STATUS_TEST_ARTIFACT)
GOVERNED_STATUSES = (STATUS_VALIDATED_RESEARCH, STATUS_CLINICALLY_VALIDATED)

REQUIRED_METADATA = (
    "git_commit",
    "dataset_fingerprint",
    "split_fingerprint",
    "model_fingerprint",
    "preprocessing_fingerprint",
    "training_config_fingerprint",
    "environment_fingerprint",
    "seed",
    "epoch",
)


class CheckpointInvalid(Exception):
    pass


def weights_fingerprint(state_dict: Dict[str, Any]) -> str:
    import torch

    digest = hashlib.sha256()
    for name in sorted(state_dict):
        tensor = state_dict[name].detach().cpu().contiguous()
        digest.update(name.encode("utf-8"))
        digest.update(str(tensor.dtype).encode("ascii"))
        digest.update(json.dumps(list(tensor.shape)).encode("ascii"))
        if tensor.dtype == torch.bfloat16:
            # numpy has no bfloat16; the same bits viewed as int16 hash identically.
            tensor = tensor.view(torch.int16)
        digest.update(tensor.numpy().tobytes())
    return digest.hexdigest()


def rng_state() -> Dict[str, Any]:
    """Every RNG the harness uses, in a form weights_only loading accepts."""
    import random

    import torch

    np_state = np.random.get_state()
    version, keys, pos, has_gauss, cached = np_state
    state: Dict[str, Any] = {
        "python": [random.getstate()[0], list(random.getstate()[1]), random.getstate()[2]],
        "numpy": {"version": version, "keys": keys.tolist(), "pos": int(pos),
                  "hasGauss": int(has_gauss), "cached": float(cached)},
        "torch": torch.get_rng_state(),
    }
    if torch.cuda.is_available():
        state["cuda"] = torch.cuda.get_rng_state_all()
    return state


def restore_rng_state(state: Dict[str, Any]) -> None:
    import random

    import torch

    python = state["python"]
    random.setstate((python[0], tuple(python[1]), python[2]))
    numpy_state = state["numpy"]
    np.random.set_state((numpy_state["version"], np.asarray(numpy_state["keys"], dtype=np.uint32),
                         numpy_state["pos"], numpy_state["hasGauss"], numpy_state["cached"]))
    torch.set_rng_state(state["torch"])
    if "cuda" in state and torch.cuda.is_available():
        torch.cuda.set_rng_state_all(state["cuda"])


def save(path: str, *, model: Any, optimizer: Any, scheduler: Any, status: str,
         metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Write a checkpoint and its sidecar. Returns the sidecar record."""
    import torch

    if status not in WRITABLE_STATUSES:
        raise CheckpointInvalid(
            "the harness writes only %s; %r is reached through governance, not training"
            % (WRITABLE_STATUSES, status)
        )
    missing = [key for key in REQUIRED_METADATA if metadata.get(key) in (None, "")]
    if missing:
        raise CheckpointInvalid("checkpoint metadata is incomplete: %s" % ", ".join(missing))

    state = model.state_dict()
    record = {
        "format": CHECKPOINT_FORMAT,
        "status": status,
        "metadata": dict(metadata),
        "weights_fingerprint": weights_fingerprint(state),
        "model_state": state,
        "optimizer_state": optimizer.state_dict() if optimizer is not None else None,
        "scheduler_state": scheduler.state_dict() if scheduler is not None else None,
        "rng_state": rng_state(),
    }
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    temporary = path + ".partial"
    torch.save(record, temporary)
    os.replace(temporary, path)   # never leave a half-written checkpoint under the real name

    sidecar = {
        "format": CHECKPOINT_FORMAT,
        "status": status,
        "file": os.path.basename(path),
        "fileSha256": sha256_file(path),
        "weightsSha256": record["weights_fingerprint"],
        "metadata": dict(metadata),
    }
    with open(path + ".sha256.json", "w", encoding="utf-8") as handle:
        json.dump(sidecar, handle, indent=2, sort_keys=True)
    return sidecar


def load(path: str, *, allow_governed: bool = False) -> Dict[str, Any]:
    """Load, verify the format, the metadata and the weights fingerprint."""
    import torch

    if not os.path.exists(path):
        raise CheckpointInvalid("checkpoint not found: %s" % path)
    record = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(record, dict) or record.get("format") != CHECKPOINT_FORMAT:
        raise CheckpointInvalid("not a %s checkpoint" % CHECKPOINT_FORMAT)

    status = record.get("status")
    if status in GOVERNED_STATUSES and not allow_governed:
        raise CheckpointInvalid(
            "checkpoint claims %s; the training harness does not produce or consume governed "
            "artifacts" % status
        )
    if status not in WRITABLE_STATUSES + GOVERNED_STATUSES:
        raise CheckpointInvalid("unknown checkpoint status %r" % status)

    missing = [key for key in REQUIRED_METADATA if record.get("metadata", {}).get(key) in (None, "")]
    if missing:
        raise CheckpointInvalid("checkpoint metadata is incomplete: %s" % ", ".join(missing))

    recomputed = weights_fingerprint(record["model_state"])
    if recomputed != record.get("weights_fingerprint"):
        raise CheckpointInvalid(
            "the weights do not match the checkpoint's own fingerprint: recorded %s, "
            "recomputed %s" % (record.get("weights_fingerprint"), recomputed)
        )

    sidecar_path = path + ".sha256.json"
    if os.path.exists(sidecar_path):
        with open(sidecar_path, encoding="utf-8") as handle:
            sidecar = json.load(handle)
        if sidecar.get("fileSha256") != sha256_file(path):
            raise CheckpointInvalid("the file does not match its sidecar SHA-256")
    return record


def verify_sidecar(path: str) -> Optional[Dict[str, Any]]:
    sidecar_path = path + ".sha256.json"
    if not os.path.exists(sidecar_path):
        return None
    with open(sidecar_path, encoding="utf-8") as handle:
        return json.load(handle)
