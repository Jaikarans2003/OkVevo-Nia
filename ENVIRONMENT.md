# Environment config (testing ⇄ production)

12-factor: **behavior differs only because config values differ.** There is no `ENV=testing/production` branch in product code. Do not add one.

This file is the single reference for environment-dependent variables in **hermes-agent** (this repo) and **OkVevo-Web** (sibling tree). It supersedes any standalone “environment switch” note.

**Not this axis (leave as-is):** `hermes-dev://` vs `hermes://`, `HERMES_DESKTOP_DEV_SERVER`, `NODE_ENV=development`, Vite `:5174`, localhost defaults while OkVevo-Web `OKVEVO_ENV=local`. Those are local-dev tooling, not which Firebase/Razorpay project you pointed at.

**Manual, not env-driven:** OkVevo-Web `.firebaserc` (edit per clone). Do not generate it from env.

**Canonical go-live gates:** [PRE-LIVE-BACKLOG.md](PRE-LIVE-BACKLOG.md). Packaged `OKVEVO_WEB_ORIGIN` injection is its **own row** there (CI / first signed release). Next.js 16 vs App Hosting Cloud Build is a separate launch-blocker row.

---

## How values get into each process

### OkVevo-Web (Next.js)

**Local:** copy `.env.example` → `.env` and run `next dev`. Next reads `process.env` / `NEXT_PUBLIC_*` at build and server start.

**Deployed (Firebase App Hosting → Cloud Run):** `apphosting.yaml` `value:` for public and BUILD vars; Cloud Secret Manager for secrets (`secret:` names only). App Hosting does **not** bake the laptop `.env` (`.gitignore` excludes it; `firebase.json` `apphosting.ignore` also excludes `.env`). Cloud Build runs `npm run build` on the service; do not pre-run a local `next build` before `firebase deploy --only apphosting`.

firebase-tools uploads the source zip with GCS header `x-goog-content-length-range: 0,123289600` (~117MB). Over that, GCS returns XML and the CLI dies with `Unable to parse JSON`. Keep `apphosting.ignore` covering `.firebase`, `.next`, `node_modules`, and the unused `public/Nia` dump (no `src/` references). Do not raise the cap in product code.

Razorpay `new Razorpay(...)` must run inside the request handler, not at module load. `next build` collects route config with RUNTIME secrets unset; a top-level constructor throws `` `key_id` or `oauthToken` is mandatory ``. `RAZORPAY_*` secrets stay RUNTIME-only.

Testing origin is the App Hosting URL `https://<BACKEND_ID>--okvevo-testing.us-central1.hosted.app` (record after `apphosting:backends:create`), **not** `okvevo-testing.web.app`.

`OKVEVO_ENV=local | staging | production` only controls whether missing vars throw vs localhost defaults. `staging` and `production` are the same (fail-loud). It does **not** select a Firebase project. Do not invent `OKVEVO_ENV=testing`.

`firebase-admin` stays `^14`. Do not pin-downgrade for Hosting frameworksBackend — that path is deleted.

### Nia desktop (Electron + Python)

Electron loads the same files Python already uses (`node:util.parseEnv`, no dotenv npm):

1. Existing `process.env` (shell / CI) wins — never overwritten.
2. `~/.hermes/.env` (or `$HERMES_HOME/.env`) fills missing keys.
3. Unpackaged only: `hermes-agent/.env` (source checkout) fills remaining keys.

Then `buildDesktopBackendEnv` copies `OKVEVO_WEB_ORIGIN` and `OKVEVO_FIREBASE_ID_TOKEN_FILE` into the Python spawn. Python `load_hermes_dotenv()` still reads `~/.hermes/.env` with `override=True` — keep the two files consistent.

**Packaged app (Dock / Start Menu):** no shell. If `OKVEVO_WEB_ORIGIN` is unset after dotenv, Sign In / Upgrade / gateway **fail visibly**. They must not guess `www.okvevo.com` or `okvevo-testing.web.app`. Production DMGs get the value from **CI pack-time injection** — see PRE-LIVE-BACKLOG.

Copy [`.env.example`](.env.example) → `hermes-agent/.env` and/or `~/.hermes/.env`. Never commit secrets.

---

## Product variables (testing ⇄ production)

Secrets are never listed. “Testing source” is where the current testing value comes from, not the value.

| Name | Read by | Purpose | Testing source |
|------|---------|---------|----------------|
| `OKVEVO_WEB_ORIGIN` | hermes-agent `apps/desktop/electron/okvevo-auth.ts`, `backend-env.ts`; `agent/okvevo_gateway.py` | Portal origin for Sign In, Upgrade, LLM gateway | App Hosting `*.hosted.app` for backend `okvevo-web` on `okvevo-testing` |
| `OKVEVO_FIREBASE_ID_TOKEN_FILE` | Electron sets; Python `okvevo_gateway.py` reads | Path to rotating Firebase ID token (0600) | Electron-injected (`$HERMES_HOME/okvevo-firebase-id-token`). Do not set unless overriding. |
| `NEXT_PUBLIC_SITE_URL` | OkVevo-Web `src/config/env.ts` | SEO / metadataBase / OpenRouter HTTP-Referer | Same `*.hosted.app` origin (or localhost in local mode). `apphosting.yaml` `value`, BUILD+RUNTIME |
| `ALLOWED_ORIGINS` | OkVevo-Web `env.ts` | CORS allowlist | Testing hosted.app origin + localhost when developing. `apphosting.yaml` `value` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | OkVevo-Web `env.ts` → `firebase.ts` | Firebase JS client | okvevo-testing web app. yaml `value` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | same | Auth domain | okvevo-testing Firebase Auth |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | same | Project id | Firebase project `okvevo-testing` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | same (required outside local) | Storage bucket | okvevo-testing Storage |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | same | FCM sender | okvevo-testing |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | same | Firebase app id | okvevo-testing web app |
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` | same (optional; else derived) | RTDB URL | okvevo-testing RTDB |
| `FIREBASE_SERVICE_ACCOUNT_KEY` / `FB_SERVICE_ACCOUNT_KEY` | OkVevo-Web `src/lib/firebase-admin.ts` | Admin SDK (base64 JSON) | Secret Manager `FIREBASE_SERVICE_ACCOUNT_KEY`. Local alias `FB_SERVICE_ACCOUNT_KEY` |
| `OPENROUTER_API_KEY` | OkVevo-Web gateway `route.ts` / `pricing.ts`; optional hermes-agent BYOK | Server key for the LLM proxy (web) or user BYOK (desktop) | Secret Manager `OPENROUTER_API_KEY` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `NEXT_PUBLIC_RAZORPAY_KEY_ID` | OkVevo-Web `env.ts` / `razorpay.ts` | Checkout + server API | Public key: yaml `value`. Server secrets: Secret Manager |
| `RAZORPAY_STARTER_PLAN_ID` / `RAZORPAY_STARTER_ANNUAL_PLAN_ID` | `env.ts` | Starter plan ids | Razorpay test-mode plans. yaml `value` |
| `RAZORPAY_HOBBY_PLAN_ID` / `RAZORPAY_HOBBY_ANNUAL_PLAN_ID` | `env.ts` | Hobby plan ids | yaml `value` |
| `RAZORPAY_PRO_PLAN_ID` / `RAZORPAY_PRO_ANNUAL_PLAN_ID` | `env.ts` | Pro plan ids | yaml `value` |
| `RAZORPAY_WEBHOOK_SECRET` | webhook route | HMAC verify | Secret Manager. Webhook URL must be the hosted.app origin |
| `RAZORPAY_AFFILIATE_OFFER_ID` | create-subscription route | Affiliate offer | Razorpay test offer (optional) |
| `ADMIN_EMAILS` | `firebase-admin.ts` | Admin claim fallback | yaml `value` |
| `OKVEVO_ENV` | OkVevo-Web `env.ts` | Missing-var strictness only | `local` on laptops; `staging` in `apphosting.yaml`. Not a project switch |
| `AGENT_URL` | `env.ts` | Legacy agent proxy default | localhost in local mode; yaml `value` on deploy |
| `NEXT_PUBLIC_AGENT_API_ORIGIN` | `env.ts` | Optional same-origin override for old `/api/agent` SSE | Empty = same origin; do not hardcode `*.run.app` in source |
| `NEXT_PUBLIC_MARKETING_VIDEO_URL` / `NEXT_PUBLIC_DEMO_VIDEO_URL` | `env.ts` | Marketing/demo video hrefs | Testing Storage or empty |
| `NEXT_PUBLIC_BYPASS_SUBSCRIPTION` | subscription middleware | Dev bypass | Unset in any shared testing deploy |
| `HEYGEN_CALLBACK_SECRET` | HeyGen webhook HMAC | Legacy callback | Only if that route is still used |
| `HYPERFRAMES_BUCKET` / `AWS_REGION` | leftover agent bundle | Old AI Studio paths still read | Unused for Nia desktop; fail-loud outside local if still required |
| `AGENT_BACKEND` / `AGENTCORE_RUNTIME_ARN` | `env.ts` / agentcore.ts | Abandoned AgentCore | Leave empty; do not build Cloud Nia on this |

LLM provider keys for **desktop BYOK** (`OPENROUTER_API_KEY`, Fireworks, etc.) stay documented in [`.env.example`](.env.example). They are user credentials, not OkVevo testing vs production project IDs.

---

## Hardcoded URLs that are *not* the portal switch

| URL | Where | Role | This pass |
|-----|-------|------|-----------|
| `https://releases.okvevo.com` | `apps/desktop/electron/binary-updater.ts` | electron-updater feed (**runtime**, not display-only) | Leave. Different axis from Sign In origin. |
| `https://www.okvevo.com` | `apps/desktop/src/app/settings/about-settings.tsx` | Get installer / release notes | Leave (marketing). PRE-LIVE download page may retarget. |
| `https://releases.okvevo.com/placeholder/...` | OkVevo-Web `src/app/nia/page.tsx` | Download CTAs | Placeholder hrefs; leave |
| `Jaikarans2003/OkVevo-Nia` raw/git URLs | bootstrap / install | First-install clone | Product identity; not this pass |

---

## Fail-closed rules

- **Unpackaged + Vite dev server, origin unset:** `http://localhost:3000` (local-dev axis). `hermes-dev://` unchanged.
- **Packaged / non-dev, origin unset:** visible error (Electron dialog + chat sentence). Never `www.okvevo.com`, never `okvevo-testing.web.app`.
- **Python:** signed-in (ID token on disk) + origin unset → `OkvevoGatewayConfigError` whose `str()` is the chat bubble. Conversation loop must return that string as `final_response` immediately — not retry until a traceback-shaped apology.

---

## Switching testing ⇄ production (checklist)

1. OkVevo-Web: put public vars in `apphosting.yaml` `value:` and secrets in Secret Manager. Deploy: `npm run deploy` → `firebase deploy --only apphosting --project testing`. `.firebaserc` alias `testing` → `okvevo-testing` until you point that file (manually) at another project.
2. Desktop: set `OKVEVO_WEB_ORIGIN` in `~/.hermes/.env` to the **hosted.app** URL (and restart Nia). Do not add an `if (testing)` in source.
3. Firebase Auth authorized domains, Razorpay webhook URL, and `ALLOWED_ORIGINS` must include that same origin.
4. First **signed** customer build: PRE-LIVE row — CI injects `OKVEVO_WEB_ORIGIN`; do not revive a hardcoded domain to skip that job.
5. After first App Hosting rollout: Cloud Run default request timeout is 300s (old Functions ceiling was 800). Raise toward 800 only if streamed chats die at 5 minutes. Do not set `minInstances: 1` unless the live test stalls.
