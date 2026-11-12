# OkVevo — product memory (OkVevo-Nia)

Last updated: 2026-11-12.

## Product pivot (authoritative)

Two surfaces only:

1. **OkVevo desktop app** (Mac/Windows) — white-labeled Hermes Agent (Nous Research, MIT). Local-only v1.
2. **OkVevo-Web** — marketing + customer portal (accounts, Razorpay, two-bucket credits, download CTAs).

**Nia is the retired name.** Never use it in user-facing text or new names (files, brands, URLs, copy). Keep internal ids:

- `~/.hermes`, `hermes` CLI, `hermes://`, `HERMES_*`, Python module paths
- Protocol handle `@hermes` (display alias `@okvevo`)
- GitHub repo slug `Jaikarans2003/OkVevo-Nia` (public for now)

Canonical remotes: push only `okvevo` → OkVevo-Nia; `origin` → Nous is fetch-only.

## Who and how we work

Karan is founder and sole engineer of **OkVevo**. Non-technical — architecture and prompts in, review out. No manual coding.

Standing directive: surgical changes, state assumptions, flag simpler alternatives. Ask before every commit, push, tag, or PR merge. **Never push directly to `staging` or `main`** — feature/fix branch → PR → staging (team tests) → PR staging → main → production via tag `vX.Y.Z` + **Publish release**.

He verifies on **Mac and Windows** before builds go to internal testers.

## Hard gates vs unsigned beta

Canonical: `PRE-LIVE-BACKLOG.md`.

- **Hard gate:** do not privatize `OkVevo-Nia` until bootstrap fresh-install (GitHub blocked) is proven; plus any RELEASE BLOCKERs listed there.
- **Required before public launch:** code signing (Mac notarize + Windows Authenticode). Unsigned beta is allowed with `PROD_ALLOW_UNSIGNED`.

## Upstream / OkVevo deltas

Every OkVevo change lives in OkVevo-owned files, overrides, or tiny hooks listed in `docs/okvevo/PATCHES.md`, so upstream syncs keep them. Ledgers: `PATCHES.md`, `WORKAROUNDS.md`, `UI-CONTRACT.md`, `SYNC.md`, `NOUS-TOUCHPOINTS.md`, `VENDOR-TOUCHPOINTS.md`. Sync checklist: `/okvevo-sync`.

Deferred code rename: `brand/nia.json` → `brand/okvevo.json`.

## Release feeds (truth)

- Staging: `https://releases.okvevo.com/okvevo/staging`
- Production app: `https://releases.okvevo.com/okvevo/stable` (`latest.yml` / `latest-mac.yml`)
- Only **Publish release** should make a version live; tag pack writing `okvevo/stable/latest*.yml` is a PRE-LIVE gap until fixed.

## Do not

- Resurrect text2vid / AI Studio / AgentCore / Stripe / “Nia” as the product name.
- Push to Nous (`origin`).
- Put Razorpay/credits SoT in Hermes `credits_tracker`.
- Rename `~/.hermes` or the `hermes` CLI unless explicitly asked.
