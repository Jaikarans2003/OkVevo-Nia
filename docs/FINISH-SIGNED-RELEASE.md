# Finish the signed Nia auto-update release

Scaffolding is in the repo. Certificates, the R2/S3 bucket, and DNS still have to exist before the first green pack. **Do not merge to `production` until those GitHub repository secrets are set.** Missing secrets fail the job on purpose.

The ship trigger is **not** a `v*` tag. Tags are labels created by `desktop-promote.yml`.

## 0. Hosting the feed (do this once)

electron-updater reads:

- Customers: `https://releases.okvevo.com/latest-mac.yml` and `latest.yml`
- Team (after `NIA_UPDATE_CHANNEL=internal`): `internal-mac.yml` / `internal.yml`
- Staging binaries: `https://releases.okvevo.com/staging/latest-mac.yml`

Enough:

1. An S3 or Cloudflare R2 bucket (public-read for the objects, or a public CDN in front).
2. DNS: `releases.okvevo.com` → that bucket (CNAME to the R2/S3/CloudFront hostname). Prefix `staging/` + root yml files.
3. HTTPS on the subdomain.

No app server. CI syncs `Nia-*` artifacts. Website buttons use the **stable** names `Nia-mac-arm64.dmg` / `Nia-win-x64.exe` (written only by promote).

## 1. GitHub Actions secrets

Repo: `Jaikarans2003/OkVevo-Nia` → Settings → Secrets and variables → Actions (**repository** secrets, not Environments).

Shared signing + feed: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, `RELEASES_S3_BUCKET`, `RELEASES_S3_ACCESS_KEY_ID`, `RELEASES_S3_SECRET_ACCESS_KEY`, optional `RELEASES_S3_ENDPOINT`.

Prefixed pack-env: `STAGING_OKVEVO_WEB_ORIGIN`, `PROD_OKVEVO_WEB_ORIGIN`, `STAGING_UPDATE_FEED_URL`, `PROD_UPDATE_FEED_URL`, and the six `STAGING_VITE_OKVEVO_FIREBASE_*` / `PROD_VITE_OKVEVO_FIREBASE_*` keys. Full table: [CI-CD.md](CI-CD.md).

Also confirm `apps/desktop/package.json` `build.win.signtoolOptions.publisherName` (`OkVevo`) matches the Authenticode subject CN.

Fail-closed checks:

```bash
node apps/desktop/scripts/require-release-secrets.mjs
node apps/desktop/scripts/write-okvevo-pack-env.mjs --require
```

## 2. How a build reaches customers

From the git root (`hermes-agent` / OkVevo-Nia). Push target is **`okvevo`**, never `origin` (Nous).

1. PR → `staging` → **Desktop staging** publishes under `/staging/`.
2. Reviewed PR → `production` → **Desktop production (internal channel)** uploads `internal.yml` only. `latest.yml` is unchanged.
3. Karan: Actions → **Desktop promote to latest** → `Run workflow` on branch `production`. That copies yml to `latest*` and stable installer names. Optional git tag `v{version}` is created **on this repository**.

Do **not** `git push origin v0.21.0`. Locally, if you ever need a tag: `git push okvevo v0.21.0`. CI promote is the supported path.

## 3. What “done” looks like

1. Staging pack green; a staging DMG Sign In hits the testing portal **without** `OKVEVO_WEB_ORIGIN` in `~/.hermes/.env`.
2. Production pack green; `https://releases.okvevo.com/internal-mac.yml` updates; `latest-mac.yml` does **not**.
3. After promote: `latest-mac.yml` / `latest.yml` match internal; `Nia-mac-arm64.dmg` / `Nia-win-x64.exe` exist.
4. Team apps with `NIA_UPDATE_CHANNEL=internal` updated from the production pack **before** promote; customer apps on `latest` update **after** promote.
5. `codesign --verify --deep --strict` on the Mac app; `Get-AuthenticodeSignature` Status `Valid` on the Windows exe.

Existing 0.20.x users still need **one** manual install after this first signed build.

## Still console work (not this file’s job)

- Create Firebase project `okvevo-prod`, live Razorpay, DNS, signing certs in GitHub — [CI-CD.md](CI-CD.md) and OkVevo-Web `docs/CI-CD.md`.
- Privatize OkVevo-Nia only after a GitHub-blocked fresh install succeeds (bundled snapshot).
