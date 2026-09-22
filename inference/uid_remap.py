"""
Deterministic, salted UID remapping for de-identified DICOM.

── The problem this solves ────────────────────────────────────────────────

`deidentify()` replaced every instance-level UID with a fresh random one. That
is safe — no join key back to the source PACS survives — and it destroys the
only thing that says these fifty objects are one series and those three series
are one study. A series cannot be assembled from objects whose SeriesInstanceUID
was randomised on the way in.

Remapping fixes that, and reintroduces a risk the randomisation did not have:
a *reversible* mapping is a join key. A plain hash of the UID is reversible in
practice — the UID space a given site emits is small and enumerable, so an
attacker with the mapping function can hash every candidate and match. The
mapping therefore has to be keyed with a secret the attacker does not have.

── What this produces ─────────────────────────────────────────────────────

    HMAC-SHA256(salt, "<kind>|<original uid>") -> 128 bits
      -> stamped with RFC 4122 version 4 and variant bits
      -> "2.25." + the decimal of that 128-bit integer

`2.25.<uuid as decimal integer>` is the UUID-derived UID root defined in
DICOM PS3.5 Annex B.2, so the result is a conformant UID that needs no
registered organisational root: 5 characters of prefix and at most 39 digits,
against the 64-character limit. The version and variant bits are stamped so
the value really is a UUID rather than merely 128 bits in a UUID's slot.

Properties, each covered by a test in inference/tests/test_uid_remap.py:

  deterministic   the same UID and salt always give the same output, so a
                  series uploaded in two batches assembles into one series
  unlinkable      without the salt the mapping cannot be inverted or replayed
  collision-free  128 bits of HMAC output; two UIDs colliding is not a
                  practical concern, and distinctness is asserted over the
                  whole LIDC-IDRI subset
  structural      Study, Series and SOP UIDs are remapped independently but
                  consistently, so the study/series/instance tree survives
  conformant      length, character set and component rules all hold

── The salt ───────────────────────────────────────────────────────────────

`DICOM_UID_SALT`, out of source control like every other secret here. Two
scopes, and the difference is stated in the ingestion result rather than
hidden:

  deployment   the variable is set. A study re-uploaded next month maps to the
               same de-identified UIDs and joins to what is already stored.
  ingestion    the variable is absent. A random salt is generated per process,
               so objects within one ingestion still assemble correctly but a
               later upload of the same study becomes a second, unrelated
               study.

The fallback is deliberately not a hard failure: de-identification is just as
strong either way — it is *linkage* that degrades, not safety — and refusing
to ingest anything on a machine with no salt configured would push people
towards turning de-identification off. It is reported, logged once, and
documented.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sys

# DICOM PS3.5 B.2: UUID-derived UIDs are "2.25." followed by the decimal
# representation of the UUID as a single integer.
UUID_ROOT = "2.25."
MAX_UID_LENGTH = 64

# Which secret is in use, and therefore how far the linkage reaches.
SCOPE_DEPLOYMENT = "deployment"
SCOPE_INGESTION = "ingestion"

# A salt shorter than this is not a secret. 32 bytes of hex is the shape
# `npm run secrets` already emits for the other keys in this project.
MIN_SALT_LENGTH = 32

_warned = False


def _resolve_salt() -> tuple[bytes, str]:
    """The salt, and the scope its use implies."""
    global _warned
    configured = (os.environ.get("DICOM_UID_SALT") or "").strip()
    if len(configured) >= MIN_SALT_LENGTH:
        return configured.encode("utf-8"), SCOPE_DEPLOYMENT

    if not _warned:
        _warned = True
        if configured:
            print(
                f"DICOM_UID_SALT is shorter than {MIN_SALT_LENGTH} characters and is being "
                "ignored; UID remapping falls back to a per-process salt.",
                file=sys.stderr,
            )
        else:
            print(
                "DICOM_UID_SALT is not set. UID remapping uses a per-process salt: objects "
                "within one ingestion still assemble into one series, but the same study "
                "uploaded again will become a separate de-identified study. Set "
                "DICOM_UID_SALT (>= 32 characters, kept out of source control) to make the "
                "mapping stable across uploads.",
                file=sys.stderr,
            )
    return _PROCESS_SALT, SCOPE_INGESTION


# Generated once per process, and only used when no salt is configured.
_PROCESS_SALT = secrets.token_bytes(32)


def uid_mapping_scope() -> str:
    """`deployment` or `ingestion` — reported with every ingestion result."""
    return _resolve_salt()[1]


def remap_uid(original: str, kind: str = "uid", salt: bytes | None = None) -> str:
    """One original UID to its de-identified replacement.

    `kind` is mixed into the input so that the same string appearing as, say,
    both a SeriesInstanceUID and a ReferencedSOPInstanceUID cannot be
    correlated across roles by anyone holding one mapping. It is part of the
    key, so a caller must pass the same `kind` to get the same output — which
    is why the tag keyword is used as the kind throughout the ingest path.
    """
    if not original:
        raise ValueError("Cannot remap an empty UID")

    key = salt if salt is not None else _resolve_salt()[0]
    digest = hmac.new(key, f"{kind}|{original}".encode("utf-8"), hashlib.sha256).digest()

    # Stamp RFC 4122 version 4 and the variant, so the 128 bits are a valid
    # UUID and not merely the right length.
    raw = bytearray(digest[:16])
    raw[6] = (raw[6] & 0x0F) | 0x40
    raw[8] = (raw[8] & 0x3F) | 0x80

    uid = UUID_ROOT + str(int.from_bytes(bytes(raw), "big"))
    if len(uid) > MAX_UID_LENGTH:  # pragma: no cover - arithmetically unreachable
        raise ValueError(f"Generated UID exceeds {MAX_UID_LENGTH} characters: {len(uid)}")
    return uid


def is_valid_dicom_uid(uid: str) -> bool:
    """PS3.5 Section 9.1: digits and dots, at most 64 characters, no empty
    component, and no leading zero in a component longer than one digit."""
    if not uid or len(uid) > MAX_UID_LENGTH:
        return False
    if uid.endswith(".") or uid.startswith("."):
        return False
    for component in uid.split("."):
        if not component or not component.isdigit():
            return False
        if len(component) > 1 and component[0] == "0":
            return False
    return True


class UidRemapper:
    """A remapping context: one salt, one cache, one reported scope.

    Instantiated per ingestion so the scope travels with the result, and so a
    test can pin a salt without touching the environment. The cache makes the
    per-instance cost negligible across a 300-slice series and guarantees that
    the same UID seen twice in one series maps identically even if the salt
    resolution were to change underneath it.
    """

    def __init__(self, salt: bytes | None = None, scope: str | None = None):
        if salt is None:
            salt, resolved_scope = _resolve_salt()
            scope = scope or resolved_scope
        self._salt = salt
        self.scope = scope or SCOPE_DEPLOYMENT
        self._cache: dict[tuple[str, str], str] = {}

    def __call__(self, original: str, kind: str = "uid") -> str:
        key = (kind, original)
        if key not in self._cache:
            self._cache[key] = remap_uid(original, kind=kind, salt=self._salt)
        return self._cache[key]

    @property
    def size(self) -> int:
        """How many distinct UIDs this context has mapped. Never the UIDs."""
        return len(self._cache)
