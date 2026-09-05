# Pre-live backlog

Items here are **not urgent day-to-day**, but **must be closed before any external tester or production ship** (“go live”). They are easy to defer and expensive to rediscover — keep this file current.

**Canonical repo:** `Jaikarans2003/OkVevo-Nia`  
**Last reviewed:** 2026-09-02 (logged `--radius-scalar` / `rounded-*` audit; first signed tag still a hard gate)

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
| **Notes** | DMG-baked assets do not affect `git clone` bootstrap; separate from clone-shipped backend commit `e23f5d5c05`. |

### [ ] OkVevo desktop sign-in verified on Mac and Windows

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Sign-in round trip (browser → `hermes://auth-callback` → main exchange) can work on one OS and fail on the other: Mac `open-url` vs Windows second-instance / cold-start argv. Testers cannot sign in. |
| **Scope** | `apps/desktop/electron/main.ts` (`handleDeepLink` auth-callback intercept), `okvevo-auth*.ts`, OkVevo-Web `/login` + `/api/auth/desktop/*` |
| **Fix** | Karan runs Sign in on both machines against the deployed portal (or `OKVEVO_WEB_ORIGIN`). Confirm titlebar + Settings → Billing show signed-in, `userData/okvevo-auth.json` exists, `~/.hermes/okvevo-firebase-id-token` is 0600. Replay of the same code fails. `hermes://mcp/install` still works. |
| **Verify** | Manual on Mac + Windows before any tester build. Unit tests: `okvevo-auth.test.ts`, `okvevo-auth-flow.test.ts`; web: `npx tsx src/lib/auth/desktop-redirect.selfcheck.ts`. |
| **Notes** | Deferred 2026-09-04 with Phase 2 implementation. This environment is macOS; Windows is Karan’s other machine. |

### [ ] Phase 4: gateway-only for signed-in OpenAI-wire (hide Providers BYOK chrome)

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | A signed-in user can paste an OpenRouter key (or point `base_url` at an OpenRouter proxy) and skip OkVevo credit metering on the OpenAI-wire path. Status bar also lies (`Gateway · inference unavailable`) because readiness ignores the Firebase ID token. |
| **Scope** | Desktop: Settings → Providers sub-tabs `accounts` / `keys` / `custom-endpoints` ([`providers-settings.tsx`](apps/desktop/src/app/settings/providers-settings.tsx), [`settings/index.tsx`](apps/desktop/src/app/settings/index.tsx), [`settings-ui-policy.ts`](apps/desktop/src/app/settings/settings-ui-policy.ts)). Onboarding OpenRouter key row. Python: [`agent/okvevo_gateway.py`](agent/okvevo_gateway.py), [`hermes_cli/main.py`](hermes_cli/main.py) `_has_any_provider_configured`, [`tui_gateway/methods_config.py`](tui_gateway/methods_config.py) `setup.runtime_check`. |
| **Fix** | Hide Providers BYOK chrome when `$okvevoAuth.signedIn`. Do not ask onboarding for `OPENROUTER_API_KEY` when signed in. Rewrite OpenAI-wire client to the OkVevo gateway whenever an ID token exists, except loopback (and native-adapter hosts left as the ambient gap). `setup.status` / `setup.runtime_check` treat `okvevo_signed_in()` as configured/usable. |
| **Verify** | Signed-in, no personal OpenRouter key: badge not `inference unavailable`; Providers Accounts/Keys/Custom Endpoints hidden; leftover OpenRouter/`base_url` cannot hit OpenRouter on the wire path; loopback local endpoint still works. Signed-out BYOK unchanged. |
| **Notes** | Step 0 closed 2026-09-05. Razorpay is not a build gate. **Does not fully close BYOK** — see the ambient native-provider row below. Landed 2026-09-05: readiness (`okvevo_signed_in` → configured/usable OpenRouter), hide Providers BYOK chrome + OpenRouter onboarding paste when signed in, OpenAI-wire rewrite except loopback/native-adapter hosts. |

### [ ] Signed-in ambient native-provider BYOK (Bedrock / env keys)

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Hiding Settings → Providers does not stop a signed-in user from selecting Bedrock (or Anthropic, OpenAI, Vertex, Copilot, …) when credentials already exist in the process environment, `~/.hermes/.env`, AWS/SSO files, or leftover `config.yaml`. Those native adapters never call `apply_okvevo_gateway`. Metering is skipped. |
| **Scope** | [`hermes_cli/model_switch.py`](hermes_cli/model_switch.py) `_has_fast_aws_sdk_signal` / `has_creds`; [`hermes_cli/auth.py`](hermes_cli/auth.py) `is_provider_explicitly_configured`; [`hermes_cli/inventory.py`](hermes_cli/inventory.py) `explicit_only`; Electron `process.env` inheritance + `~/.hermes/.env`; Settings → Model paste / picker Add provider |
| **Fix** | Either detect OkVevo sign-in and refuse non-gateway providers outright, or accept this as residual risk until then. **Do not build in the Phase 4 UI/wire pass.** |
| **Verify** | Signed-in, Providers tabs hidden, `AWS_ACCESS_KEY_ID`+secret (or `ANTHROPIC_API_KEY`) in env: Bedrock/Anthropic still listed in the model picker and a completion does not debit Firestore. After a real close: those rows gone (or blocked) when signed in. |
| **Notes** | Confirmed 2026-09-05. `has_creds` reads ambient `os.environ`, not the Providers UI. Desktop `explicit_only` still treats an access-key pair / `AWS_BEARER_TOKEN_BEDROCK` as explicit. Accepted residual for now (no live users). Do not describe Phase 4 as “closes BYOK.” |

### [ ] Gateway balance-check race (reserve before stream)

| Field | Value |
|-------|-------|
| **Gate** | Required before live (before accepting real payments) |
| **Risk if skipped** | `creditBalance > 0` is a read; the debit is a later write after the stream. Two concurrent requests can both pass the gate before either debits, so a near-zero balance can overspend by one extra completion. |
| **Scope** | `OkVevo-Web/src/lib/gateway/debit.ts`, `OkVevo-Web/src/app/api/gateway/chat/completions/route.ts` |
| **Fix** | Make pre-check and reservation atomic: one Firestore transaction that reserves an estimated cost up front, then reconcile (debit remainder or refund unused) after real usage is known. Do not keep read-then-later-write as the paid path. |
| **Verify** | Two parallel `/api/gateway/chat/completions` against `creditBalance` that only covers one request: only one is admitted (or the second is rejected / clamped without overspend). Ledger `balanceAfter` never goes negative. |
| **Notes** | Logged 2026-09-05 with Phase 3. Phase 3 ships the race as a known ceiling (`ponytail` in debit.ts). **Do not build this pass.** |

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

### [ ] Razorpay webhook still seeds old subscription credits (not users.creditBalance)

| Field | Value |
|-------|-------|
| **Gate** | Required before live (portal billing SoT) |
| **Risk if skipped** | After Phase 1, `/billing` reads `users.creditBalance` + top-level `creditTransactions`. Paid Razorpay invoices still write `users/{uid}/subscriptions.credits` only — portal shows **0** until Phase 3 rewires the webhook. |
| **Scope** | `OkVevo-Web/src/app/api/razorpay/webhook/route.ts` (separate git tree from this repo) |
| **Fix** | Phase 3.5 / Razorpay rework (not the LLM gateway pass): Admin grant to `users/{uid}.creditBalance` and top-level `creditTransactions` (`type: grant`). Stop treating subscription `credits` as SoT. No dual-read. |
| **Verify** | `invoice.paid` increases `users/{uid}.creditBalance`; `/billing` history shows a grant row. Client cannot write `creditBalance`. |
| **Notes** | Deferred 2026-09-04 with Phase 1 Firestore rules lock. Webhook intentionally untouched. |

---

## Should fix before live (lower severity)

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

---

## Closed

_(Move items here when done.)_

| Item | Closed | Commit / PR |
|------|--------|-------------|
| Next.js 16.3 vs App Hosting Cloud Build adapter | 2026-09-05 | pending commit. `okvevo-web` live at `https://okvevo-web--okvevo-testing.us-central1.hosted.app`. Adapter compiled Next **16.3.3**. First Cloud Build fail was Razorpay module-load, not the adapter. |
| Production LLM gateway SSE / Phase 3 checklist on App Hosting | 2026-09-05 | pending commit. Grant 10000 → streamed POST 200 `text/event-stream` + debit amount 1 (`creditBalance` 10000→9999) → zero-balance **402** `insufficient_quota` in 661ms. Signed-out BYOK: `test_okvevo_gateway.py` 8 passed. Cloud Run 300s unused; `minInstances` stayed 0. |
| Desktop auto-update git remote Nous → OkVevo-Nia; packaged apps use electron-updater at releases.okvevo.com | 2026-09-01 | pending commit (see `docs/FINISH-SIGNED-RELEASE.md` for the first signed tag) |
| First-install bootstrap clone/download URLs → OkVevo-Nia | 2026-08-31 | `07567979f4` |
| Installer SOUL.md seed + legacy Hermes upgrade | 2026-08-31 | `07567979f4` |
| Clone-shipped backend identity (Python, SOUL, locales, tests) | 2026-08-31 | `e23f5d5c05` |
| LOCAL_ONLY_V1 gates Settings → gateway Cloud/remote/SSH cards, cloud sign-in, connections registry, boot-failure cloud re-auth, and first-run “connect existing” | 2026-08-31 | pending commit (desktop visual rebrand; verify: Settings → gateway on a fresh profile — only the Local card) |
| `apps/desktop/package.json` author / repository.url / linux maintainer → OkVevo / OkVevo-Nia | 2026-08-31 | pending commit (desktop visual rebrand) |
