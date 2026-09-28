"""
inference/artifact_digest.py: /healthz's model fingerprints, computed once per
file version instead of on every call.

The property that matters is that caching changes when the work is done and
not what is reported: a replaced artifact must be reported by its new
fingerprint on the very next call.
"""
from __future__ import annotations

import hashlib
import os

import pytest

import artifact_digest as ad


@pytest.fixture(autouse=True)
def _fresh_cache():
    ad.clear()
    yield
    ad.clear()


def _write(path, data: bytes, mtime_ns=None):
    path.write_bytes(data)
    if mtime_ns is not None:
        os.utime(path, ns=(mtime_ns, mtime_ns))


def test_the_digest_is_the_first_twelve_hex_of_sha256(tmp_path):
    artifact = tmp_path / "model.h5"
    _write(artifact, b"weights" * 1000)
    assert ad.artifact_digest(str(artifact)) == hashlib.sha256(b"weights" * 1000).hexdigest()[:12]


def test_an_unchanged_file_is_read_once(tmp_path, monkeypatch):
    artifact = tmp_path / "model.h5"
    _write(artifact, b"a" * 5000)
    reads = []
    real = ad._hash
    monkeypatch.setattr(ad, "_hash", lambda p: reads.append(p) or real(p))
    first = ad.artifact_digest(str(artifact))
    for _ in range(5):
        assert ad.artifact_digest(str(artifact)) == first
    assert len(reads) == 1


def test_a_replaced_file_is_reported_by_its_new_fingerprint(tmp_path):
    """Same size, new content, new mtime: the swap a redeploy makes."""
    artifact = tmp_path / "model.h5"
    _write(artifact, b"a" * 4096, mtime_ns=1_700_000_000_000_000_000)
    before = ad.artifact_digest(str(artifact))
    _write(artifact, b"b" * 4096, mtime_ns=1_700_000_001_000_000_000)
    after = ad.artifact_digest(str(artifact))
    assert after != before
    assert after == hashlib.sha256(b"b" * 4096).hexdigest()[:12]


def test_a_resized_file_is_rehashed_even_with_its_old_mtime(tmp_path):
    artifact = tmp_path / "model.h5"
    _write(artifact, b"a" * 4096, mtime_ns=1_700_000_000_000_000_000)
    before = ad.artifact_digest(str(artifact))
    _write(artifact, b"a" * 4097, mtime_ns=1_700_000_000_000_000_000)
    assert ad.artifact_digest(str(artifact)) != before


def test_a_missing_file_is_unknown_and_not_remembered(tmp_path):
    artifact = tmp_path / "later.h5"
    assert ad.artifact_digest(str(artifact)) == ad.UNKNOWN
    _write(artifact, b"now it exists")
    assert ad.artifact_digest(str(artifact)) == hashlib.sha256(b"now it exists").hexdigest()[:12]


def test_a_read_that_runs_out_of_memory_is_unknown_not_an_exception(tmp_path, monkeypatch):
    """The failure seen on 2026-09-25: MemoryError mid-read made /healthz a 500."""
    artifact = tmp_path / "model.h5"
    _write(artifact, b"x" * 100)

    def _oom(_path):
        raise MemoryError

    monkeypatch.setattr(ad, "_hash", _oom)
    assert ad.artifact_digest(str(artifact)) == ad.UNKNOWN
    monkeypatch.undo()
    # Not cached: the next call succeeds.
    assert ad.artifact_digest(str(artifact)) == hashlib.sha256(b"x" * 100).hexdigest()[:12]


def test_a_path_that_is_not_a_path_is_unknown():
    assert ad.artifact_digest(None) == ad.UNKNOWN


def test_old_versions_of_a_path_are_dropped(tmp_path):
    artifact = tmp_path / "model.h5"
    for n in range(4):
        _write(artifact, bytes([n]) * 64, mtime_ns=1_700_000_000_000_000_000 + n)
        ad.artifact_digest(str(artifact))
    assert len([k for k in ad._cache if k[0] == os.path.realpath(str(artifact))]) == 1
