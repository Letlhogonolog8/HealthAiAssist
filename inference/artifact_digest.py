"""
The fingerprint of a model artifact on disk, computed once per file version.

`/healthz` reports, for each resident model, the first 12 hex of the SHA-256 of
its artifact — the same value `server/model-fingerprint.ts` records against
every scan as `model_version`, so an operator can confirm that the service
serving predictions holds the artifact those rows name.

── Why this is cached ─────────────────────────────────────────────────────

It used to be recomputed on every call. Three artifacts, about 276 MB, read in
full each time: 4.0-4.4 s per `/healthz` warm on the development machine, while
`inferenceHealth()` in `server/inference-client.ts` gives the endpoint 3 s, so
readiness could report a running service as unreachable. Under memory pressure
the read itself raised MemoryError and `/healthz` answered 500 — observed during
a full test run on 2026-09-25, where it coincided with an ingestion test
failing.

── Why the cache cannot go stale ──────────────────────────────────────────

The key is the resolved path plus the file's size and modification time in
nanoseconds. Replacing or rewriting the artifact changes at least one of them,
so the next call hashes the new bytes. What is reported is still the file on
disk, exactly as before — this changes when the work is done, not what is
reported.

A failure is never cached: a file that could not be read this time is read
again next time, rather than reporting "unknown" until the process restarts.
"""
from __future__ import annotations

import hashlib
import os
import threading
from typing import Dict, Tuple

UNKNOWN = "unknown"
_CHUNK = 1024 * 1024

_lock = threading.Lock()
_cache: Dict[Tuple[str, int, int], str] = {}


def _key(path: str) -> Tuple[str, int, int]:
    resolved = os.path.realpath(path)
    stat = os.stat(resolved)
    return resolved, stat.st_size, stat.st_mtime_ns


def _hash(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()[:12]


def artifact_digest(path: str) -> str:
    """First 12 hex of SHA-256 of the file, or "unknown" if it cannot be read."""
    try:
        key = _key(path)
    except (OSError, TypeError, ValueError):
        return UNKNOWN
    with _lock:
        cached = _cache.get(key)
    if cached is not None:
        return cached
    try:
        value = _hash(key[0])
    except (OSError, MemoryError):
        return UNKNOWN
    with _lock:
        # Old versions of the same path are dropped, so a long-running service
        # that has its artifact replaced repeatedly does not accumulate keys.
        for stale in [k for k in _cache if k[0] == key[0] and k != key]:
            del _cache[stale]
        _cache[key] = value
    return value


def clear() -> None:
    """For tests."""
    with _lock:
        _cache.clear()
