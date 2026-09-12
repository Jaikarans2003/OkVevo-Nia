# Pre-live backlog

Items here are **not urgent day-to-day**, but **must be closed before any external tester or production ship** (“go live”). They are easy to defer and expensive to rediscover — keep this file current.

**Canonical repo:** `Jaikarans2003/OkVevo-Nia`  
**Last reviewed:** 2026-09-09 (media catalog pass: `video_generate` core, `model=` fail-closed, public OkVevo Fal gate, credit-quote approval; deferred rows logged below)

---

## How to use this file

1. **Before go-live:** every row in **Hard gates** must be `[x]` done; **Required before live** should be `[x]` unless explicitly accepted with a dated waiver note.
2. **When deferring work:** if a task is out of scope for the current pass but must ship eventually, add or extend an entry here **in the same PR/session** — do not rely on chat memory or plan files alone.
3. **When closing an item:** mark the checkbox, add `Closed:` date + commit/PR link, move to **Closed** at the bottom (keep history).
4. **Verification:** each entry lists a concrete grep, test, or manual check — run it when claiming done.

### Entry template (copy for new items)

```markdown
### [ ] Short title

| Field | Value |
|-------|-------|
| **Gate** | Hard gate / Required before live / Nice-to-have |
| **Risk if skipped** | One sentence — what breaks for real users |
| **Scope** | Files or directories |
| **Fix** | What to change (specific constants, strings, URLs) |
| **Verify** | Command or checklist |
| **Notes** | Context, links, dependencies |
```

---

## Hard gates (block go-live)

### [ ] First tagged release must be signed (Mac notarize + Windows Authenticode)

| Field | Value |
|-------|-------|
| **Gate** | Hard gate |
| **Risk if skipped** | In-app update installs an unsigned binary; Gatekeeper/SmartScreen reject it, or a compromised feed can ship a non-OkVevo build. |
| **Scope** | `.github/workflows/desktop-release.yml`, `apps/desktop/scripts/require-release-secrets.mjs`, `apps/desktop/scripts/notarize.mjs`, `apps/desktop/scripts/sign-windows.mjs`, `docs/FINISH-SIGNED-RELEASE.md` |
| **Fix** | Put the secrets listed in `docs/FINISH-SIGNED-RELEASE.md` into GitHub Actions, then `git tag v0.21.0 && git push origin v0.21.0` (bump `apps/desktop/package.json` version to match first). Do not tag until secrets exist — missing certs fail the job on purpose. |
| **Verify** | `node apps/desktop/scripts/require-release-secrets.mjs` exits 1 with no secrets. After secrets: workflow green, `https://releases.okvevo.com/latest-mac.yml` and `latest.yml` exist, test install picks up the update. |
| **Notes** | Scaffolded 2026-09-01. Feed host is `releases.okvevo.com` (S3/R2 bucket), not www.okvevo.com. |

### [ ] Private repo breaks DMG first-install bootstrap

| Field | Value |
|-------|-------|
| **Gate** | Hard gate |
| **Risk if skipped** | `raw.githubusercontent.com` does not serve private repos without a token. Packaged DMG bootstrap (`bootstrap-runner.ts` `downloadInstallScript`) and `install.sh` git clone both hit GitHub unauthenticated — same HTTP 404 as 2026-08-31 if the repo is private. First install never starts: no clone, no SOUL.md, no first chat. |
| **Scope** | `apps/desktop/electron/bootstrap-runner.ts` (`downloadInstallScript`), `apps/bootstrap-installer/src-tauri/src/install_script.rs` (same raw URL pattern). Product/repo policy: `Jaikarans2003/OkVevo-Nia` visibility. |
| **Why acceptable now** | Repo is **public by deliberate choice** to unblock first-install bootstrap — not because the fetch path is safe when private. |
| **Fix (pick one before re-privatizing; do not implement both speculatively)** | **Auth path:** repo-scoped read-only GitHub deploy token embedded in the shipped app, sent as `Authorization` on both the raw script fetch and the git clone. Keeps a **live GitHub dependency at every install**; smaller DMG; secret to manage and rotate. **Bundled path:** ship `install.sh` and an initial repo snapshot inside the DMG so first-install has **no live GitHub dependency**. Bigger DMG; requires a rebuild whenever shipped backend code changes. |
| **Hard gate** | Do **not** flip `Jaikarans2003/OkVevo-Nia` back to private until one of the above is implemented **and tested**, not just noted. Public visibility is an interim workaround, not the close condition. |
| **Verify** | 1) While public: `curl -sI "https://raw.githubusercontent.com/Jaikarans2003/OkVevo-Nia/main/scripts/install.sh"` → **200**. 2) Fresh install: `rm -rf ~/.hermes`, launch DMG app, complete first-run — bootstrap log must **not** show `HTTP 404` on raw fetch; must reach clone + Nia SOUL. 3) Before re-privatizing: auth or bundled path implemented and same fresh-install test passes with repo private. |
| **Notes** | **Reproduced 2026-08-31 (private):** DMG `Nia-0.17.0-mac-arm64.dmg`, stamp `07567979f4`, log `~/.hermes/logs/desktop.log`: `fetching install.sh for 07567979f4b8 from GitHub` → `404 from https://raw.githubusercontent.com/Jaikarans2003/OkVevo-Nia/07567979f4.../scripts/install.sh`. `git ls-remote okvevo main` succeeds (commit exists); raw + unauthenticated API return 404. Existing fallback to `installed-agent` only helps **re**-bootstrap, not first install on empty `~/.hermes`. |

---

## Required before live

### [ ] www.okvevo.com download page (Mac / Windows buttons)

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | About → Get the installer opens the homepage; testers can still download if the homepage has the files, but there is no dedicated Mac/Windows download surface. |
| **Scope** | Marketing site, not this repo. About already uses `https://www.okvevo.com`. |
| **Fix** | Add `/download` (or equivalent) with arm64 DMG + Windows NSIS pointing at `releases.okvevo.com` artifacts. Then point `INSTALLER_URL` at that path. |
| **Verify** | Opening Get the installer lands on Mac/Windows buttons, not a generic homepage. |
| **Notes** | Deliberately not blocked on the www redesign: first tagged release can ship with homepage CTA. |

### [ ] Pin packaged agent/runtime to the same release as the shell

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | electron-updater replaces the UI while `~/.hermes` is still a live git clone — new UI / old Python (or the reverse), the same skew About used to show. |
| **Scope** | Packaged extraResources / gateway start path vs `~/.hermes` user data |
| **Fix** | Ship agent code from the app (or a release-pinned snapshot). Keep `~/.hermes` for user data only. See plan Phase C agent pin. |
| **Verify** | After an in-app update, Python/agent version matches the desktop tag; `git pull` in `~/.hermes` cannot change `apps/desktop`. |
| **Notes** | Scaffold 2026-09-01 did not implement this. Do it before asking testers to rely on in-app update for backend fixes. |

### [ ] Clone-shipped TUI + web dashboard still say “Hermes” in many user-facing strings

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Fresh installs get Nia SOUL/persona from backend, but TUI and web UI still show Hermes in setup, updates, channels, achievements, wake-word help, etc. — inconsistent product identity. |
| **Scope** | `ui-tui/src/**`, `web/src/**` (exclude `**/*.test.*`, `**/__tests__/**` where identifiers are intentional). Partial Nia work already landed: `ui-tui/src/components/branding.tsx`, `ui-tui/src/theme.ts`, `web/index.html`, `web/src/i18n/en.ts` (commit `e23f5d5c05`). |
| **Fix** | Scoped rebrand pass: user-visible copy → Nia / OkVevo; keep internal API names (`HermesSkin`, `X-Hermes-Session-Token`, `updateHermes` **keys** in i18n types) only where they are protocol/SDK identifiers — rename display strings, not wire format, unless a deliberate API change is approved. |
| **Verify** | `rg 'Hermes' ui-tui/src web/src --glob '*.{tsx,ts,html}' --glob '!**/*.test.*' --glob '!**/__tests__/**'` — triage every match; user-facing hits should → 0 or be explicitly documented exceptions. |
| **Notes** | Known examples (non-exhaustive): `ui-tui/src/content/setup.ts` (“Hermes needs a model provider”), `useMainApp.ts` fallback `'Hermes'`, wake-word help (“Hey Hermes”), `web/src/i18n/en.ts` `updateHermes` / “Hermes Achievements”, `ChannelsPage.tsx` `bot_name: "Hermes Agent"`, all non-English `web/src/i18n/*.ts` `brand: "Hermes Agent"`. Not blocking SOUL.md / bootstrap URL fix. |

### [ ] Windows Taskbar screenshot of rounded Nia icon

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | macOS Dock can look rounded while Windows Taskbar still shows a square ICO (Windows does not mask). Testers on Windows see a different brand mark than Mac. |
| **Scope** | `apps/desktop/assets/icon.ico`, `apps/bootstrap-installer/src-tauri/icons/icon.ico` (alpha already baked 2026-09-01; proof is a screenshot, not the pack) |
| **Fix** | Install the built Windows app; capture the Taskbar with Nia next to neighboring icons so rounding is visible. Keep this item open until that shot exists. |
| **Verify** | Taskbar screenshot shows transparent corners vs square neighbors; ICO is not a full-bleed opaque square. |
| **Notes** | Deferred 2026-09-01 from Nia UI polish: this environment is macOS only. Mac Dock shot can be taken here. Do not close `app-icon` / ship as done on Dock-only evidence. |

### [ ] Desktop/Electron shell rebrand not yet committed

| Field | Value |
|-------|-------|
| **Gate** | Required before live (for DMG/desktop ship) |
| **Risk if skipped** | Shipped desktop app shows Hermes icons, window title, shortcuts, onboarding copy — contradicts Nia identity in clone-shipped backend. |
| **Scope** | ~50 unstaged files under `apps/desktop/**`, `apps/bootstrap-installer/**` (icons, `brand-mark.tsx`, i18n, `product.ts`, etc.). Local-only as of 2026-08-31; not on `okvevo/main`. |
| **Fix** | Review unstaged desktop work, complete rebrand, commit as dedicated desktop identity pass. Include `install.ps1` shortcut names (`Hermes.lnk` → `Nia.lnk`) if desktop product name is Nia. |
| **Verify** | Build DMG/installer; spot-check window title, icon, onboarding, uninstall strings. `rg -i 'hermes' apps/desktop/src --glob '!**/*.test.*'` — user-facing hits triaged. |
| **Notes** | DMG-baked assets do not affect `git clone` bootstrap; separate from clone-shipped backend commit `e23f5d5c05`. **Progress 2026-09-09 (public-build privacy layer):** desktop i18n public-reachable values swept to Nia across all 5 locales (boot errors, `gatewayDisconnected`, update/backend-out-of-date, config loading, projects/worktree `staleBackend`, pet `staleBackend`, preview restart); hardcoded `'Hermes reported an error'` / `'Hermes error'` toast titles → Nia; `sanitizeUserFacingBrand` now rewrites standalone Hermes/Nous/OpenRouter/fal.ai in error+notice paths; Send-diagnostics error action is internal-only (uploads to Nous storage). Remaining Hermes strings in `apps/desktop/src` are hidden cloud/SSH/connections/providers/plugins UI (not reachable on public builds) or protocol identifiers — triage before checking this box. |

### [ ] OkVevo desktop sign-in verified on Mac and Windows

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Sign-in round trip (browser → `hermes://auth-callback` → main exchange) can work on one OS and fail on the other: Mac `open-url` vs Windows second-instance / cold-start argv. Testers cannot sign in. |
| **Scope** | `apps/desktop/electron/main.ts` (`handleDeepLink` auth-callback intercept), `okvevo-auth*.ts`, OkVevo-Web `/login` + `/api/auth/desktop/*` |
| **Fix** | Karan runs Sign in on both machines against the deployed portal (or `OKVEVO_WEB_ORIGIN`). Confirm titlebar + Settings → Billing show signed-in, `userData/okvevo-auth.json` exists, `~/.hermes/okvevo-firebase-id-token` is 0600. Replay of the same code fails. `hermes://mcp/install` still works. |
| **Verify** | Manual on Mac + Windows before any tester build. Unit tests: `okvevo-auth.test.ts`, `okvevo-auth-flow.test.ts`; web: `npx tsx src/lib/auth/desktop-redirect.selfcheck.ts`. |
| **Notes** | Deferred 2026-09-04 with Phase 2 implementation. This environment is macOS; Windows is Karan’s other machine. |

### [ ] Phase 4: gateway-only OpenAI-wire + hide BYOK chrome on the public channel

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | A public-build user can paste an OpenRouter key (or point `base_url` at an OpenRouter proxy) and skip OkVevo credit metering on the OpenAI-wire path. Status bar also lies (`Gateway · inference unavailable`) if readiness ignores the Firebase ID token. |
| **Scope** | Desktop: baked `NIA_BUILD_CHANNEL` (`apps/desktop/scripts/resolve-build-channel.mjs`, `isByokChromeVisible()` in [`settings-ui-policy.ts`](apps/desktop/src/app/settings/settings-ui-policy.ts)). Settings → Providers, onboarding OAuth+keys+local, Models paste/local, model picker Add provider. Python: [`agent/okvevo_gateway.py`](agent/okvevo_gateway.py), [`hermes_cli/main.py`](hermes_cli/main.py) `_has_any_provider_configured`, [`tui_gateway/methods_config.py`](tui_gateway/methods_config.py) `setup.runtime_check`. Standing doc: [`.cursor/NIA-BUILD-CHANNEL.md`](../.cursor/NIA-BUILD-CHANNEL.md). |
| **Fix** | Hide all BYOK chrome when the **public** channel is baked (default `pack` / `dist` / CI `v*`). No signed-in exception, no runtime env re-enable. Internal pack (`pack:internal`) keeps full pre-Phase-4 chrome even when signed in. Rewrite OpenAI-wire client to the OkVevo gateway whenever an ID token exists, except loopback (and native-adapter hosts left as the ambient gap). `setup.status` / `setup.runtime_check` treat `okvevo_signed_in()` as configured/usable. Never publish internal artifacts to `releases.okvevo.com`. |
| **Verify** | Public pack: Providers, palette provider entries, onboarding OAuth+keys+local, Models paste, Models local/custom absent; `NIA_BUILD_CHANNEL=internal` in the installed app’s env does nothing. Internal pack beside public: every surface works signed-in. Unit: `cd apps/desktop && npx vitest run scripts/resolve-build-channel.test.mjs src/app/settings/settings-ui-policy.test.ts src/components/onboarding/index.test.tsx src/app/settings/model-settings.test.tsx`. Signed-in, no personal OpenRouter key: badge not `inference unavailable`; leftover OpenRouter/`base_url` cannot hit OpenRouter on the wire path. |
| **Notes** | Step 0 closed 2026-09-05. UI hide was signed-in; replaced 2026-09-06 by bake-time public/internal channel (not unpackaged env, not `HERMES_DESKTOP_DEV_BYOK`). Razorpay is not a build gate. **Does not fully close BYOK** — see the ambient native-provider row below. Python rewrite + readiness landed 2026-09-05. |

### [ ] Signed-in ambient native-provider BYOK (Bedrock / env keys)

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Hiding Settings → Providers does not stop a signed-in user from selecting Bedrock (or Anthropic, OpenAI, Vertex, Copilot, …) when credentials already exist in the process environment, `~/.hermes/.env`, AWS/SSO files, or leftover `config.yaml`. Those native adapters never call `apply_okvevo_gateway`. Metering is skipped. |
| **Scope** | [`hermes_cli/model_switch.py`](hermes_cli/model_switch.py) `_has_fast_aws_sdk_signal` / `has_creds`; [`hermes_cli/auth.py`](hermes_cli/auth.py) `is_provider_explicitly_configured`; [`hermes_cli/inventory.py`](hermes_cli/inventory.py) `explicit_only`; Electron `process.env` inheritance + `~/.hermes/.env`; Settings → Model paste / picker Add provider |
| **Fix** | Either detect OkVevo sign-in and refuse non-gateway providers outright, or accept this as residual risk until then. **Do not build in the Phase 4 UI/wire pass.** |
| **Verify** | Signed-in, Providers tabs hidden, `AWS_ACCESS_KEY_ID`+secret (or `ANTHROPIC_API_KEY`) in env: Bedrock/Anthropic still listed in the model picker and a completion does not debit Firestore. After a real close: those rows gone (or blocked) when signed in. |
| **Notes** | Confirmed 2026-09-05. `has_creds` reads ambient `os.environ`, not the Providers UI. Desktop `explicit_only` still treats an access-key pair / `AWS_BEARER_TOKEN_BEDROCK` as explicit. Accepted residual for now (no live users). Do not describe Phase 4 as “closes BYOK.” |

### [ ] Gateway metering misses cache / reasoning-token surcharges

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Debit uses only `prompt_tokens` + `completion_tokens`. OpenRouter bills extra for `prompt_tokens_details.cached_tokens` / `cache_write_tokens` and `completion_tokens_details.reasoning_tokens` on some models — OkVevo would undercharge (or eat the margin) on those SKUs. |
| **Scope** | `OkVevo-Web/src/lib/gateway/pricing.ts`, `OkVevo-Web/src/lib/gateway/sse.ts`; catalog of models actually offered to subscribers |
| **Fix** | Before go-live, list which offered models charge cache-write / cache-read / reasoning separately. Fold those unit prices into the debit calc **or** drop those models from the catalog until the calc includes them. |
| **Verify** | For each offered model: a request that triggers cache and/or reasoning produces a debit ≥ OpenRouter’s billed USD × `MARGIN`. Models not in that set are not selectable for gateway traffic. |
| **Notes** | Logged 2026-09-05 with Phase 3. Phase 3 meters prompt+completion only. **Do not build this pass.** |

### [ ] CI must inject OKVEVO_WEB_ORIGIN before the first signed release

| Field | Value |
|-------|-------|
| **Gate** | Required before live (hard dependency of the first signed `v*` tag) |
| **Risk if skipped** | After origin fail-closed (no hardcoded `www.okvevo.com`), a Dock/Start-Menu packaged build has no shell env. Sign In, Upgrade, and the LLM gateway show a missing-config error instead of opening the portal. Testers and customers cannot sign in. |
| **Scope** | `.github/workflows/desktop-release.yml`, `apps/desktop/scripts/bundle-electron-main.mjs` (or extraResources written at pack time), [ENVIRONMENT.md](ENVIRONMENT.md) |
| **Fix** | The signed-release job must set `OKVEVO_WEB_ORIGIN` from CI env/secrets at pack time so the packaged app has a portal URL without a source-code domain fallback. Missing secret fails the job (same posture as signing secrets). Do **not** hardcode `www.okvevo.com` in `okvevo-auth.ts` / `okvevo_gateway.py` to “help” this. Runtime `~/.hermes/.env` may still override for local testing. |
| **Verify** | 1) Release workflow with `OKVEVO_WEB_ORIGIN` unset → job fails. 2) Packaged app from a successful signed job: Sign In / Upgrade open that origin; `rg 'www.okvevo.com' apps/desktop/electron/okvevo-auth.ts agent/okvevo_gateway.py` → 0. 3) Packaged app with the var stripped still shows the visible missing-config dialog, not a silent domain. |
| **Notes** | Logged 2026-09-05 with the env-centralize pass. Blocks first tagged release together with Mac notarize + Windows Authenticode. The signed-release pipeline is not built yet — this row exists so the injection is not forgotten among other gates. Env layout: [ENVIRONMENT.md](ENVIRONMENT.md). |

### [x] Razorpay two-bucket SoT (allocation + topUp) + webhook/cron writers

| Field | Value |
|-------|-------|
| **Gate** | Required before live (portal billing SoT) |
| **Risk if skipped** | Portal shows wrong remaining; renewals don't refresh allocation; yearly users stall between annual invoices; cancelled/halted users keep spending. |
| **Scope** | `OkVevo-Web`: `types/credits.ts`, `config/razorpay.ts`, `lib/billing/allocation.ts`, `lib/gateway/reserve.ts`+`debit.ts`, `api/razorpay/webhook`, `api/cron/allocation-refresh`, `firestore.rules`, Pricing + `/billing`, desktop billing listener |
| **Fix** | Two buckets on `users/{uid}`: `allocationBalance` (SET on activated + charged-if-due + daily cron) and `topUpBalance` (ADD on Payment Link `payment.captured`). FIFO debit. `invoice.paid` grants nothing. Cancel/paused/halted set `planStatus`. Spend requires `planStatus == 'active'`. |
| **Verify** | `npx tsx src/types/credits.selfcheck.ts` + `npx tsx src/lib/gateway/reserve.selfcheck.ts`. Test-key E2E: monthly charged refresh, yearly daily cron, FIFO, live % Mac+Windows. |
| **Notes** | Replaces the old “webhook seeds subscription.credits not creditBalance” row. Implemented 2026-09-11. |

### [x] Wire Cloud Scheduler → `/api/cron/allocation-refresh`

| Field | Value |
|-------|-------|
| **Gate** | Required before live (yearly allocation) |
| **Risk if skipped** | Yearly subscribers never get monthly allocation refreshes between annual invoices. |
| **Scope** | Firebase project hosting App Hosting; Cloud Scheduler job; `CRON_SECRET` in App Hosting env |
| **Fix** | Daily ~00:10 UTC HTTPS POST to `/api/cron/allocation-refresh` with `Authorization: Bearer CRON_SECRET`. Deploy composite index `planStatus + nextAllocationDate`. |
| **Verify** | Manual POST with secret refreshes a due yearly test user; without secret → 401. |
| **Notes** | Closed 2026-09-11: `nia-allocation-refresh` ENABLED `10 0 * * *` Etc/UTC; secrets in SM; index READY; Scheduler run-now → Cloud Logging HTTP 200. See `.cursor/plans/ops_billing_rollout_875b8a3c.plan.md`. |

### [ ] Razorpay Dashboard: subscribe `subscription.updated`

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Immediate upgrades never ADD the credit delta or rewrite plan meta on `users/{uid}`. Cycle-end downgrades still grant via `subscription.charged` for that invoice, but cron/UI keep the old `creditsIncluded` until this event is enabled. |
| **Scope** | Razorpay Dashboard → Developers → Webhooks (Test Mode now; Live before go-live) |
| **Fix** | Add `subscription.updated` to the existing OkVevo webhook URL’s event list. Code already handles it in `OkVevo-Web/src/app/api/razorpay/webhook/route.ts`. |
| **Verify** | Starter→Pro in test mode: Cloud Logging shows `Razorpay webhook: subscription.updated`; user `creditsIncluded` becomes 60000; `allocationBalance` rose by 40000; `currentPeriodEnd` unchanged. |
| **Notes** | Logged 2026-09-12 with Billing v2 Phase 2. Dashboard click is Karan-only. |

### [ ] Live-mode dual-currency Razorpay plans (6 USD + 6 INR)

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Test plan IDs are what checkout uses today. Live Indian cards/UPI cannot pay USD subscriptions; live INR plans do not exist until Dashboard cutover. |
| **Scope** | Razorpay Dashboard (Live) + `OkVevo-Web/apphosting.yaml` / `.env` `RAZORPAY_*_PLAN_ID` and `RAZORPAY_INR_*` |
| **Fix** | Activate International Payments, enable UPI Autopay, create 6 live INR + 6 live USD plans matching the Phase 3 price book, swap env IDs, rotate live webhook secret. Do not auto-FX-convert — paste Karan’s live IDs. |
| **Verify** | `npx tsx src/config/razorpay.selfcheck.ts`. Live (or live-mode) INR domestic subscription card + USD international subscription card both activate; `users/{uid}.currency` is `INR` or `USD`; `lookupPlanById` covers all 12 live IDs. |
| **Notes** | Logged 2026-09-12 with Billing v2 Phase 3 (test IDs shipped). |

### [ ] INR Payment Links for Add Credits

| Field | Value |
|-------|-------|
| **Gate** | Required before live (India) |
| **Risk if skipped** | Indian cards that can pay INR subscriptions still cannot pay USD top-up Payment Links. |
| **Scope** | `OkVevo-Web/src/app/api/razorpay/create-payment-link/route.ts` |
| **Fix** | Same currency lock as subscriptions: INR links in paise, USD links in cents, keyed off `users/{uid}.currency`. |
| **Verify** | INR subscriber Add Credits opens an INR Payment Link; USD subscriber stays USD. No tax line. |
| **Notes** | Logged 2026-09-12 with Phase 3. Out of scope for the subscription price book; still required before India go-live. |

### [ ] Wire Cloud Scheduler → `/api/cron/fx-drift`

| Field | Value |
|-------|-------|
| **Gate** | Required before live (INR price-book review) |
| **Risk if skipped** | Live USD/INR can drift >7% off the ₹95–100 book with no alert; INR display prices stay stale until someone notices. Job never auto-changes Razorpay plans. |
| **Scope** | Cloud Scheduler `nia-fx-drift`; `OkVevo-Web/src/app/api/cron/fx-drift/route.ts`; `CRON_SECRET` |
| **Fix** | Weekly Monday 09:00 UTC HTTPS POST to `/api/cron/fx-drift` with `Authorization: Bearer CRON_SECRET`. Script: `OkVevo-Web/scripts/ops-billing-finish.sh` (fx-drift block). Optional `OPS_ALERT_WEBHOOK_URL` for Slack/email. |
| **Verify** | `gcloud scheduler jobs describe nia-fx-drift --project=okvevo-testing --location=us-central1` → ENABLED, schedule `0 9 * * 1`. Manual POST with secret → 200 and `opsAlerts/fxDrift` written; without secret → 401. `npx tsx src/lib/billing/fxDrift.selfcheck.ts`. |
| **Notes** | Logged 2026-09-12 with Billing v2 Phase 6. Phase 3 shipped the route; this row is the Scheduler wire. Agent could not `gcloud` describe (reauth needed). |

### [ ] Test-mode billing v2 E2E (INR/USD cards, upgrade, downgrade, cancel)

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Dual-currency checkout, prorated upgrade delta, cycle-end downgrade, or cancel-at-period-end can be wrong in Razorpay test mode even when unit selfchecks pass. |
| **Scope** | Razorpay Test Mode + hosted `/pricing` + `/billing` + desktop Settings → Billing. Cards (subscription test cards only): INR domestic `4718 6091 0820 4366`; USD international `5104 0155 5555 5558`. |
| **Fix** | Karan runs the checklist below on **test keys**. Do not use non-subscription test cards. Dashboard must already include `subscription.updated` (row above). |
| **Verify** | 1) Logged-out `/` and `/pricing`: geo or manual INR/USD switch shows the matching price book **before** checkout; **no GST/tax line**. 2) INR Starter via domestic card → `users/{uid}.currency=INR`, Plan remaining 100%, `creditsIncluded=20000`. 3) USD Starter via international card (separate test uid) → `currency=USD`. 4) Card Starter→Pro: Razorpay charges the prorated difference **now**, billing date unchanged, `creditsIncluded=60000`, allocation **ADD floor(delta × remaining/period)** (half-cycle → +20,000, not full 40,000). 5) Pro→Starter downgrade: **no charge now**, `hasScheduledChanges` banner, next `subscription.charged` grants 20000. 6) Cancel: “Cancellation scheduled” banner; spend still works until `currentPeriodEnd`; after `subscription.cancelled`, gateway 402 / `planStatus=cancelled`. 7) Both surfaces: % bars (not raw balances) move after a real debit. Code: `npx tsx src/lib/billing/phase6.verify.selfcheck.ts` (OkVevo-Web); `npx tsx src/lib/billing/userSoT.selfcheck.ts`; desktop `npx tsx src/lib/okvevo-billing-listener.selfcheck.ts`. |
| **Notes** | Logged 2026-09-12 with Billing v2 Phase 6. Agent cannot complete 3DS/Razorpay Checkout. Live-mode cutover is the dual-currency plans row, not this one. |

### [ ] Desktop Settings → Billing visual check on Mac and Windows

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Public billing can still show Hermes dashes / dollar usage on one OS, or wrap the plan-card actions so Change Plan / Cancel Plan / Add Credits are unreachable at the locked 110% zoom. |
| **Scope** | `apps/desktop/src/app/settings/billing/index.tsx`, `apps/desktop/src/lib/okvevo-billing-listener.ts` |
| **Fix** | Karan opens Settings → Billing on both machines (public pack). Signed-out: OkVevo sign-in only, no Nous “Connect” card, no Balance/Auto-refill dashes. Signed-in: Current Plan + Plan remaining / Additional remaining % bars (no raw balances), portal buttons open `/billing/change-plan`, `/billing/cancel`, `/billing`. Internal pack may still show Hermes chrome below. |
| **Verify** | Manual Mac + Windows. Unit: `cd apps/desktop && npx vitest run src/app/settings/billing/index.test.tsx src/lib/okvevo-billing-listener.test.ts`; `npx tsx src/lib/okvevo-billing-listener.selfcheck.ts`. |
| **Notes** | Logged 2026-09-12 with Billing v2 Phase 5. This environment is macOS; Windows is Karan’s other machine. |

### [ ] Change Plan disclaimer (web + desktop)

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Card vs UPI upgrade pricing is easy to miss: card users expect a prorated difference; UPI users are charged the full new plan and keep leftover credits until the next billing date. |
| **Scope** | `OkVevo-Web/src/components/billing/ChangePlanModal.tsx`, `OkVevo-Web/src/app/billing/[[...slug]]/page.tsx`, `hermes-agent/apps/desktop/src/app/settings/billing/` |
| **Fix** | Add the dual-method disclaimer on Change Plan (web + desktop): “Card upgrades are charged a prorated difference immediately. UPI upgrades charge the full new plan price, and your existing credits remain usable until your next billing date.” |
| **Verify** | Both surfaces show the sentence before confirm. Short UPI-only line already shipped with the 100% bar / UPI stack pass. |
| **Notes** | Logged 2026-09-12 with Billing 100 UPI credits. Not implemented in that pass. |

### [ ] Legal → Subscription & Billing: card proration vs UPI stack

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Legal copy still describes a single upgrade path; UPI full-price stack + leftover-until-renewal SET is the live behavior. |
| **Scope** | `OkVevo-Web/src/app/legal/page.tsx` (`subscription-billing`) |
| **Fix** | Document card proration vs UPI stack / full price / leftover until the new subscription’s first renewal SET. |
| **Verify** | `/legal` Subscription & Billing section names both methods. |
| **Notes** | Logged 2026-09-12 with Billing 100 UPI credits. Not implemented in that pass. |

---

## Should fix before live (lower severity)

### [ ] Connect GitHub repo to App Hosting backend `okvevo-web`

| Field | Value |
|-------|-------|
| **Gate** | Should fix before live (ops) |
| **Risk if skipped** | `okvevo-web` has no connected repository — `git push` to `OkVevo-Web` does not auto-roll. Releases rely on `firebase deploy --only apphosting` (local source). Easy to ship code to GitHub and forget to redeploy the live portal. |
| **Scope** | Firebase Console → App Hosting → `okvevo-web` → connect `Jaikarans2003/OkVevo-Web` (branch `main`) |
| **Fix** | Connect repo + enable auto-rollouts on `main`. Confirm `apphosting:rollouts:create --git-commit` works. Keep local `firebase deploy --only apphosting` as fallback. |
| **Verify** | Push a no-op commit to `main` → App Hosting build starts; backend Repository column non-empty. |
| **Notes** | Logged 2026-09-11 during ops billing rollout. |

### [ ] Audit Tailwind rounded-* vs --radius-scalar 0.2

| Field | Value |
|-------|-------|
| **Gate** | Should fix before live |
| **Risk if skipped** | Semantic `rounded-sm`…`rounded-4xl` compute to 20% of Tailwind defaults (`rounded-3xl` = 6.4px, `rounded-2xl` = 4.8px at 16px root). Buttons, dialogs, cards, settings, attachments, and widget-shell look sharper than the class names imply; easy to miss until someone zooms a specific chrome piece. |
| **Scope** | `apps/desktop/src/**` usages of `rounded-sm`/`md`/`lg`/`xl`/`2xl`/`3xl`/`4xl` (not `rounded-full` stadiums that rely on clamping, not `--composer-corner-radius` from the 2026-09 composer/bubble pass). First hits: `widget-shell.ts`, `composer-dock.ts` `composerPanelCard`, `attachments.tsx`, dialogs, settings, shadcn `components/ui/*`. |
| **Fix** | Inventory intended vs computed px using packaged asar CSS + Chromium `getComputedStyle` (same method that proved `rounded-3xl` ≠ 24px). Then either (a) raise `--radius-scalar` so semantic utilities match design, or (b) keep the scalar and switch surfaces that need real 8–24px radii to unscaled tokens. Do not mix both without a written rule. |
| **Verify** | Packaged CSS: sample 5 high-traffic surfaces; report computed `border-radius`. A 200×200 `.rounded-3xl` probe must match the chosen policy (today **6.4px**). |
| **Notes** | Logged 2026-09-02 from bubble/composer/HUD polish. That pass uses `--composer-corner-radius: 1.5rem` (unscaled) for composer/bubbles/HUD only — do not expand it to widgets. |

### [ ] CLI update-check / release links still point at Nous

| Field | Value |
|-------|-------|
| **Gate** | Should fix before live |
| **Risk if skipped** | `hermes update` / banner version checks query Nous repo, not OkVevo-Nia. |
| **Scope** | `hermes_cli/banner.py` — `_UPSTREAM_REPO_URL` (L141) |
| **Fix** | `https://github.com/Jaikarans2003/OkVevo-Nia.git` |
| **Verify** | `rg 'NousResearch/hermes-agent' hermes_cli/banner.py` → 0 |

### [ ] Public docs still quote Hermes fallback identity

| Field | Value |
|-------|-------|
| **Gate** | Should fix before live (if website ships with product) |
| **Risk if skipped** | Documentation contradicts Nia persona. |
| **Scope** | `website/docs/**` |
| **Fix** | Replace Hermes/Nous fallback identity strings with Nia/OkVevo |
| **Verify** | `rg 'Hermes Agent|Nous Research' website/docs` — triage |

### [ ] Dev/tooling scripts still default to Nous upstream (non-bootstrap)

| Field | Value |
|-------|-------|
| **Gate** | Nice-to-have before live; required for contributors targeting OkVevo fork |
| **Risk if skipped** | Contributor/dev scripts clone or audit wrong repo; does not affect end-user first install. |
| **Scope** | `scripts/dev-sandbox.sh`, `scripts/contributor_audit.py`, `scripts/release.py`, `scripts/install.cmd` (comment), others — see grep below |
| **Fix** | Repoint defaults to OkVevo-Nia where appropriate; keep overrides env-driven |
| **Verify** | `rg 'NousResearch/hermes-agent' scripts/` — triage each hit (bootstrap paths already clean) |

### [ ] Public Settings/cron still show vendor-prefixed model ids

| Field | Value |
|-------|-------|
| **Gate** | Should fix before live |
| **Risk if skipped** | Public Settings → Models and cron still print raw ids like `anthropic/claude-opus-4.8` even after the OpenRouter group is labeled OkVevo. Users see the upstream vendor in the model value. |
| **Scope** | [`apps/desktop/src/app/settings/model-settings.tsx`](apps/desktop/src/app/settings/model-settings.tsx) model `<SelectItem>` (main ~L859, aux ~L1013); [`apps/desktop/src/app/cron/index.tsx`](apps/desktop/src/app/cron/index.tsx) ~L1353 |
| **Fix** | Render the same prettified names `displayModelName` already uses in the composer pill. Keep wire ids as Select values. Do not invent a second per-model naming scheme. |
| **Verify** | Public pack: Settings model dropdown and cron model items show `Opus 4.8` / `GPT-5.5`, not vendor-prefixed ids. OpenRouter group label remains OkVevo. |
| **Notes** | Logged 2026-09-06 with public OpenRouter→OkVevo branding. That pass fixed the `openrouter` slug on the aux current line and ModelPickerDialog heading; this leftover is model ids, not the provider slug. |

### [ ] Public Skills TTS panel still shows per-provider voice fields

| Field | Value |
|-------|-------|
| **Gate** | Nice-to-have before live |
| **Risk if skipped** | Public Settings → Voice only shows Voices + Max Recording Length, but Skills → TTS `ToolsetConfigPanel` can still show ElevenLabs/OpenAI voice rows. Launch re-forces `tts.provider=edge`, so a leftover provider does not stick. |
| **Scope** | `apps/desktop/src/app/settings/toolset-config-panel.tsx` |
| **Fix** | Reuse `isByokChromeVisible()` / `isConfigKeyVisible` so public Skills TTS matches the Voice tab (Edge voice picker only). |
| **Verify** | Public pack: Skills → TTS has no provider switcher; leftover `tts.provider=elevenlabs` becomes Edge after relaunch. |
| **Notes** | Logged 2026-09-07 with Voice/Memory/Plugins public hide. Internal Voice Shortcut YAML (`voice.record_key`) still edits CLI, not desktop `composer.voice` — same ceiling, internal-only. |

### [ ] OkVevo gateway upload route for large Fal reference files (>20MB)

| Field | Value |
|-------|-------|
| **Gate** | Should fix before live |
| **Risk if skipped** | Local reference files are inlined as `data:` URLs (`tools/fal_common.fal_fetchable_source`) with a ~20MB raw ceiling (`_FAL_INLINE_DATA_URL_MAX_CHARS`, protects the Cloud Run ~32MB request limit). Larger refs are rejected with a clear "too large" error instead of working. Dashboard also shows inline base64 instead of real `v3.fal.media` URLs. |
| **Scope** | OkVevo-Web gateway (new authenticated upload route); `tools/fal_common.py` (`fal_fetchable_source`, ponytail comment) |
| **Fix** | Authenticated upload route on the OkVevo gateway that stores the file and returns a fetchable CDN URL; `fal_fetchable_source` calls it for local files over the inline ceiling instead of rejecting. |
| **Verify** | Attach a >20MB reference image → image edit + i2v complete; Fal dashboard request input is a `v3.fal.media` URL, not base64. |
| **Notes** | Logged 2026-09-09 with the local-file upload fix (data-URL inlining). Related: r2v multi-reference support for the FAL video plugin (`max_reference_images: 0` today) is tracked in the video-gen plan's out-of-scope list — don't duplicate it here. |

### [ ] Gateway reserved-job TTL sweeper

| Field | Value |
|-------|-------|
| **Gate** | Nice-to-have |
| **Risk if skipped** | A Fal job that never webhooks and is never polled leaves `estimatedCredits` deducted until a later status/cancel. Chat and Tavily settle in the same request, so they do not stick. |
| **Scope** | `OkVevo-Web/src/lib/gateway/debit.ts` (`reserveCredits` ponytail) |
| **Fix** | Cron/TTL sweeper that `releaseCredits` on `gatewayJobs` still `reserved` past a timeout. |
| **Verify** | Insert a reserved job older than the TTL, run the sweeper, `creditBalance` restored, job `released`, no debit row. |
| **Notes** | Logged 2026-09-07 with Phase 6 reserve-then-reconcile. Out of scope for 6a/6b. |

### [ ] Fal `units`-priced models unmetered (GPT Image, Seedream Pro, Gemini Omni, …)

| Field | Value |
|-------|-------|
| **Gate** | Should fix before live |
| **Risk if skipped** | Catalog rows whose live Fal price unit is `units`/`credits` (GPT Image `units` @ 1.0, Seedream Pro, Gemini Omni Flash, …) stay `shipped: false` — the `model=` schema and the gateway allowlist cannot offer them, so the photo/video menu is narrower than the catalog Karan maintains. |
| **Scope** | `OkVevo-Web/src/lib/fal/quantity.ts` (`refusing to guess quantity for unit=...`), `OkVevo-Web/src/lib/fal/allowlist.ts`, `OkVevo-Web/src/lib/fal/media-catalog.json` + `hermes-agent/okvevo/media-catalog.json` (flip `shipped` together, bytes identical) |
| **Fix** | Map each `units`-priced endpoint's real per-unit price (Fal pricing API `unit_price` × verified conversion), extend `quantity()` for the unit or pin a per-endpoint conversion, add to `METERABLE_ENDPOINTS`, then flip `shipped: true` in BOTH catalog copies. |
| **Verify** | `node --experimental-strip-types src/lib/fal/mediaCatalog.selfcheck.ts` stays green; a quote + submit for a newly shipped id debits ≥ Fal cost × `MARGIN`; `scripts/check_media_catalog.py` green. |
| **Notes** | Logged 2026-09-09 with the media catalog pass. Drift between the two catalog copies is fail-closed by design (gateway 400s, tool errors) — never silent unmetered spend. |

### [ ] Seedream layerize output pipeline (layer PNGs / compositor)

| Field | Value |
|-------|-------|
| **Gate** | Nice-to-have |
| **Risk if skipped** | `bytedance/seedream/v5/pro/layerize` stays `shipped: false`; users cannot get editable-layers output (base + up to 16 transparent PNGs, z_index, bounding boxes) even though the catalog keeps Karan's product-shoot note verbatim. |
| **Scope** | `tools/image_generation_tool.py` (single-`image` result shape), `apps/desktop/src/lib/generated-images.ts` (single-still render), catalog row `shipped` flag |
| **Fix** | Either dump layer PNGs as files (no compositor) or build a layer UI; then flip `shipped: true`. Do not advertise layerize as a working `image_generate` mode until one of those exists. |
| **Verify** | A layerize call returns usable layer files (or renders layers in the desktop UI); catalog selfchecks stay green. |
| **Notes** | Logged 2026-09-09. `.psd` today is only a binary-extension allowlist entry — no PSD writing exists. |

### [ ] Missing Fal plugin video modes (r2v / director / v2v / a2v / LTX 2.5 / Kling o3, turbo/fast families)

| Field | Value |
|-------|-------|
| **Gate** | Should fix before live |
| **Risk if skipped** | Catalog rows for minimax h3-max `reference-to-video`/`director`, kling v3 turbo/pro + o3 (incl. v2v/r2v), seedance r2v + `/fast`, grok r2v, gemini-omni-flash v1.1, ltx-2.5 pro/fast (incl. a2v) stay `shipped: false` — the Fal plugin speaks t2v/i2v only, so those rows are catalog memory, not runnable models. |
| **Scope** | `plugins/video_gen/fal/__init__.py` (`FAL_FAMILIES`, modality routing, `max_reference_images`), `OkVevo-Web/src/lib/fal/allowlist.ts`, both catalog copies |
| **Fix** | Per family: add the endpoint + payload shape to the plugin (reference images, video-in, audio-in as applicable), verify live `unit` metering, add to `METERABLE_ENDPOINTS`, flip `shipped: true` in both catalog copies. JSON cannot invent HTTP shapes — each new family is a code change. |
| **Verify** | For each flipped row: `video_generate` with that `model=` + matching mode inputs succeeds through the OkVevo gateway and `/billing` shows the debit; both catalog selfchecks green. |
| **Notes** | Logged 2026-09-09. Plan's "Out of this pass" list is the source of truth for the full set. |

### [ ] xAI edit/extend tools still registered inside the `video_gen` toolset

| Field | Value |
|-------|-------|
| **Gate** | Nice-to-have (internal channel only — public hides xAI rows) |
| **Risk if skipped** | `xai_video_edit` / `xai_video_extend` merge into the `video_gen` toolset via the plugin registry, so the toolset toggle and the unified `video_generate` surface are not independent of xAI-specific edit/extend workflows. |
| **Scope** | `toolsets.py` (`video_gen` static membership), `tools/xai_video_tools.py` (registry toolset target) |
| **Fix** | Split xAI edit/extend into their own toolset (or document the merge as final). Static membership stays `["video_generate"]` for subset inference (issue #49622). |
| **Verify** | `hermes tools` shows the split; disabling `video_gen` does not remove xAI edit/extend and vice versa; `tests/plugins/video_gen/test_xai_plugin_integration.py` green. |
| **Notes** | Logged 2026-09-09 with the media catalog pass. Runtime merge (`include_registry=True`) + xAI credential `check_fn` keep current behavior correct, just not separable. |

---

## Closed

_(Move items here when done.)_

| Wire Cloud Scheduler → `/api/cron/allocation-refresh` | 2026-09-11 | `nia-allocation-refresh` ENABLED; SM secrets + grantaccess; local apphosting deploy; Scheduler run-now → HTTP 200. Plan: `ops_billing_rollout_875b8a3c`. |
| Razorpay two-bucket SoT (allocation + topUp) + webhook/cron writers | 2026-09-11 | pending commit. Selfchecks: `credits.selfcheck`, `reserve.selfcheck` (FIFO 100+50 spend 120→0+30; Jan 31→Feb 28). Desktop vitest `okvevo-billing-listener.test.ts`. Ops cron/secrets closed same day — see Scheduler row above. |
| Settings → Gateway / OS keychain toggle | 2026-09-07 | pending commit. Public hides the whole Gateways tab (nav, palette, `?tab=gateway` / `connections` bounce to Appearance). Internal keeps the OS keychain toggle. |
| Next.js 16.3 vs App Hosting Cloud Build adapter | 2026-09-05 | pending commit. `okvevo-web` live at `https://okvevo-web--okvevo-testing.us-central1.hosted.app`. Adapter compiled Next **16.3.3**. First Cloud Build fail was Razorpay module-load, not the adapter. |
| Production LLM gateway SSE / Phase 3 checklist on App Hosting | 2026-09-05 | pending commit. Grant 10000 → streamed POST 200 `text/event-stream` + debit amount 1 (`creditBalance` 10000→9999) → zero-balance **402** `insufficient_quota` in 661ms. Signed-out BYOK: `test_okvevo_gateway.py` 8 passed. Cloud Run 300s unused; `minInstances` stayed 0. |
| Desktop auto-update git remote Nous → OkVevo-Nia; packaged apps use electron-updater at releases.okvevo.com | 2026-09-01 | pending commit (see `docs/FINISH-SIGNED-RELEASE.md` for the first signed tag) |
| First-install bootstrap clone/download URLs → OkVevo-Nia | 2026-08-31 | `07567979f4` |
| Installer SOUL.md seed + legacy Hermes upgrade | 2026-08-31 | `07567979f4` |
| Clone-shipped backend identity (Python, SOUL, locales, tests) | 2026-08-31 | `e23f5d5c05` |
| LOCAL_ONLY_V1 gates Settings → gateway Cloud/remote/SSH cards, cloud sign-in, connections registry, boot-failure cloud re-auth, and first-run “connect existing” | 2026-08-31 | pending commit (desktop visual rebrand; verify: Settings → gateway on a fresh profile — only the Local card) |
| `apps/desktop/package.json` author / repository.url / linux maintainer → OkVevo / OkVevo-Nia | 2026-08-31 | pending commit (desktop visual rebrand) |
