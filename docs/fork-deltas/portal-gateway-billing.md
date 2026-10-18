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
| **Check** | `pytest tests/skills/test_drama_produce_quote.py tests/skills/test_drama_portal_adapter.py tests/agent/test_okvevo_fal_gateway.py`; `npx tsx src/lib/fal/rateCard.selfcheck.ts`. Quote POSTs strip `data:` payloads. PNG/JPEG/WebP already ≤2048px probe from the file header (CI has no ffprobe). |

### Drama full parity (2026-10-10, authorize/capture)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[portal]` |
| **Files** | adapter `provider_adapters.py` + `production_tool.py`; portal `rateCard.ts`, `uploads.ts`, `mediaInputs.ts`, `mediaResolve.ts`, `handleQueue.ts`, `capture.ts`, `scripts/fal-capture-job.ts`, `jobs/fal-capture/Dockerfile`, `dramaSwitches.ts`, `verifyWebhook.ts`, `src/app/api/fal/uploads/**`, `src/app/api/webhooks/fal/`, `src/app/api/cron/fal-drift/route.ts`, `scripts/drama-infra.sh`, `scripts/drama-kill-switch.ts`, `docs/adr/ADR-001-drama-full-parity.md` |
| **What** | Native extend/edit/reference/first+last/multi-shot through signed Firebase Storage uploads (`drama-inputs/`). GPT edit refs 16. Formula reserves + provisional settle; capture job reads Fal billing-events with `FAL_BILLING_KEY` (capture SA only; App Hosting never gets it). Voice clone: `fal-ai/minimax/voice-clone` (not chatterbox), ≥10s, consent, clone-once, 7-day warn. Cloned voice SoT is Firestore `clonedVoices` (uid-owned); speech 403 before hold if custom `voice_id` is not owned; local voices file is a cache + portal restore; delete tombstones the id so it cannot be registered or used again (Fal has no delete-voice API). Telegram removed; alerts = `opsAlerts` + structured log + Cloud Monitoring email. Admin console deferred to a separate plan. The kill switch and daily spend breaker named here were removed 2026-10-11 (see Always-on generation). |
| **Why** | Full skill parity; realized Fal margin; generation key stays submit-only |
| **Re-apply** | Keep signed-URL media path. Keep formula reserves. Do not grant `FAL_BILLING_KEY` to App Hosting. Do not wire chatterbox. Do not resurrect Telegram. |
| **Check** | `pytest tests/skills/test_drama_portal_adapter.py tests/agent/test_okvevo_fal_gateway.py`; portal `npx tsx src/lib/fal/{rateCard,uploads,mediaInputs,capture,dramaSwitches,falQueue,spendGuard}.selfcheck.ts` + `src/lib/ops/alert.selfcheck.ts`. Upload/collect/voice HTTP uses `OKVEVO_WEB_ORIGIN` (no `/fal/queue` prefix). |

### Drama review fix (2026-10-10)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[portal]` |
| **What** | Portal refuses estimate ≤ 0; hashes client `drama-upload://` refs (never signed URLs); 409 never holds; replay before breaker/cap; daily-spend close lives in the settle tx (second settle is a no-op, `falUsdHeld` ≥ 0); `approved_credits` required only for drama-skill rate-card jobs; normal image/video tools reuse one `run_id` and reserve the server price. The kill switch named here was removed 2026-10-11 (see Always-on generation). |
| **Check** | Same as Drama full parity. `_portal_url("/api/fal/uploads")` has no `/fal/queue` prefix. |

### Drama review fix 3 (2026-10-11)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[portal]` |
| **Files** | portal `idempotency.ts`, `handleQueue.ts`, `scripts/drama-kill-switch.ts`, `scripts/drama-infra.sh`, `scripts/backfill-captured-false.ts`; `tests/skills/test_drama_portal_adapter.py` |
| **What** | The submit hash is the client request (model id, price params, prompt, `drama-upload://` or the original Fal media URL, sorted keys) and is taken before any signed URL is minted, including `audio_url`. Admin console deferred to a separate plan: no admin UI in these PRs. HIGH logs and a missing heartbeat email from `drama-infra.sh` (23h absence; fal-drift every 12h, because Cloud Monitoring rejects windows over 23h30m). Adapter "no price logic / no Fal key" runs in Nia pytest and fails if `provider_adapters.py` is missing. Web checks stay in-repo and fail if a drama, billing, or rules check file is missing. Backfill sets `captured=false` only for `provider == fal`, inside a per-document transaction that re-reads and skips when `captured` is already set. The kill switch in this entry was removed the same day; see Always-on generation below. |
| **Why** | A re-minted signed URL was a different hash (new hold or 409). Web CI skipped the adapter check when the Nia checkout was absent. The admin UI is not the operator surface for this ship. |
| **Re-apply** | Hash the client body, then sign. Do not add an admin console in this change. Do not skip adapter, billing, or rules checks when a file is missing. |
| **Check** | `pytest tests/skills/test_drama_portal_adapter.py`; `npx tsx src/lib/fal/{idempotency,spendGuard,capture,dramaGate,mediaCatalog}.selfcheck.ts` |

### Fal job machine (2026-10-11)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[portal]` |
| **Files** | portal `jobMachine.ts`, `dispatch.ts`, `handleQueue.ts`, `falQueue.ts`, `debit.ts`; adapter `provider_adapters.py` |
| **What** | One compare-and-set status machine: queued → dispatching → submitted → settled or released, plus unknown. Dispatch claims queued → dispatching before any Fal call. Cancel of a queued job refunds in that transaction and does not call Fal. Cancel after dispatch calls Fal cancel only once a request id exists, and releases only when Fal confirms. A released job cannot be submitted or settled. Finishing a job frees its slot and promotes that user's oldest waiter in the same transaction. A new submit takes a slot only when the queue is empty. A Fal 429 (or any explicit rejection) is "not accepted": the job returns to the head with the hold kept, retries up to 6 attempts or 10 minutes, then releases with a clear message. Timeouts stay `unknown` and are not resubmitted. An unknown active plan uses starter slots and logs a warning. A lapsed plan releases queued holds and the client sees "plan inactive". A failed spend-alert write does not block submit. |
| **Why** | Cancel and dispatch could both refund and charge. A submit during finish could pass an older waiter. A 429 was described as Fal accepting the overflow. |
| **Re-apply** | Do not write `status` outside a transaction that checks the current state. Do not send a job that is not `dispatching`. Do not promote a later job ahead of a head that is waiting to retry. |
| **Check** | `npx tsx src/lib/fal/jobMachine.selfcheck.ts`; `npx tsx src/lib/fal/falQueue.selfcheck.ts`; `firebase emulators:exec --only firestore --project demo-okvevo -- "npx tsx src/lib/fal/jobMachine.emulator.ts"`; `pytest tests/skills/test_drama_portal_adapter.py -k portal_failure_message` |

### Always-on generation and per-plan queue (2026-10-11)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[portal]` |
| **Files** | portal `falQueue.ts`, `dispatch.ts`, `handleQueue.ts`, `holdSweep.ts`, `src/app/api/cron/fal-dispatch/route.ts`; adapter `provider_adapters.py`; `tools/fal_common.py` |
| **What** | No kill switch and no daily spend stop. $250 raw Fal USD/day emails once and does not block. Slots: Starter 2, Pro 5, Max 10. Over the limit the job is `queued` (credits reserved, FIFO). Settle/fail/cancel dispatches the next job; a minute cron is the backup. Inactive plan stays `plan not active`. |
| **Why** | A global off switch and a hard spend stop blocked testers. Per-user slots match the plan price. |
| **Re-apply** | One slot map in `falQueue.ts`. Do not reject a submit that can queue. Do not sweep queued jobs as abandoned **unless** they are past the 30m window and blocked only by terminal (`settled`/`released`/`unknown`) ids left in `running` — those go to `unknown` (credits held), never auto-submitted. |
| **Check** | `npx tsx src/lib/fal/falQueue.selfcheck.ts`; `pytest tests/skills/test_drama_portal_adapter.py tests/tools/test_fal_common.py -k "slot or queued"`. |

### Prune terminal falQueue.running + abandon stuck queued (2026-10-13)

| Field | Value |
|-------|-------|
| **Tags** | `[portal]` |
| **Files** | portal `dispatch.ts` (`recoverStaleRunningSlots`), `handleQueue.ts` (`dispatchQueuedUsers`), `holdSweep.ts`, `jobMachine.ts` (`queued → unknown`) |
| **What** | Each dispatch tick drops terminal ids from `falQueue.running`. A queued hold older than 30m with no Fal request id that was blocked only by those dead slots moves to `unknown` (credits held, not submitted). Operator releases via `drama-release-hold.ts`. |
| **Why** | Missed `finishSlot` left settled ids in `running`; Starter’s 2 slots filled forever; G3 job 4 waited behind two settled ids until the client’s ID token expired. |
| **Check** | Portal PR [OkVevo-Web #14](https://github.com/Jaikarans2003/OkVevo-Web/pull/14); emulator `pruneSettledRunningAbandonsAgedWaiter`. |

### Firebase ID token refresh on long Fal polls (2026-10-13)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[desktop]` |
| **Files** | `agent/okvevo_gateway.py` (`ensure_okvevo_id_token`, `refresh_okvevo_id_token`); drama `provider_adapters.py` poll loop; Electron `okvevo-auth.ts` / `okvevo-auth-flow.ts` / `main.ts` (writes `okvevo-firebase-refresh-token` next to the ID token); `tests/agent/test_okvevo_id_token_refresh.py` |
| **What** | Re-reading the ID token file on every portal request is necessary but not sufficient: the JWT expires after ~1h. Electron already refreshes via `/api/auth/desktop/refresh` and now also writes the refresh token to a sibling file. Python `ensure_okvevo_id_token` refreshes proactively within 5 minutes of expiry, and the drama poll retries **once** with `force=True` on 401 (poll only — never resubmit). |
| **Why** | G3 job 4 waited ~32 minutes in the OkVevo concurrency queue; the ID token expired; re-read still 401'd (`invalid_token`). |
| **Check** | `pytest tests/agent/test_okvevo_id_token_refresh.py` |

### Packaged adapter argv resolve (B1) (2026-10-18)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` |
| **Files** | `skills/creative/short-drama-produce/scripts/production_tool.py` (`_resolve_adapter_argv`); `references/okvevo-adapter.example.json`; `SKILL.md`; `tests/skills/test_drama_adapter_argv.py` |
| **What** | `_load_adapter` replaces `python3`/`python`/`py` with `sys.executable` and resolves relative `*.py` against the adapter config directory (supports `..\\scripts\\...`). Missing script fails closed. Example JSON uses `../scripts/provider_adapters.py`. Auth stays env-only. |
| **Why** | Packaged `run` used project cwd; repo-relative script paths failed and the model invented `bridge.py`. |
| **Check** | `pytest tests/skills/test_drama_adapter_argv.py` |

### Token value redaction (not safeStorage) (2026-10-18)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[desktop]` |
| **Files** | `agent/redact.py`; `plugins/nia-public-guard/`; `backend-env.ts` (`NIA_USER_DATA_DIR`) |
| **What** | Refresh token stays in `~/.hermes/okvevo-firebase-refresh-token` for Python rotation on long Fal polls. Tool/log output masks current id+refresh file values (whitespace-stripped, min 20 chars) as `[REDACTED]`. Guard blocks token basenames, env forms, `~/.h*` globs, and Electron userData. |
| **Why** | Moving refresh into Electron safeStorage would break Python poll refresh; path globs bypassed the old literal `/.hermes` check. |
| **Check** | `pytest tests/agent/test_redact.py -k OkvevoToken`; `pytest tests/plugins/test_nia_public_guard.py -k TokenAndGlob` |

### Fal request contract (2026-10-12)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[portal]` |
| **Files** | `okvevo/fal-schemas/*.json` (17, byte-identical to OkVevo-Web `src/lib/fal/schemas/`); adapter `provider_adapters.py` (`fal_input_schema`, `explicit_portal_args`, `portal_request_body`); `tests/skills/test_drama_fal_contract.py`; portal `falSchema.ts`, `handleQueue.ts`, `idempotency.ts` `SUBMIT_KEYS`, `voiceOwnership.ts` `speechVoiceId`, `app/api/cron/fal-drift/route.ts`, `scripts/pin-fal-schemas.ts` |
| **What** | Fal's OpenAPI input schema per rate-card endpoint is pinned with its fetch date. The adapter builds bodies from it (schema fields only, exact enum case, price fields explicit). The portal validates the final body (after media resolution) against the same files before pricing and any hold: invalid → 400 with `error.fields`. The 12h fal-drift cron diffs pinned vs live: required/enum change = HIGH email, other input change = INFO. Speech voice is `voice_setting.voice_id` (top-level `voice_id` was ignored by Fal); ownership reads the nested id. |
| **Why** | G3 job 1 failed at Fal after a hold: no `prompt`, `image_size` string. Nothing compared bodies with Fal's schema. |
| **Output format (2026-10-13)** | `portal_request_body` also refuses a target file type the endpoint cannot return (`unsupported_output_format`, before quote/hold): music-3 `.wav` only (no format field), speech `.mp3` (`audio_setting.format` default, not sent), gpt-image-2 png/jpg/jpeg/webp, video `.mp4`. G3 job 3: `.mp3` music target was billed, then failed the download check. |
| **Re-apply** | Re-pin with `npx tsx scripts/pin-fal-schemas.ts` (OkVevo-Web), copy to `okvevo/fal-schemas/`. Never send a field the pinned schema lacks. Keep the guard before `reserveFalRun`. |
| **Check** | `pytest tests/skills/test_drama_fal_contract.py`; `npx tsx src/lib/fal/falSchema.selfcheck.ts`. |

### Billing UI + links

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` + `[agent]` + `[portal]` |
| **Files** | `apps/desktop/src/app/settings/billing/*`, `src/lib/okvevo-billing-listener.ts`, `agent/billing_links.py`, `okvevo/media-catalog.json`, `tools/media_catalog.py` |
| **What** | Live two-bucket % + top-up; public billing links → OkVevo portal; fail-closed media catalog |
| **Why** | Customer credits UX; no OpenRouter/Nous billing copy on public |
| **Re-apply** | Keep listener + `nia_is_internal_channel` branches |
| **Check** | Billing settings tests; chat that debits credits on staging pack |
