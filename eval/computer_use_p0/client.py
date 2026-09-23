"""JSON-RPC WS client matching apps/shared/src/json-rpc-gateway.ts (newline JSON-RPC)."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Optional

from discover import ws_url
from tasks import is_alias_model

# skill_view / skills_list load instructions. D7 scores the next real tool.
NEUTRAL_TOOLS = frozenset({"skill_view", "skills_list"})
_TOOL_EVENTS = frozenset({"tool.start", "tool.generating", "tool.complete"})


def _payload(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload") or {}
    return payload if isinstance(payload, dict) else {}


def _tool_name(event: dict[str, Any]) -> str:
    payload = _payload(event)
    return str(payload.get("name") or payload.get("tool") or "")


def _tool_args(payload: dict[str, Any]) -> dict[str, Any]:
    args = payload.get("args")
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except json.JSONDecodeError:
            return {}
    return args if isinstance(args, dict) else {}


def first_named_tool(events: list[dict[str, Any]], *, neutral: frozenset[str]) -> str:
    for event in events:
        if event.get("type") not in _TOOL_EVENTS:
            continue
        name = _tool_name(event)
        if name and name not in neutral:
            return name
    return ""


def observed_models(events: list[dict[str, Any]]) -> list[str]:
    """Response model ids. Drops Auto aliases such as okvevo/auto-cost."""
    found: list[str] = []
    for event in events:
        payload = _payload(event)
        candidates: list[Any] = []
        for key in ("response_model", "routed_model"):
            if payload.get(key):
                candidates.append(payload[key])
        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        for key in ("response_model", "resolved_model", "model"):
            if usage.get(key):
                candidates.append(usage[key])
        for raw in candidates:
            name = str(raw).strip()
            if not name or is_alias_model(name):
                continue
            if not found or found[-1] != name:
                found.append(name)
    return found


def latest_usage(events: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for event in events:
        if event.get("type") not in {"session.usage", "message.complete"}:
            continue
        usage = _payload(event).get("usage")
        if isinstance(usage, dict):
            out = usage
    return out


def screenshot_count(events: list[dict[str, Any]]) -> int:
    """computer_use captures. ``capture`` and ``capture_after`` each count as one."""
    by_id: dict[str, dict[str, Any]] = {}
    loose: list[dict[str, Any]] = []
    for event in events:
        if event.get("type") not in {"tool.start", "tool.complete"}:
            continue
        payload = _payload(event)
        if _tool_name(event) != "computer_use":
            continue
        args = _tool_args(payload)
        tool_id = str(payload.get("tool_id") or "")
        if tool_id:
            slot = by_id.setdefault(tool_id, {})
            if event.get("type") == "tool.complete" or "args" not in slot:
                slot["args"] = args
        elif event.get("type") == "tool.complete":
            loose.append(args)
    total = 0
    for args in [slot.get("args") or {} for slot in by_id.values()]:
        total += _shot_count(args)
    for args in loose:
        total += _shot_count(args)
    return total


def _shot_count(args: dict[str, Any]) -> int:
    count = 1 if str(args.get("action") or "") == "capture" else 0
    flag = args.get("capture_after")
    if flag is True or str(flag).lower() == "true":
        count += 1
    return count


def credits_from_usage(usage: dict[str, Any] | None) -> str:
    if not isinstance(usage, dict):
        return ""
    for key in ("okvevo_credits", "credits_spent", "credits"):
        if usage.get(key) not in (None, ""):
            return _fmt_credits(usage.get(key))
    micro = usage.get("dev_credits_spent_micros")
    if micro not in (None, ""):
        try:
            return _fmt_credits(int(micro) / 1_000_000)
        except (TypeError, ValueError):
            return str(micro)
    return ""


def _fmt_credits(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if number == int(number):
        return str(int(number))
    return str(round(number, 4))


def budget_exceeded(usage: dict[str, Any] | None, max_turns: int, max_tokens: int) -> bool:
    if not isinstance(usage, dict):
        return False
    calls = _as_int(usage.get("calls"))
    tokens = _as_int(usage.get("total"))
    if max_turns and calls >= max_turns:
        return True
    if max_tokens and tokens >= max_tokens:
        return True
    return False


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


async def _connect(url: str):
    try:
        from websockets.asyncio.client import connect

        return await connect(url, max_size=32 * 1024 * 1024)
    except ImportError:
        import websockets

        return await websockets.connect(url, max_size=32 * 1024 * 1024)


class Gateway:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url
        self.token = token
        self._ws = None
        self._n = 0
        self._pending: dict[int, asyncio.Future] = {}
        self.events: list[dict[str, Any]] = []
        self._pump: Optional[asyncio.Task] = None
        self._usage_rpc: dict[str, dict[str, Any]] = {}

    async def connect(self) -> None:
        self._ws = await _connect(ws_url(self.base_url, self.token))
        self._pump = asyncio.create_task(self._read_loop())

    async def close(self) -> None:
        if self._pump:
            self._pump.cancel()
        if self._ws is not None:
            await self._ws.close()

    async def _read_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                text = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw)
                for line in text.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        frame = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    self._handle_frame(frame)
        except asyncio.CancelledError:
            return

    def _handle_frame(self, frame: dict[str, Any]) -> None:
        rid = frame.get("id")
        if rid is not None and rid in self._pending:
            fut = self._pending.pop(rid)
            if frame.get("error"):
                fut.set_exception(RuntimeError(json.dumps(frame["error"])[:500]))
            else:
                fut.set_result(frame.get("result"))
            return
        if frame.get("method") == "event" and isinstance(frame.get("params"), dict):
            self.events.append(frame["params"])
            payload = frame["params"].get("payload") or {}
            et = frame["params"].get("type")
            if et == "approval.request":
                sid = frame["params"].get("session_id")
                req_id = payload.get("request_id")
                if sid:
                    asyncio.create_task(
                        self.request(
                            "approval.respond",
                            {
                                "session_id": sid,
                                "request_id": req_id,
                                "choice": "session",
                            },
                        )
                    )

    async def request(self, method: str, params: dict | None = None, timeout: float = 60) -> Any:
        assert self._ws is not None
        self._n += 1
        rid = self._n
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending[rid] = fut
        await self._ws.send(
            json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}})
        )
        return await asyncio.wait_for(fut, timeout)

    def events_for(self, session_id: str) -> list[dict[str, Any]]:
        return [e for e in self.events if e.get("session_id") == session_id]

    def first_tool(self, session_id: str) -> Optional[str]:
        return first_named_tool(self.events_for(session_id), neutral=frozenset()) or None

    def first_action_tool(self, session_id: str) -> str:
        return first_named_tool(self.events_for(session_id), neutral=NEUTRAL_TOOLS)

    def complete(self, session_id: str) -> Optional[dict[str, Any]]:
        for e in reversed(self.events_for(session_id)):
            if e.get("type") == "message.complete":
                return e.get("payload") or {}
        return None

    def routed_model(self, session_id: str) -> str:
        """Concrete response models only. The okvevo/auto-* alias is not a route."""
        return ";".join(observed_models(self.events_for(session_id)))

    def latest_usage(self, session_id: str) -> dict[str, Any]:
        return latest_usage(self.events_for(session_id))

    def screenshot_count(self, session_id: str) -> int:
        return screenshot_count(self.events_for(session_id))

    def usage(self, session_id: str) -> dict[str, Any]:
        payload = self.complete(session_id) or {}
        out = dict(payload.get("usage") or {})
        extra = self._usage_rpc.get(session_id)
        if isinstance(extra, dict):
            merged = dict(extra)
            merged.update({k: v for k, v in out.items() if v not in (None, "", 0)})
            return merged
        return out

    async def refresh_usage(self, session_id: str) -> dict[str, Any]:
        if not hasattr(self, "_usage_rpc"):
            self._usage_rpc = {}
        try:
            snap = await self.request("session.usage", {"session_id": session_id}, timeout=15)
        except Exception:
            snap = {}
        if isinstance(snap, dict):
            self._usage_rpc[session_id] = snap
        return snap if isinstance(snap, dict) else {}


async def wait_until(
    pred, timeout: float, interval: float = 0.2
) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pred():
            return True
        await asyncio.sleep(interval)
    return pred()
