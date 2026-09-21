# CI/CD — staging and production (Nia desktop)

OkVevo-Nia stays **Environment-free** so privatizing the repo on GitHub Free does not drop secrets. Secrets are plain **repository** secrets. Approval for customer `latest.yml` is **Actions → Publish release** (`workflow_dispatch` on `desktop-publish.yml`), which still works on private Free. Do **not** create GitHub Environments.

Web portal CI lives in `OkVevo-Web/docs/CI-CD.md`.

## Product CI vs leftover Hermes workflows

Two kinds of Actions runs fire on this repo:

| Workflow | Job for Nia |
| -------- | ----------- |
| **Desktop staging** / **Desktop production** / **Publish release** | Ship path — packs and uploads to `releases.okvevo.com` |
| **CI** (`ci.yaml`) | Product regression gate on standard GitHub runners (`ubuntu-latest` / `macos-latest` / `windows-latest`) — Python/JS/Rust/installer/OSV/etc. |

Do **not** treat Hermes OSS checks (contributor attribution, Docs Site / Docusaurus, PR infographics, `ci-reviewed` label, Docker Hub image, Nix flake, curl\|install.sh upgrade matrix, live PR comment poller) as ship blockers. Those workflow files stay in `.github/workflows/` for accidental Nous syncs but are unplugged from `ci.yaml` or gated with `if: github.repository == 'NousResearch/hermes-agent'`.

Do **not** require branch protection to wait on Nous-sized larger runners (`ubuntu-latest-96-core`, `ubuntu-latest-32-core`). OkVevo-Nia has none of those labels.

Tag pushes run **Desktop production** (js-tests + pack). They do **not** run `ci.yaml` (`ci.yaml` is branch `push` / `pull_request` only).

## Triggers


| Event | What happens |
| ----- | ------------ |
| Push `staging` | Public pack, `STAGING_*` secrets, GitHub artifacts + upload to `s3://$BUCKET/staging/` including `latest*.yml` |
| Push tag `vX.Y.Z` (or `workflow_dispatch` on that tag ref) | js-tests, then public pack with that semver. Direct R2 archive of `Nia-{ver}-*` + blockmaps + `versions/{ver}/latest*.yml`. **Does not** write root `latest*.yml`, stable names, or `releases.json` |
| **Actions → Publish release** | Approval gate. Input `version` must match git tag `vX.Y.Z` and archived R2 objects. Copies stable names, writes `releases.json`, then root `latest*.yml` last. Smoke against public URLs |

Keep GitHub default as `main` until the first green staging pack, then rename default → `staging`. Do not push product work to `origin` (Nous). Local remote for push is `okvevo`.

`NiaInternal` / `pack:internal` is **never** a CI artifact.

`desktop-promote.yml` and the `desktop-release.yml` refuse-on-tag job are retired.

## Two-step production ship

1. **You** tag and push (never `origin`): `git tag vX.Y.Z && git push okvevo vX.Y.Z`.
2. **Desktop production** packs both OS jobs and archives that platform’s **full set** to R2 (mac: dmg+zip+zip.blockmap+`versions/{ver}/latest-mac.yml`; win: exe+exe.blockmap+`versions/{ver}/latest.yml`). Unpublished tag retries may re-upload that platform set. A version already in `releases.json` or in root `latest*.yml` is **immutable** — archive exits 1. Fix-forward = higher patch tag.
3. **You** run **Publish release** with that semver. Optional `mark_stable`. Pointer order is required: stable-name DMG/EXE (`Cache-Control: no-store`) → `releases.json` → `latest.yml` / `latest-mac.yml` last (`no-store`).
4. Smoke GETs public `latest*.yml`, listed files (sha512), and sibling `.blockmap` (200).

Version is the tag (`versionFromTag`). Staging still stamps `{package.json major}.{minor}.{github.run_number}`. Tags are `vX.Y.Z` only — no `-beta.1` (electron-updater `detectUpdateChannel` would pick a different yml).

Retry a failed archive with **workflow_dispatch** on the **existing tag ref**. The workflow fail-closes if `github.ref` is not `refs/tags/v*`. Two tags may pack in parallel (`concurrency` is per ref). Publish uses `group: desktop-production-publish` with `cancel-in-progress: false` so pointer flips never overlap.

## Repository secrets and variables

Settings → Secrets and variables → Actions. **Repository** secrets, not Environments. Never echo secret values in logs.

### Shared (signing + feed)

See [FINISH-SIGNED-RELEASE.md](FINISH-SIGNED-RELEASE.md): `CSC_*`, `APPLE_API_*`, `WIN_CSC_*`, `RELEASES_S3_*`.

### Prefixed (mapped by `pack_target`)


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

### Variable (not a secret)

`PROD_ALLOW_UNSIGNED` — `'true'` / `'1'` allows a production tag pack without Apple/Windows certs (feed secrets still required; logs `UNSIGNED PACK ALLOWED`). Unset/false → missing signing secrets fail the run. If Apple/`WIN_CSC` secrets **are** present, sign + notarize + verify still run (`mac_signing` / `win_signing` job outputs). Staging keeps `allow_unsigned: true` so the testing feed does not break before certs exist.

Missing origin/feed/Firebase Vite keys **fail the job** (`write-okvevo-pack-env.mjs --require`). Missing R2 secrets fail (`require-release-secrets.mjs`).

## `releases.json` (R2 root, public)

Array of `{ version, date, files: { mac, win }, status }`. Status:

- **`current`:** exactly one; the version root `latest*.yml` points at.
- **`stable`:** last version published with `mark_stable: true`, once it is no longer current. While it is current it stays `current`.
- **`available`:** other kept rows.
- **`withdrawn`:** reserved; no dispatch to set it.

Missing object = empty catalog `[]`. JSON keeps **current + stable + last N=10** by semver/date. Older rows drop from JSON only. CI **never deletes** R2 objects. Website reading this file is out of scope.

## Updater channels (`NIA_UPDATE_CHANNEL` vs `NIA_BUILD_CHANNEL`)

- **Build channel** (`NIA_BUILD_CHANNEL`): public vs internal-BYOK. CI always public.
- **Update channel** (`NIA_UPDATE_CHANNEL`): which yml electron-updater reads. Pack-env default is `latest`. Production no longer publishes `internal.yml`. Leave `NIA_UPDATE_CHANNEL` unset (or `latest`) on customer and team machines.

`detectUpdateChannel` is **false**. Production versions are the git tag, not `0.17.0-internal.N`.

## Bundled Python snapshot

`npm run build` writes `apps/desktop/build/agent-snapshot.tar.gz` + bundled `install.sh`/`install.ps1`. Packaged first launch extracts into `~/.hermes/hermes-agent` when the install stamp changes, then runs venv + python-deps. No `raw.githubusercontent.com`, no `git clone`. `git pull` cannot change the running agent (no `.git` in the snapshot).

## Team once

1. After a production **tag pack**: verify Sign In against the **prod** portal on Mac **and** Windows using the versioned DMG/EXE (`Nia-{ver}-*`). Root `latest.yml` is unchanged until Publish release.
2. Then Actions → **Publish release** → `version` = that semver → Run.
3. Only then privatize `Jaikarans2003/OkVevo-Nia` (fresh-install test must still work with GitHub blocked). See Phase C checklist below.

## Rollback

[`allowDowngrade = false`](../apps/desktop/electron/binary-updater.ts) in the shipped updater. electron-builder: that flag is taken into account only if the channel differs. Same-channel numeric downgrade will **not** auto-install.

| Who | What works |
| --- | --- |
| Has **not** updated | **Publish release** with the older archived `version` (re-points `latest*.yml`). |
| **Already** updated | Fix-forward: tag a **higher** patch and publish that. |
| Manual | Install `Nia-{old}-mac-arm64.dmg` / `Nia-{old}-win-x64.exe`. **`~/.hermes` data:** user config/sessions persist; a much older agent snapshot vs newer `~/.hermes` (or the reverse) can misbehave. No migration guarantee. Prefer fix-forward if they already ran the bad build. |

## Branch protection (`production`)

OkVevo-Nia: Settings → Rules → Rulesets → **New branch ruleset** named `production`.

- Target branch: `production`
- Block force pushes; restrict deletions
- Require a pull request before merging
- Required approvals: **0** until a second reviewer exists (you merge your own PR). Customer ship is **Actions → Publish release**, not the merge.

Do **not** create GitHub Environments named staging/production on this repo (Free-plan Environments die when the repo is privatized).

Same ruleset pattern on OkVevo-Web `production`, **plus** that repo’s Environment required-reviewer.

## Console (you)

1. Repo **variable** `PROD_ALLOW_UNSIGNED=1` for unsigned beta packs. Unset it before the first signed customer ship.
2. Confirm `RELEASES_S3_*` are **repository** secrets.
3. Optional: Cloudflare Cache Rule **Bypass** on `latest.yml`, `latest-mac.yml`, `releases.json`, `Nia-mac-arm64.dmg`, `Nia-win-x64.exe`. `no-store` already tells the cache not to store; `max-age=0` would still cache-and-revalidate.
4. After privatize: only you have write (tag control).

---

## Report only — do not implement in this phase

### R2 lifecycle / pricing

[Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/): prefix-filtered expire (e.g. delete `versions/` older than X days) or transition to Infrequent Access after 30 days. **Do not** put a lifecycle on `latest.yml` / stable names / `releases.json`. Lifecycle delete is a **console** choice; it would conflict with “CI never deletes” unless you accept that Cloudflare expires old prefixes later. Prefer: no lifecycle yet; 10 catalog entries; inspect the bucket by hand.

[R2 pricing](https://developers.cloudflare.com/r2/pricing/) **Standard free tier (monthly):** 10 GB-month storage, 1 million Class A (writes/lists), 10 million Class B (reads), **egress free**. Paid Standard: $0.015/GB-month, Class A $4.50/million, Class B $0.36/million. Infrequent Access is **not** on the free tier. Ten Electron builds (DMG+zip+exe+blockmaps ≈ a few GB) fit the 10 GB free tier with margin; do not enable IA for this bucket.

### R2 credential scope (staging vs production)

Persistent R2 S3 tokens are **bucket-level**, not prefix-level. [Authentication](https://developers.cloudflare.com/r2/api/tokens/): Object Read & Write may be scoped to a **set of buckets**. Access policy resources are `com.cloudflare.edge.r2.bucket.<account>_<jurisdiction>_<bucket>` — the whole bucket.

**Prefix scoping** exists only on **temporary credentials**: `prefixes: ["staging/"]` — [Temporary credentials](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/). Those expire; CI long-lived keys cannot use that as a standing GitHub secret.

**Standard fix if one bucket must serve both prefixes:** two buckets (`releases-staging` / `releases-prod`) each with its own Object Read & Write token; **or** accept one token for the whole bucket and rely on workflow isolation (staging workflow only writes `staging/`). Do not invent IAM prefix conditions on standing R2 tokens — Cloudflare does not document that for persistent API tokens.

### Repository rulesets restricting who can create `v*` tags (private Free)

[Available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets): **Restrict creations** — only users with bypass permissions can create branches or tags whose name matches the pattern.

GitHub Free personal lists **deployment protection rules for public repositories only**; **repository rules** are listed under **GitHub Enterprise**. Older GHES docs: rulesets on **private** repos need Pro/Team/Enterprise Cloud.

**On Free private: do not count on a `v*` tag ruleset.** Practical Free control: privatize so only write collaborators can push tags; keep write access to you alone. Pro would add **protected branches** on private; tag Restrict creations still needs you to confirm the Rulesets UI after any upgrade. This phase does not configure rulesets.

### Actions cost on private Free

[GitHub Actions billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions):

| Item | Documented |
| --- | --- |
| Included minutes (private) | **2,000 / month** (Free) |
| Artifact storage | **500 MB** (shared with Packages) — why production installers go to R2, not `upload-artifact` |
| Cache | 10 GB / repo (separate) |
| No payment method | *“usage is blocked once you use up your quota”* (hard stop) |
| Paid overage | Linux 2-core **$0.006**/min, Windows **$0.010**/min, macOS **$0.062**/min — [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) |

**Minute multipliers (2× Windows / 10× macOS):** those numbers were in older GitHub docs and were **removed** from the current billing page ([github/docs#45138](https://github.com/github/docs/issues/45138)). Current docs give **USD rates**, not included-minute multipliers. Rate ratios vs Linux $0.006: Windows ≈ **1.67×**, macOS ≈ **10.3×**. **Do not treat 2×/10× as currently documented** for the 2,000 included minutes. Conservative planning: assume macOS wall-clock is expensive; one 30 min `macos-latest` pack is in the same ballpark as ~300 Linux-minutes if GitHub still applies a ~10× included-minute factor, or 30 minutes if they count 1:1. **Verify in Settings → Billing after the first private run.**

**Spending limit:** create an Actions product budget of **$0** with **Stop usage when budget limit is reached** — [Budgets](https://docs.github.com/en/billing/managing-your-billing/using-budgets-control-spending). With no payment method, quota exhaustion already blocks jobs.

**Estimate (from workflow `timeout-minutes` and typical electron-builder, not live `gh run` timings):**

| Run | Jobs (wall, parallel where noted) | Risk to 2,000 min |
| --- | --- | --- |
| Staging push today | `desktop-pack`: macos 90 cap (~20–40 typical) + windows 90 cap (~15–30) + ubuntu publish ~5; **plus** `ci.yaml` Python tests timeout **60**, js-tests **30**, etc. | **One busy staging day can blow the private monthly quota** if `ci.yaml` still fires on every push |
| Production tag | js-tests ~10–25 + macos pack ~20–40 + windows pack ~15–30 (macos/windows parallel) | ~40–70 wall minutes; billable unknown until Billing UI |
| Publish dispatch | ubuntu ~3–8 | cheap |

Cadence ~5 days → ~6 production tags/month is probably fine **if staging+CI are not on every private push**.

**Stay in quota (not this phase):**

1. **Staging on demand:** change staging `on.push` to `workflow_dispatch` only, or add [`paths` filters](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#onpushpull_requestpull_request_targetpathspaths-ignore) so docs-only commits skip pack.
2. Do not run full `ci.yaml` on every `staging` push once private; keep it on PRs.
3. **Self-hosted runners:** GitHub Actions usage is free for self-hosted runners; you pay for the machines. Not implemented here.
4. Confirm **$0** Actions budget + included-usage emails at 90%/100%.

Staging still uses GitHub `upload-artifact` for installers. That can hit the **500 MB** private Free cap after privatize — see Phase C.

## Phase C checklist (before privatize — not implemented here)

1. Staging pack must upload installers **directly to R2** (no GitHub `upload-artifact`; 500 MB cap on private Free).
2. Staging must **not** run full pack + `ci.yaml` on every push (dispatch and/or `paths` filters) so private Actions minutes survive.
