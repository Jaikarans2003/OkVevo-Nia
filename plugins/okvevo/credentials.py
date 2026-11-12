"""OkVevo credential helper — one token file, read at request time.

The desktop refresh loop writes the Firebase ID token and refresh token under
the root Hermes home. Profile backends must not keep a copy in ``.env``:
that snapshot expires after an hour and chat 401s. This module is the
plugin-side half of upstream's credential pool (``refresh_credential`` plus
``load_pool().add_entry`` / ``remove_index`` / ``reset_statuses``).
"""

from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

# ``manual:`` is an owned source: the pool keeps the row on disk and will
# not drop it on reload. A borrowed source strips the secret, and the
# 401 refresh hook then has no row to refresh.
POOL_SOURCE = "manual:okvevo-desktop"
_ENV_KEY = "OKVEVO_API_KEY"

# The row never holds a token: the desktop-owned files are the only durable
# copies (a copied JWT is a stale second secret within the hour). Both secret
# fields carry this marker so upstream resolution
# (``hermes_cli.auth._resolve_api_key_provider_secret``) sees a usable
# credential; the wire key is re-read from the file per request by the
# provider profile's ``api_key`` callable.
FILE_BACKED_CREDENTIAL = "okvevo-file"


def strip_okvevo_api_key_copies(home: str | None = None) -> None:
    """Delete ``OKVEVO_API_KEY`` from this home's ``.env`` and drop it from the process."""
    os.environ.pop(_ENV_KEY, None)
    root = Path(home or os.environ.get("HERMES_HOME") or "").expanduser()
    if not str(root):
        return
    _strip_file(root / ".env")
    profiles = root / "profiles"
    if not profiles.is_dir():
        return
    for child in profiles.iterdir():
        if child.is_dir():
            _strip_file(child / ".env")


def _strip_file(path: Path) -> None:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    kept = [line for line in text.splitlines() if not line.startswith(f"{_ENV_KEY}=")]
    if kept == text.splitlines():
        return
    try:
        path.write_text(("\n".join(kept) + "\n") if kept else "", encoding="utf-8")
    except OSError as exc:
        logger.warning("okvevo could not remove %s from %s: %s", _ENV_KEY, path, exc)


def ensure_okvevo_pool_entry() -> None:
    """One OAuth pool row witnessing the desktop token files. Holds no token copy."""
    strip_okvevo_api_key_copies()
    try:
        from plugins.okvevo.gateway import (
            ensure_okvevo_id_token,
            id_token_exp_unix,
        )
    except Exception:
        logger.debug("okvevo token helpers unavailable", exc_info=True)
        return
    token = ensure_okvevo_id_token()
    try:
        from agent.credential_pool import PooledCredential, load_pool
    except Exception:
        logger.debug("okvevo credential pool unavailable", exc_info=True)
        return
    try:
        pool = load_pool("okvevo")
    except Exception:
        logger.debug("okvevo pool load failed", exc_info=True)
        return
    _drop_env_entries(pool)
    current = next((entry for entry in pool.entries() if entry.source == POOL_SOURCE), None)
    if not token:
        # Signed out: a leftover row would resolve as a usable credential and
        # 401-loop instead of failing with the sign-in guidance.
        if current is not None:
            _remove_pool_source_entry(pool)
        return
    # Do not copy the token into OKVEVO_API_KEY or the row itself. ``load_pool``
    # would ingest the env copy as an api_key row, and the first 401
    # force-benches an api_key row before the OAuth refresh hook runs. A legacy
    # row holding a copied token is scrubbed here. The catalog resolver falls
    # through to this row; chat reads the file per request.
    if (
        current is not None
        and current.access_token == FILE_BACKED_CREDENTIAL
        and (current.refresh_token or "") == FILE_BACKED_CREDENTIAL
    ):
        return
    if current is not None:
        _remove_pool_source_entry(pool)
    exp = id_token_exp_unix(token)
    pool.add_entry(
        PooledCredential(
            provider="okvevo",
            id=uuid.uuid4().hex[:6],
            label="OkVevo",
            auth_type="oauth",
            priority=0,
            source=POOL_SOURCE,
            access_token=FILE_BACKED_CREDENTIAL,
            refresh_token=FILE_BACKED_CREDENTIAL,
            expires_at_ms=int(exp * 1000) if exp else None,
        )
    )


def _remove_pool_source_entry(pool) -> None:
    index = next(
        (i for i, entry in enumerate(pool.entries(), start=1) if entry.source == POOL_SOURCE),
        None,
    )
    if index is not None:
        pool.remove_index(index)


def reset_okvevo_pool_status() -> int:
    """Same clear as ``hermes auth reset okvevo`` for this process's pool."""
    try:
        from agent.credential_pool import load_pool

        return int(load_pool("okvevo").reset_statuses())
    except Exception:
        logger.debug("okvevo pool reset failed", exc_info=True)
        return 0


def _drop_env_entries(pool) -> None:
    while True:
        index = next(
            (i for i, entry in enumerate(pool.entries(), start=1) if str(entry.source).startswith("env:")),
            None,
        )
        if index is None:
            return
        pool.remove_index(index)
