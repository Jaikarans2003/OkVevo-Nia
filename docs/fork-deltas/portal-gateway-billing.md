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

### Drama Fal adapter

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[portal]` |
| **Files** | `okvevo/drama_fal_adapter.py`; portal `OkVevo-Web/src/lib/fal/dramaChooser.ts`, `dramaGate.ts`, `app/api/gateway/fal/drama/[command]/route.ts` |
| **What** | Skill commands POST to the portal. The portal owns choose, quote, and the credit hold. The Python file has no price math and no Fal key. Drama jobs now also submit through `skills/creative/short-drama-produce/scripts/provider_adapters.py` (`portal`). H3 Max quotes use the rate card: omitting resolution used to bill Fal's 768P default while the old flat quote assumed $0.03/s; the card prices 768P explicitly. |
| **Why** | One quote, one hold, no provider key in the app |
| **Re-apply** | Keep the adapter as a client. Do not port `dramaChooser.ts` into Python. |
| **Check** | `npx tsx src/lib/fal/dramaGate.selfcheck.ts`; snapshot test lists `okvevo/drama_fal_adapter.py` |

### Drama must-fix pass (2026-10-10)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[portal]` |
| **Files** | `skills/creative/short-drama-produce/scripts/production_tool.py` + `provider_adapters.py`; portal `src/lib/fal/handleQueue.ts`, `rateCard.ts`, `holdSweep.ts`, `src/app/api/cron/fal-drift/route.ts`, `scripts/drama-release-hold.ts` |
| **What** | Prepare fetches a fail-closed portal quote; confirm refuses paid jobs without a usable quote; run sends `approved_credits`; portal `submitPriceGate` refuses before any reserve when fresh price > approved. Portal submit inlines downscaled reference media (≤2048px, JPEG q90/PNG-alpha, 24MB body cap). GPT edit refs capped at 4 both sides until the billing-events smoke prices input tokens. Reserved holds >30m without a Fal request id raise ONE HIGH alert; release is manual via `scripts/drama-release-hold.ts` after a billing-events check. |
| **Why** | No confirm without a price; no hold on refusal paths; no unpriced edit tokens; no silent stuck holds |
| **Re-apply** | Keep the quote gate and price gate fail-closed; keep the ref cap mirrored in `GPT_IMAGE_MAX_REFS` and `_portal_endpoint`. |
| **Check** | `pytest tests/skills/test_drama_produce_quote.py tests/skills/test_drama_portal_adapter.py`; `npx tsx src/lib/fal/rateCard.selfcheck.ts` |

### Billing UI + links

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` + `[agent]` + `[portal]` |
| **Files** | `apps/desktop/src/app/settings/billing/*`, `src/lib/okvevo-billing-listener.ts`, `agent/billing_links.py`, `okvevo/media-catalog.json`, `tools/media_catalog.py` |
| **What** | Live two-bucket % + top-up; public billing links → OkVevo portal; fail-closed media catalog |
| **Why** | Customer credits UX; no OpenRouter/Nous billing copy on public |
| **Re-apply** | Keep listener + `nia_is_internal_channel` branches |
| **Check** | Billing settings tests; chat that debits credits on staging pack |
