# Finish the signed Nia auto-update release

Scaffolding is in the repo. Certificates, the R2/S3 bucket, and DNS still have to exist before the first **signed** customer pack. Missing secrets fail the production job unless repository variable `PROD_ALLOW_UNSIGNED` is `'true'`/`'1'` (unsigned beta only; log line `UNSIGNED PACK ALLOWED`).

**Pack trigger:** push git tag `vX.Y.Z` to `okvevo` (never `origin` / Nous). That archives versioned objects and does **not** move live pointers.

**Customer ship trigger:** Actions → **Publish release** → `version` = that semver → Run workflow. That is the Free-plan approval gate (no GitHub Environments).

## 0. Hosting the feed (do this once)

electron-updater reads:

- Customers: `https://releases.okvevo.com/latest-mac.yml` and `latest.yml`
- Staging binaries: `https://releases.okvevo.com/staging/latest-mac.yml`

Enough:

1. An S3 or Cloudflare R2 bucket (public-read for the objects, or a public CDN in front).
2. DNS: `releases.okvevo.com` → that bucket (CNAME to the R2/S3/CloudFront hostname). Prefix `staging/` + root yml files + `releases.json`.
3. HTTPS on the subdomain.

No app server. CI uploads `Nia-*` artifacts. Website buttons use the **stable** names `Nia-mac-arm64.dmg` / `Nia-win-x64.exe` (written only by **Publish release**, `Cache-Control: no-store`). Versioned binaries use `public, max-age=31536000, immutable`.

Archived per version (CI never deletes):

- `Nia-{ver}-mac-arm64.dmg` / `.zip` / `.zip.blockmap` (and any other `Nia-{ver}-*` electron-builder emits)
- `Nia-{ver}-win-x64.exe` / `.exe.blockmap`
- `versions/{ver}/latest.yml` and `versions/{ver}/latest-mac.yml`

## 1. GitHub Actions secrets and variables

Repo: `Jaikarans2003/OkVevo-Nia` → Settings → Secrets and variables → Actions (**repository** secrets, not Environments).

Shared signing + feed: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, `RELEASES_S3_BUCKET`, `RELEASES_S3_ACCESS_KEY_ID`, `RELEASES_S3_SECRET_ACCESS_KEY`, optional `RELEASES_S3_ENDPOINT`.

Prefixed pack-env: `STAGING_OKVEVO_WEB_ORIGIN`, `PROD_OKVEVO_WEB_ORIGIN`, `STAGING_UPDATE_FEED_URL`, `PROD_UPDATE_FEED_URL`, and the six `STAGING_VITE_OKVEVO_FIREBASE_*` / `PROD_VITE_OKVEVO_FIREBASE_*` keys. Full table: [CI-CD.md](CI-CD.md).

Repository **variable** `PROD_ALLOW_UNSIGNED=1` for unsigned production tag packs during beta. Unset before the first signed customer ship. If Apple/`WIN_CSC` secrets are present, sign+notarize+verify still run.

Also confirm `apps/desktop/package.json` `build.win.signtoolOptions.publisherName` (`OkVevo`) matches the Authenticode subject CN.

Fail-closed checks:

```bash
node apps/desktop/scripts/require-release-secrets.mjs
node apps/desktop/scripts/write-okvevo-pack-env.mjs --require
```

Optional console: Actions product budget **$0** (stop when reached); Cloudflare Cache Rule Bypass on `latest*.yml`, `releases.json`, and stable names.

## 2. How a build reaches customers

From the git root (`hermes-agent` / OkVevo-Nia). Push target is **`okvevo`**, never `origin` (Nous).

1. PR → `staging` → **Desktop staging** publishes under `/staging/`.
2. `git tag vX.Y.Z` (strict `vX.Y.Z`, no prerelease) → `git push okvevo vX.Y.Z` → **Desktop production** (js-tests, then pack). R2 gets `Nia-{ver}-*` + `versions/{ver}/`. **Root `latest.yml` is unchanged.**
3. Karan: Actions → **Publish release** → `version` = `X.Y.Z` or `vX.Y.Z` → Run. Copies stable installer names, writes `releases.json`, then `latest*.yml` last. Optional `mark_stable`.
4. Smoke must be green. curl `latest-mac.yml` / `latest.yml` / `releases.json` / stable names.

Do **not** `git push origin v0.21.0`. Locally: `git push okvevo v0.21.0`.

Rollback: Publish an **older archived** version to re-point `latest*.yml` for users who have not updated. Already-updated apps do **not** downgrade (`allowDowngrade: false`). Fix-forward is a higher patch. Details: [CI-CD.md](CI-CD.md).

## 3. What “done” looks like

1. Staging pack green; a staging DMG Sign In hits the testing portal **without** `OKVEVO_WEB_ORIGIN` in `~/.hermes/.env`.
2. Tag pack green; `https://releases.okvevo.com/Nia-{ver}-*` and `versions/{ver}/latest-mac.yml` exist; **`latest-mac.yml` at the bucket root does not change**.
3. After Publish release: `latest-mac.yml` / `latest.yml` version field matches the tag; `Nia-mac-arm64.dmg` / `Nia-win-x64.exe` exist; `releases.json` has `status: current` for that version.
4. Mac: install the DMG. Unsigned in-app update still will not swap until Apple signs (Phase A overlay reports the error; it does not hang).
5. Windows: unsigned + `publisherName` → Phase A `UPD-SIGNATURE`; download the EXE from the stable name or versioned object.
6. Rollback drill: Publish an older archived version; `latest.yml` version field matches; already-updated apps do not downgrade.
7. When certs exist: `codesign --verify --deep --strict` on the Mac app; `Get-AuthenticodeSignature` Status `Valid` on the Windows exe. Adding Apple secrets needs **no YAML edit**.

Existing 0.20.x users still need **one** manual install after this first signed build.

## Still console work (not this file’s job)

- Create Firebase project `okvevo-prod`, live Razorpay, DNS, signing certs in GitHub — [CI-CD.md](CI-CD.md) and OkVevo-Web `docs/CI-CD.md`.
- Privatize OkVevo-Nia only after a GitHub-blocked fresh install succeeds (bundled snapshot) **and** the Phase C staging-artifact / Actions-minute items in [PRE-LIVE-BACKLOG.md](../PRE-LIVE-BACKLOG.md) are closed.
- R2 lifecycle, prefix-scoped tokens, `v*` tag rulesets, and Actions quota savings are **report-only** in [CI-CD.md](CI-CD.md) — do not implement them as CI.
