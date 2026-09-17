# CI/CD — staging and production (Nia desktop)

OkVevo-Nia stays **Environment-free** so privatizing the repo on GitHub Free does not drop secrets. Secrets are plain repository secrets. `production` is protected by branch protection. Customer `latest.yml` is `workflow_dispatch` (`desktop-promote.yml`), not a merge.

Web portal CI lives in `OkVevo-Web/docs/CI-CD.md`.

## Branches


| Branch                                            | What happens                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `staging`                                         | Public pack, `STAGING_*` secrets, upload to `s3://$BUCKET/staging/` including `latest*.yml`                                            |
| `production`                                      | Public pack, `PROD_*` secrets, upload versioned `Nia-*` + `internal.yml` / `internal-mac.yml` only                                     |
| `workflow_dispatch` **Desktop promote to latest** | Copy `internal*.yml` → `latest*.yml`; copy DMG/NSIS to `Nia-mac-arm64.dmg` / `Nia-win-x64.exe`; optional tag `v{version}` on this repo |


Keep GitHub default as `main` until the first green staging pack, then rename default → `staging`. Do not push product work to `origin` (Nous). Local remote for push is `okvevo`.

`NiaInternal` / `pack:internal` is **never** a CI artifact.

## Repository secrets (Settings → Secrets and variables → Actions)



### Shared (signing + feed)

See [FINISH-SIGNED-RELEASE.md](FINISH-SIGNED-RELEASE.md): `CSC_*`, `APPLE_API_*`, `WIN_CSC_*`, `RELEASES_S3_*`.

### Prefixed (mapped by branch)


| Staging                                                           | Production                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `STAGING_OKVEVO_WEB_ORIGIN`                                       | `PROD_OKVEVO_WEB_ORIGIN`                                     |
| `STAGING_UPDATE_FEED_URL` = `https://releases.okvevo.com/staging` | `PROD_UPDATE_FEED_URL` = `https://releases.okvevo.com`       |
| `STAGING_VITE_OKVEVO_FIREBASE_API_KEY`                            | `PROD_VITE_OKVEVO_FIREBASE_*` (same six Firebase web fields) |
| `STAGING_VITE_OKVEVO_FIREBASE_AUTH_DOMAIN`                        |                                                              |
| `STAGING_VITE_OKVEVO_FIREBASE_PROJECT_ID`                         |                                                              |
| `STAGING_VITE_OKVEVO_FIREBASE_STORAGE_BUCKET`                     |                                                              |
| `STAGING_VITE_OKVEVO_FIREBASE_MESSAGING_SENDER_ID`                |                                                              |
| `STAGING_VITE_OKVEVO_FIREBASE_APP_ID`                             |                                                              |


Missing origin/feed/Firebase Vite keys **fail the job** (`write-okvevo-pack-env.mjs --require`). Missing R2 secrets fail (`require-release-secrets.mjs`). Signing secrets fail-closed for **production**; staging may pack unsigned (`NIA_ALLOW_UNSIGNED=1`) until certs exist.

## Updater channels (`NIA_UPDATE_CHANNEL` vs `NIA_BUILD_CHANNEL`)

- **Build channel** (`NIA_BUILD_CHANNEL`): public vs internal-BYOK. CI always public.
- **Update channel** (`NIA_UPDATE_CHANNEL`): which yml electron-updater reads. Pack-env default is `latest`. Team machines set `NIA_UPDATE_CHANNEL=internal` once in `~/.hermes/.env` so the **public** Nia.app tracks `internal.yml` after a production pack. Customer apps have no env → `latest.yml` after promote.

`detectUpdateChannel` is **false**. Versions are `{package.json major}.{minor}.{github.run_number}` (not `0.17.0-internal.N`).

## Bundled Python snapshot

`npm run build` writes `apps/desktop/build/agent-snapshot.tar.gz` + bundled `install.sh`/`install.ps1`. Packaged first launch extracts into `~/.hermes/hermes-agent` when the install stamp changes, then runs venv + python-deps. No `raw.githubusercontent.com`, no `git clone`. `git pull` cannot change the running agent (no `.git` in the snapshot).

## Team once

1. `NIA_UPDATE_CHANNEL=internal` in `~/.hermes/.env` on machines that should see production-internal builds.
2. Keep NiaInternal.app for BYOK engineering (`pack:internal`).
3. After a production pack: verify Sign In against the **prod** portal on Mac **and** Windows.
4. Then Actions → **Desktop promote to latest**.
5. Only then privatize `Jaikarans2003/OkVevo-Nia` (fresh-install test must still work with GitHub blocked).



## Branch protection (`production`)

OkVevo-Nia: Settings → Rules → Rulesets → **New branch ruleset** named `production`.

- Target branch: `production`
- Block force pushes; restrict deletions
- Require a pull request before merging
- Required approvals: **0** until a second reviewer exists (you merge your own PR). Customer ship is **Actions → Desktop promote to latest**, not the merge.

Do **not** create GitHub Environments named staging/production on this repo (Free-plan Environments die when the repo is privatized).

Same ruleset pattern on OkVevo-Web `production`, **plus** that repo’s Environment required-reviewer.
