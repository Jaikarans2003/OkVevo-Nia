# Fork deltas — OkVevo portal, gateway, billing

Credits SoT is OkVevo-Web Firestore two-bucket (`allocationBalance` / `topUpBalance`). This repo holds desktop + agent clients.

---

### Electron Sign In + pack env

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` (+ `[portal]` contract) |
| **Files** | `apps/desktop/electron/okvevo-auth.ts`, `okvevo-auth-store.ts`, `okvevo-auth-flow.ts`, `okvevo-env.ts`, `backend-env.ts`, `main.ts` IPC, `scripts/write-okvevo-pack-env.mjs`, `ci-map-pack-env.mjs`, renderer `src/store/okvevo-auth.ts`, `src/lib/okvevo-firebase.ts` |
| **What** | Firebase ID token file, fail-closed portal origin, bake `OKVEVO_WEB_ORIGIN` / Firebase / update feed into pack |
| **Why** | Public builds sign in to OkVevo portal, not Nous |
| **Re-apply** | Restore module trio + pack-env scripts; never drop absolute-origin validation |
| **Check** | Desktop okvevo-auth unit tests; packaged Sign In smoke |

### Python OkVevo gateway

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` |
| **Files** | `agent/okvevo_gateway.py` (`apply_okvevo_gateway`, Fal spend gate, `okvevo_signed_in`, `nia_is_internal_channel`); wire-ins in `agent_runtime_helpers.py`, `conversation_loop.py`, `run_agent.py`, `auxiliary_client.py`, `transports/chat_completions.py`; Fal/Tavily plugins |
| **What** | OpenAI-wire traffic → `{origin}/api/gateway` when signed in; Fal/Tavily metered |
| **Why** | Credits debit via portal |
| **Re-apply** | Re-add whole `okvevo_gateway.py` if missing; grep `apply_okvevo_gateway` after merges |
| **Check** | `pytest tests/agent/test_okvevo_gateway.py` (+ Fal/Tavily siblings) |

### Billing UI + links

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` + `[agent]` + `[portal]` |
| **Files** | `apps/desktop/src/app/settings/billing/*`, `src/lib/okvevo-billing-listener.ts`, `agent/billing_links.py`, `okvevo/media-catalog.json`, `tools/media_catalog.py` |
| **What** | Live two-bucket % + top-up; public billing links → OkVevo portal; fail-closed media catalog |
| **Why** | Customer credits UX; no OpenRouter/Nous billing copy on public |
| **Re-apply** | Keep listener + `nia_is_internal_channel` branches |
| **Check** | Billing settings tests; chat that debits credits on staging pack |
