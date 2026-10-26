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

POOL_SOURCE = "okvevo-desktop"
_ENV_KEY = "OKVEVO_API_KEY"


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
    """One OAuth pool row backed by the desktop token files. Drops env snapshots."""
    strip_okvevo_api_key_copies()
    try:
        from plugins.okvevo.gateway import (
            ensure_okvevo_id_token,
            id_token_exp_unix,
            read_okvevo_refresh_token,
        )
    except Exception:
        logger.debug("okvevo token helpers unavailable", exc_info=True)
        return
    token = ensure_okvevo_id_token()
    if not token:
        return
    # Request-time credential. The .env files stay empty; this process env is
    # what the api_key resolver reads, and it is replaced on every refresh.
    os.environ[_ENV_KEY] = token
    refresh = read_okvevo_refresh_token() or "okvevo-file"
    exp = id_token_exp_unix(token)
    expires_at_ms = int(exp * 1000) if exp else None
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
    if current is not None and current.access_token == token and current.refresh_token:
        return
    if current is not None:
        index = next(
            (i for i, entry in enumerate(pool.entries(), start=1) if entry.source == POOL_SOURCE),
            None,
        )
        if index is not None:
            pool.remove_index(index)
    pool.add_entry(
        PooledCredential(
            provider="okvevo",
            id=uuid.uuid4().hex[:6],
            label="OkVevo",
            auth_type="oauth",
            priority=0,
            source=POOL_SOURCE,
            access_token=token,
            refresh_token=refresh,
            expires_at_ms=expires_at_ms,
        )
    )


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
