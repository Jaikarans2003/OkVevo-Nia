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

### Drama full parity (2026-10-10, authorize/capture)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[portal]` |
| **Files** | adapter `provider_adapters.py` + `production_tool.py`; portal `rateCard.ts`, `uploads.ts`, `mediaInputs.ts`, `mediaResolve.ts`, `handleQueue.ts`, `capture.ts`, `scripts/fal-capture-job.ts`, `jobs/fal-capture/Dockerfile`, `dramaSwitches.ts`, `verifyWebhook.ts`, `src/app/api/fal/uploads/**`, `src/app/api/webhooks/fal/`, `src/app/admin/drama/`, `src/app/api/admin/drama/**`, `src/app/api/cron/fal-drift/route.ts`, `scripts/drama-infra.sh`, `docs/adr/ADR-001-drama-full-parity.md` |
| **What** | Native extend/edit/reference/first+last/multi-shot through signed Firebase Storage uploads (`drama-inputs/`). GPT edit refs 16. Formula reserves + provisional settle; capture job reads Fal billing-events with `FAL_BILLING_KEY` (capture SA only; App Hosting never gets it). Voice clone: `fal-ai/minimax/voice-clone` (not chatterbox), ≥10s, consent, clone-once, 7-day warn. Cloned voice SoT is Firestore `clonedVoices` (uid-owned); speech 403 before hold if custom `voice_id` is not owned; local voices file is a cache + portal restore; delete tombstones the id so it cannot be registered or used again (Fal has no delete-voice API). Telegram removed; alerts = `opsAlerts` + log + admin dashboard. Kill switch + daily spend breaker. |
| **Why** | Full skill parity; realized Fal margin; generation key stays submit-only |
| **Re-apply** | Keep signed-URL media path. Keep formula reserves. Do not grant `FAL_BILLING_KEY` to App Hosting. Do not wire chatterbox. Do not resurrect Telegram. |
| **Check** | `pytest tests/skills/test_drama_portal_adapter.py`; portal `npx tsx src/lib/fal/{rateCard,uploads,mediaInputs,capture,dramaSwitches,adminGuard}.selfcheck.ts` + `src/lib/ops/alert.selfcheck.ts` |

### Billing UI + links

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` + `[agent]` + `[portal]` |
| **Files** | `apps/desktop/src/app/settings/billing/*`, `src/lib/okvevo-billing-listener.ts`, `agent/billing_links.py`, `okvevo/media-catalog.json`, `tools/media_catalog.py` |
| **What** | Live two-bucket % + top-up; public billing links → OkVevo portal; fail-closed media catalog |
| **Why** | Customer credits UX; no OpenRouter/Nous billing copy on public |
| **Re-apply** | Keep listener + `nia_is_internal_channel` branches |
| **Check** | Billing settings tests; chat that debits credits on staging pack |
