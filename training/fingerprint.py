"""
One way to fingerprint things, used by every part of the harness.

A fingerprint is SHA-256 over canonical JSON — sorted keys, fixed separators,
no whitespace — so it depends on the values and nothing else. Dictionary
order, file formatting and platform line endings cannot move it.

The full 64-hex digest is kept wherever something is stored. The 16-hex prefix
exists only for display, matching the split manifest's convention, and is
never used as an identity.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_json(payload: Any) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def sha256_file(path: str, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def short(digest: str) -> str:
    """For display only."""
    return digest[:16]
