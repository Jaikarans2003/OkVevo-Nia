# Finish the signed Nia auto-update release

Scaffolding is in the repo. This file is the five-minute finish once certificates and the feed bucket exist. **Do not cut a version tag until the secrets below are in GitHub.** An accidental `v*` tag with empty secrets is designed to fail closed (that is the safety test).

## 0. Hosting the feed (do this once)

electron-updater reads `https://releases.okvevo.com/latest-mac.yml` and `https://releases.okvevo.com/latest.yml`. That host is independent of the www.okvevo.com redesign.

Enough:

1. An S3 or Cloudflare R2 bucket (public-read for the objects, or a public CDN in front).
2. DNS: `releases.okvevo.com` → that bucket (CNAME to the R2/S3/CloudFront hostname).
3. HTTPS on the subdomain (R2 custom domain or CloudFront).

No app server. The CI job syncs `Nia-*` artifacts and `latest*.yml` into the bucket root.

Installer downloads for humans stay on **https://www.okvevo.com** until marketing adds a dedicated download page.

## 1. GitHub Actions secrets

Repo: `Jaikarans2003/OkVevo-Nia` → Settings → Secrets and variables → Actions.

| Secret | What it is |
|--------|------------|
| `CSC_LINK` | Developer ID Application certificate, base64 PKCS#12 (same family as first-install DMG signing) |
| `CSC_KEY_PASSWORD` | Password for that p12 |
| `APPLE_API_KEY` | App Store Connect API `.p8` contents (or a path CI can read) |
| `APPLE_API_KEY_ID` | Key ID |
| `APPLE_API_ISSUER` | Issuer UUID |
| `WIN_CSC_LINK` | Windows Authenticode certificate, base64 PKCS#12 |
| `WIN_CSC_KEY_PASSWORD` | Password for that p12 |
| `RELEASES_S3_BUCKET` | Bucket name for the feed |
| `RELEASES_S3_ACCESS_KEY_ID` | Access key that can `s3:PutObject` on that bucket |
| `RELEASES_S3_SECRET_ACCESS_KEY` | Secret key |
| `RELEASES_S3_ENDPOINT` | Optional. Required for R2, e.g. `https://<accountid>.r2.cloudflarestorage.com`. Omit for AWS S3. |

Also confirm `apps/desktop/package.json` `build.win.signtoolOptions.publisherName` (`OkVevo`) matches the Authenticode subject CN. Change that string if the cert CN is different.

Fail-closed check (must print the missing list and exit 1 until secrets are set in *your shell*; CI maps the GitHub secrets):

```bash
node apps/desktop/scripts/require-release-secrets.mjs
```

## 2. The single command once secrets exist

From the git root (`hermes-agent` / `OkVevo-Nia`), on `main`, with a clean tree:

```bash
# 1. Set apps/desktop/package.json "version" to the tag without the v (example: 0.21.0)
# 2. Commit that bump, then:
git tag v0.21.0
git push origin v0.21.0
```

Use a version that is **greater than** whatever is already in shipped `package.json` (today that is `0.17.0`). electron-updater compares those numbers, not git SHAs.

Do **not** use `git push --tags` unless you intend every local tag to go up.

The workflow is `.github/workflows/desktop-release.yml`, trigger `push` of `v*`.

## 3. What “done” looks like

1. GitHub Action **Desktop signed release** is green (require-secrets → macOS → Windows → publish-feed).
2. Feed files exist:
   - `https://releases.okvevo.com/latest-mac.yml`
   - `https://releases.okvevo.com/latest.yml`
   - matching `Nia-<version>-mac-arm64.zip` / `.dmg` and `Nia-<version>-win-x64.exe`
3. On a packaged install whose version is **lower** than the tag: About → Check now → update offered → Install → app restarts at `app.getVersion()` equal to the tag. A git push to `main` with no tag does **not** offer an update.
4. `codesign --verify --deep --strict` on the Mac zip payload; `Get-AuthenticodeSignature` Status `Valid` on the Windows exe listed in `latest.yml`.

Existing 0.20.x users still need **one** manual install from www.okvevo.com after this first tagged build; the old git updater cannot inject electron-updater into a frozen asar.

## Still open after the first tag (not this file’s job)

- Pin the bundled agent/runtime to the same release so `git pull` of `~/.hermes` cannot desync UI vs backend.
- First-install bootstrap still fetches `raw.githubusercontent.com` (private-repo hard gate in `PRE-LIVE-BACKLOG.md`).
- Dedicated www.okvevo.com download page (About already links the homepage).
