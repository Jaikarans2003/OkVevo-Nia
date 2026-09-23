"""OkVevo credit ledger reads for one P0 run.

Uses the signed-in Firebase ID token already on disk (same file the desktop
backend sets). Never logs the token. Returns empty when signed out.
"""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote


def _read_token() -> str:
    path = (os.environ.get("OKVEVO_FIREBASE_ID_TOKEN_FILE") or "").strip()
    if not path:
        path = str(Path.home() / ".hermes" / "okvevo-firebase-id-token")
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def claims_from_token(token: str) -> tuple[str, str]:
    """Return (firebase project id, uid) from the JWT payload. No signature check."""
    parts = str(token or "").split(".")
    if len(parts) < 2:
        return "", ""
    pad = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        data = json.loads(base64.urlsafe_b64decode(pad.encode("ascii")))
    except (ValueError, json.JSONDecodeError):
        return "", ""
    if not isinstance(data, dict):
        return "", ""
    aud = data.get("aud")
    project = aud if isinstance(aud, str) else ""
    if isinstance(aud, list) and aud and isinstance(aud[0], str):
        project = aud[0]
    uid = data.get("user_id") or data.get("sub") or ""
    if not isinstance(uid, str):
        uid = ""
    if "/" in project or " " in project:
        project = ""
    return project, uid


def _field(fields: dict[str, Any], name: str) -> Any:
    raw = fields.get(name)
    if not isinstance(raw, dict):
        return None
    if "stringValue" in raw:
        return raw["stringValue"]
    if "integerValue" in raw:
        try:
            return int(raw["integerValue"])
        except (TypeError, ValueError):
            return None
    if "doubleValue" in raw:
        try:
            return float(raw["doubleValue"])
        except (TypeError, ValueError):
            return None
    if "timestampValue" in raw:
        return raw["timestampValue"]
    return None


def parse_balance(doc: dict[str, Any] | None) -> dict[str, int] | None:
    if not isinstance(doc, dict):
        return None
    fields = doc.get("fields")
    if not isinstance(fields, dict):
        return None
    if "allocationBalance" not in fields and "topUpBalance" not in fields:
        return None
    alloc = _field(fields, "allocationBalance")
    top = _field(fields, "topUpBalance")
    return {
        "allocationBalance": int(alloc or 0),
        "topUpBalance": int(top or 0),
    }


def balance_spent(before: dict[str, int] | None, after: dict[str, int] | None) -> int | None:
    if not before or not after:
        return None
    start = int(before["allocationBalance"]) + int(before["topUpBalance"])
    end = int(after["allocationBalance"]) + int(after["topUpBalance"])
    if end > start:
        return None
    return start - end


def parse_transactions(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    docs = payload.get("documents")
    if not isinstance(docs, list):
        return []
    out = []
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        fields = doc.get("fields")
        if not isinstance(fields, dict):
            continue
        created = _parse_time(_field(fields, "createdAt"))
        amount = _field(fields, "amount")
        model = _field(fields, "model")
        kind = _field(fields, "type")
        out.append(
            {
                "created_at": created,
                "amount": amount if isinstance(amount, (int, float)) else None,
                "model": str(model).strip() if isinstance(model, str) else "",
                "type": str(kind).strip() if isinstance(kind, str) else "",
            }
        )
    return out


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def window_debits(txns: list[dict[str, Any]], start: datetime) -> list[dict[str, Any]]:
    """Debits at or after ``start`` (2s slack), oldest first."""
    floor = start.astimezone(timezone.utc) - timedelta(seconds=2)
    picked = []
    for txn in txns:
        kind = txn.get("type") or "debit"
        if kind != "debit":
            continue
        created = txn.get("created_at")
        if not isinstance(created, datetime) or created < floor:
            continue
        if txn.get("amount") is None:
            continue
        picked.append(txn)
    picked.sort(key=lambda row: row["created_at"])
    return picked


def summarize_debits(txns: list[dict[str, Any]]) -> tuple[str, list[str]]:
    if not txns:
        return "", []
    total = 0.0
    models: list[str] = []
    for txn in txns:
        total += float(txn["amount"])
        model = str(txn.get("model") or "").strip()
        if model:
            models.append(model)
    credits = str(int(total)) if total == int(total) else str(round(total, 4))
    return credits, models


def _get_json(url: str, token: str) -> dict[str, Any] | None:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError, ValueError):
        return None
    return body if isinstance(body, dict) else None


class RunLedger:
    """Balance snapshot plus debit rows for one harness turn."""

    def __init__(self) -> None:
        self.ready = False
        self._token = ""
        self._project = ""
        self._uid = ""
        self._before: dict[str, int] | None = None
        self.started_at = datetime.now(timezone.utc)

    def open(self) -> None:
        token = _read_token()
        project, uid = claims_from_token(token)
        if not token or not project or not uid:
            return
        self._token = token
        self._project = project
        self._uid = uid
        self.ready = True
        self.started_at = datetime.now(timezone.utc)
        self._before = parse_balance(self._user_doc())

    def finish(self) -> tuple[str, list[str]]:
        if not self.ready:
            return "", []
        debits = window_debits(parse_transactions(self._txns()), self.started_at)
        credits, models = summarize_debits(debits)
        if credits:
            return credits, models
        spent = balance_spent(self._before, parse_balance(self._user_doc()))
        if spent is None:
            return "", models
        return str(spent), models

    def _user_doc(self) -> dict[str, Any] | None:
        uid = quote(self._uid, safe="")
        url = (
            "https://firestore.googleapis.com/v1/projects/"
            f"{quote(self._project, safe='')}/databases/(default)/documents/users/{uid}"
        )
        return _get_json(url, self._token)

    def _txns(self) -> dict[str, Any] | None:
        uid = quote(self._uid, safe="")
        url = (
            "https://firestore.googleapis.com/v1/projects/"
            f"{quote(self._project, safe='')}/databases/(default)/documents/users/{uid}"
            "/creditTransactions?pageSize=40"
            # ponytail: unordered cap of 40. A busy account can miss this run's
            # debit; credits then fall back to the balance delta. Upgrade path:
            # orderBy=createdAt desc once that Firestore index exists.
        )
        return _get_json(url, self._token)
