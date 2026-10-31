# Upstream Hermes issues we hit and do not patch

Read on every sync (`docs/okvevo/SYNC.md`). For each row: is the issue closed,
or is the fix in the new release notes? If yes, re-test the symptom and move
the row to **Fixed upstream** with the Hermes version.

We do not edit upstream Python for these. Workarounds that touch the same
symptom are listed in `docs/okvevo/WORKAROUNDS.md`.

## Open

### Session turn lease lost after a long main-process freeze

- Issues: https://github.com/NousResearch/hermes-agent/issues/139959 (lease
  renewal starved by the SessionDB write lock, open), https://github.com/NousResearch/hermes-agent/issues/144503
  (same log line after host sleep, opened 2026-10-25, open).
- Checked against: v0.22.4 (pinned) and v0.22.5. v0.22.5 does not change
  `agent/turn_facade_lease.py` or `tui_gateway/session_reaper.py`.
  https://github.com/NousResearch/hermes-agent/issues/62823 (closed 2026-09-25) was already in this build.
- User impact: a pending approval is withdrawn ("session turn lease lost").
  Testers send the request again (`docs/okvevo/TESTING.md`).
- Related workaround: `event_loop_block_stack` (stack capture only, no fix).

Evidence, Mac, 2026-10-30, one gateway process (`hermes-gateway_24745`), session
`local-ccc2f68e…`, waiting on an image approval:

- 14:27:51 renderer websocket `client_disconnect` code 1006, then reconnect.
- Main-process event-loop lag 898515 ms (expected tick ~14:27:58, observed 14:42:56). The upstream watchdog stores the duration only.
- No "lease refresh hit a SQLite lock; will retry" line.
- 14:43:46 "Session turn lease refresh stayed locked through its lifetime".
- 14:43:47 approval withdrawn: "session turn lease lost". Tool duration 1002.60 s.
- Electron does not open `state.db`.

Draft comment for #139959 (not posted; Karan reviews first):

> Desktop, one gateway process, 2026-10-30, session waiting on an image
> approval. 14:27:51 websocket `client_disconnect` code 1006, then reconnect.
> Main process event-loop lag 898515 ms (watchdog stores duration only). No
> "lease refresh hit a SQLite lock; will retry" line. 14:43:46 "Session turn
> lease refresh stayed locked through its lifetime". 14:43:47 approval
> withdrawn: "session turn lease lost". Electron does not open state.db. #62823
> (closed 2026-09-25, zombie queue and tab merge) was already in this build and
> did not cover a 1006 followed by a 15 minute lock.

### Two desktop i18n keys never defined upstream

- `settings.mcp.catalogInstallTimeout` (`apps/desktop/src/app/capabilities/mcp/install-catalog-entry.ts`)
  and `settings.localModels.updateToast` (`apps/desktop/src/store/local-runtime-jobs.ts`)
  are called with `translateNow` in v0.22.4 but missing from every catalog, so
  the UI shows the raw key. Not filed.
- Found 2026-10-30 by the key guard in `apps/desktop/src/i18n/okvevo-catalog.test.ts`
  (`UPSTREAM_MISSING_KEYS`). On the sync that adds them, drop them from that set.

## Fixed upstream

None yet.
