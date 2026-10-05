# Upstream sync log

Append one row after each approved sync batch lands on `staging`.

## Shipped releases

Customer tags. Last synced sha is the newest Hermes commit taken in that tag, not a full `origin/main` sync.

| Version | What shipped | Last synced `origin/main` sha | Backport ratio |
|---------|--------------|-------------------------------|----------------|
| **v0.18.2** (tag 2026-09-28, commit `5512f3a9d7`) | Batch 0 [#15](https://github.com/Jaikarans2003/OkVevo-Nia/pull/15) and Batch 1 SECURITY [#16](https://github.com/Jaikarans2003/OkVevo-Nia/pull/16). Tag sits on the #16 merge. | `b534f4b8c8` | **63%** (12/19) |
| **v0.18.3** (tag 2026-09-28, commit `40c9a4e37b`) | Electron 40.10.6 → 44.4.5 [#18](https://github.com/Jaikarans2003/OkVevo-Nia/pull/18), then staging → main [#19](https://github.com/Jaikarans2003/OkVevo-Nia/pull/19). | `b534f4b8c8` (unchanged; Electron is not a Hermes sha) | — |
| **v0.18.4** (tag 2026-10-04, commit `6d906ef1b9`) | Staging → main [#32](https://github.com/Jaikarans2003/OkVevo-Nia/pull/32). In the tree: branding scrub [#20](https://github.com/Jaikarans2003/OkVevo-Nia/pull/20), PyJWT bump [#21](https://github.com/Jaikarans2003/OkVevo-Nia/pull/21), branding polish [#22](https://github.com/Jaikarans2003/OkVevo-Nia/pull/22), CI dependency-review [#24](https://github.com/Jaikarans2003/OkVevo-Nia/pull/24), Dependabot → staging [#25](https://github.com/Jaikarans2003/OkVevo-Nia/pull/25), Batch 1b [#26](https://github.com/Jaikarans2003/OkVevo-Nia/pull/26), About OSS removal [#27](https://github.com/Jaikarans2003/OkVevo-Nia/pull/27), Batch 2a [#28](https://github.com/Jaikarans2003/OkVevo-Nia/pull/28), delta step 1 assets [#29](https://github.com/Jaikarans2003/OkVevo-Nia/pull/29), delta step 2 locales [#30](https://github.com/Jaikarans2003/OkVevo-Nia/pull/30), test fixes [#33](https://github.com/Jaikarans2003/OkVevo-Nia/pull/33) and [#34](https://github.com/Jaikarans2003/OkVevo-Nia/pull/34). | `0466a04bc874` (Batch 2a newest taken sha). Batch 1b watermark `6c3aae398ade` is older and still the 1b line. | Batch 2 inventory table **75%** (21/28). Batch 2a landed slice **67%** (6/9). |

Merge commits for #20–#26 are not ancestors of the v0.18.4 tag. Their file changes are in the tree #32 merged.

| Date | Last synced `origin/main` sha | Strategy | PR | Notes |
|------|-------------------------------|----------|-----|-------|
| _(none yet)_ | — | — | — | Batch 0 created this file; no Hermes code synced. |
| 2026-09-25 | `b534f4b8c8` (Batch 1 SECURITY last taken sha) | **B** selective cherry-picks | [#16](https://github.com/Jaikarans2003/OkVevo-Nia/pull/16) shipped in **v0.18.2** | Replay rejected (U3). Ratio **63%**. See Backports. |
| 2026-10-01 | `6c3aae398ade` (Batch 1b SECURITY last taken sha) | **B** selective cherry-picks | [#26](https://github.com/Jaikarans2003/OkVevo-Nia/pull/26) shipped in **v0.18.4** | SimpleX + secret revoke + managed scope + at-rest caches. computer_use parts of `6c3aae398ade` excluded. |
| 2026-09-25 | n/a (Electron major, not Hermes sha) | **Phase 4** Electron 40→44 | [#18](https://github.com/Jaikarans2003/OkVevo-Nia/pull/18) shipped in **v0.18.3** (release [#19](https://github.com/Jaikarans2003/OkVevo-Nia/pull/19)) | Target **44.4.5**. Merge `38be2aa0f3`. |
| 2026-09-29 | n/a (branding scrub, not a Hermes sha) | **Phase 5** user-visible Hermes/Nous scrub | [#20](https://github.com/Jaikarans2003/OkVevo-Nia/pull/20) shipped in **v0.18.4** | `check_nia_branding.py` scans i18n, Electron/renderer strings, installer UI, EXE/plist metadata, CLI catalog, and help links. Internal ids and copyright kept, including `X-Hermes-Session-Token`. |
| 2026-09-30 | n/a (branding polish, not a Hermes sha) | Product copyright + OSS notice | [#22](https://github.com/Jaikarans2003/OkVevo-Nia/pull/22) shipped in **v0.18.4** | Product line is `© 2026 Azonova Technologies Pvt Ltd`. Hermes MIT text stays in `LICENSE` / `NOTICE`. Nous Discord link removed from the cloud-down message. Cloud recovery screen stays behind `LOCAL_ONLY_V1`. About OSS section removed later in #27. |
| 2026-10-01 | n/a (CI, not a Hermes sha) | dependency-review on the PR diff | [#24](https://github.com/Jaikarans2003/OkVevo-Nia/pull/24) shipped in **v0.18.4** | PRs fail only on high/critical advisories the diff introduces. |
| 2026-10-01 | n/a (CI, not a Hermes sha) | Dependabot → staging | [#25](https://github.com/Jaikarans2003/OkVevo-Nia/pull/25) shipped in **v0.18.4** | github-actions bumps target `staging`. |
| 2026-10-01 | n/a (OSS UI removal, not a Hermes sha) | Notice file only | [#27](https://github.com/Jaikarans2003/OkVevo-Nia/pull/27) shipped in **v0.18.4** | About no longer shows Open-source licenses. `THIRD_PARTY_NOTICES.txt` stays in `extraResources` (Mac `Contents/Resources`, Windows `resources`). `/legal/open-source` on OkVevo-Web is later. |
| 2026-10-02 | `0466a04bc874` (newest sha in this batch only; not a full `origin/main` sync) | **B** selective cherry-picks | [#28](https://github.com/Jaikarans2003/OkVevo-Nia/pull/28) shipped in **v0.18.4** | Batch 2a. Ratio **67%** (6/9). Skipped `87bb0d3827a0`. |
| 2026-10-03 | n/a (delta layer, not a Hermes sha) | Brand assets overlay | [#29](https://github.com/Jaikarans2003/OkVevo-Nia/pull/29) shipped in **v0.18.4** | Delta step 1. Icons live in `brand/assets/` and copy at pack time. |
| 2026-10-03 | n/a (delta layer, not a Hermes sha) | Locale overlay | [#30](https://github.com/Jaikarans2003/OkVevo-Nia/pull/30) shipped in **v0.18.4** | Delta step 2. Nia catalogs ship from `brand/locales/`. |
| 2026-10-04 | n/a (dependency pins, not a Hermes sha) | **B** lock bumps | Batch 1c on `sync/batch1c-security` | httpx2 2.7.0→2.12.0. httpcore2 moves to 2.12.0 because httpx2 2.12.0 requires that exact version; the advisory floor is 2.10.0. tornado 6.5.8→6.5.9 on the messaging extra and the Telegram lazy-install pin. Desktop dompurify 3.4.13→3.4.16. Website, photon, ui-tui, and dev-only npm left alone. |

## Phase 4 — Electron major (2026-09-25)

| Field | Value |
|-------|-------|
| From → To | `40.10.6` → `44.4.5` |
| Supported majors (schedule) | 42, 43, 44 (latest stable 44.4.5) |
| Builder | `electron-builder` `26.16.1` (was 26.15.3); `electron-updater` stays `6.8.9` |
| Code fixes | Clipboard Promise/`readImage` → `clipboard-image.ts`; `ensure-electron-binary.mjs` (no postinstall download); macOS 13 min; notify `failed` log |
| Security prefs | Unchanged: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` |
| Local baseline fail (not Phase 4) | `managed-ssh-update.test.ts` POSIX exit 127 — same as staging tip |
| Revert | `git revert` the Phase 4 squash on `staging`, or reset branch; re-download prior staging DMG/EXE |

## Backport ratio (per batch)

| Batch | Clean picks | Backports | Skipped / listed | Backport ratio | Notes |
|-------|-------------|-----------|------------------|----------------|-------|
| Batch 1 SECURITY | 7 | 12 | 2 | **12/19 ≈ 63%** | Last synced upstream sha: `b534f4b8c8`. Revisit full-replay trigger if ratio stays high |
| Batch 1b SECURITY | 0 | 4 | 3 | **4/4 = 100%** of shas that ship on Nia needed a backport | Last synced upstream sha: `6c3aae398ade`. The 3 skipped shas are N/A (not shipped), not counted in the ratio. Shipped in v0.18.4. |
| Batch 2 inventory (table, not a landed slice) | — | 21 | — | **21/28 = 75%** | Classified table before 2a/2b. The earlier writeup said 18 of 24; the table has 28 rows, so 21 of 28 need a backport or resolve. No synced sha of its own. |
| Batch 2a BUG FIX | 3 | 6 | 1 | **6/9 ≈ 67%** of landed shas needed a backport | Previous last synced sha: `6c3aae398ade`. This batch's newest taken sha: `0466a04bc874` (not a full `origin/main` sync). Skipped `87bb0d3827a0`. CI showed `ffa40b07f020` and `0ca79e360233` were not clean. Shipped in v0.18.4 ([#28](https://github.com/Jaikarans2003/OkVevo-Nia/pull/28)). |

## Backports

When a SECURITY commit is not a clean cherry-pick, add a row:

| Date | Upstream sha | Status | Files | Why not clean |
|------|--------------|--------|-------|---------------|
| 2026-09-25 | `f6234d00c5` | picked-with-resolve | `hermes_cli/_subprocess_compat.py` | `__all__` conflict; omit `pid_is_hermes` absent on Nia |
| 2026-09-25 | `77ca6a6d12` | **picked** | desktop window-open | Clean |
| 2026-09-25 | `b08ec00a70` | picked-with-resolve | `preview-pane.tsx` | Import-only resolve; skip upstream annotate imports absent on Nia |
| 2026-09-25 | `408f5b7802` | **picked** | preview guest trusted click | Clean |
| 2026-09-25 | `9345c67854` | **backported** | `gateway/platforms/webhook.py` | Docstring/shape drift; `toolsets_for_source` applied |
| 2026-09-25 | `fc83fb42d3` | **picked** | `uv.lock` tornado 6.5.8 | Clean |
| 2026-09-25 | `d3fc0cca0f` | **picked** | mcp_oauth XSS | Clean (or minor) |
| 2026-09-25 | `0997a23e57` | **picked** + follow-up | `agent/redact.py` | Clean pick missed `_command_segments`; added helper (NameError fix) |
| 2026-09-25 | `56d2438a45` | **skipped — risk accepted (Karan signed off 2026-09-25)** | `hermes_cli/config.py` | See **Risk acceptance: 56d2438a45** below |

## Risk acceptance: `56d2438a45` (HERMES_HOME symlink / ancestor skip)

**Upstream bug (plain language):** Hermes started putting home-init in `config_home.py`. When *any* parent of `HERMES_HOME` was a symlink (normal on macOS: `/var` → `/private/var`), it **skipped** locking down directory modes. Fresh `~/.hermes` and subdirs could stay world-traversable `0o755` instead of owner-only `0o700`.

**Is Nia exploitable by the same attack?** **No.** Nia never took `config_home.py`. Home init lives in `ensure_hermes_home()` and **always** calls `_secure_dir` after mkdir — there is no “skip if ancestor is a symlink” branch:

- `hermes_cli/config.py` L975–983: `home.mkdir` → `_secure_dir(home)` → each subdir `mkdir` → `_secure_dir(d)`
- `_secure_dir` at L841–870: `os.chmod(..., 0o700)` (unless managed / `HERMES_HOME_MODE`)

**Minimal backport (if we ever needed one):** not required on current Nia. If `config_home` is imported later, port only `_operator_owned_links` + the `secure and not _operator_owned_links(...)` guard — do **not** wholesale-take upstream `config_home.py`.

**Sign-off:** Skip of `56d2438a45` is accepted for Batch 1; no residual exposure on Nia’s current home init path. Re-check if/when `hermes_cli/config_home.py` lands.

**Karan sign-off (2026-09-25):** Approved risk acceptance for `56d2438a45` as recorded above.

## GitSpawn completion (post-CI fix)

| Date | Upstream sha | Status | Notes |
|------|--------------|--------|-------|
| 2026-09-25 | `f6234d00c5` | completed | Cherry-pick had left `harden_git_argv` / callers but **dropped** `GIT_CONFIG_*` pins inside `noninteractive_git_env` (conflict resolve kept only prompt/GCM env). Restored full override block. |
| 2026-09-25 | `01a3206e90` / `02200f0b65` | backported into same helper | `_user_safe_directories` + ordered replay so blanking global/system config does not break NFS/`safe.directory` |
| 2026-09-25 | `9f0bf22ce2` | included | `core.sshCommand=ssh -o BatchMode=yes` in `_GIT_CONFIG_OVERRIDES` |
| 2026-09-25 | fixture align | **done** | Ported upstream `_neutralize_git_safe_directory_read` autouse; `_secure_state_db_files` O_EXCL+chmod(2)+`IsADirectoryError`; preflight-before-secure open order; FakePopen `__enter__`/`__exit__`. Quarantined flaky `virtualHistoryOffsetCache` compensation test → [#17](https://github.com/Jaikarans2003/OkVevo-Nia/issues/17). |

## Pre-existing (not Batch 1)

| Check | Result |
|-------|--------|
| `apps/desktop/electron/managed-ssh-update.test.ts` POSIX launcher exit 127 | **Fails on `okvevo/staging` tip and on this branch** — pre-existing local/CI env issue, not introduced by Batch 1 |
| 2026-09-25 | `e7cd1848c9` + `1c0d95badb` | **backported** | `tools/file_safety.py` | Single backport of final write-deny intent onto Nia shapes |
| 2026-09-25 | `3933fdf63b` | **backported** | image_gen / openai / tui SSRF | Onto `image_gen_provider` (no `provider_media`); pet thumb follow-up |
| 2026-09-25 | `1916cb249d` | **backported** | state.db owner-only | Nia hermes_state/backup paths |
| 2026-09-25 | `3966e5de94` | picked-with-resolve | async_delegation | Keep Nia suite + owner-only assert |
| 2026-09-25 | `0c74353c86` | picked-with-resolve | hooks path | Profile isolation re-resolve |
| 2026-09-25 | `e70db09f51` | **backported** | checkpoint + sticker | Path re-resolve onto Nia shapes |
| 2026-09-25 | `1aa62ceb45` | **backported** | `env_loader.py` | Multiplex dotenv + keep `OKVEVO_WEB_ORIGIN` restore |
| 2026-09-25 | `c26f75baab` | picked-with-resolve | profile exports + CI | Take profile-artifact-check; skip infographic/docker-lint |
| 2026-09-25 | `aa0beef684` | **backported** | mcp_oauth + docker env | Log redaction onto Nia shapes |
| 2026-09-25 | `b534f4b8c8` | **backported** | `local.py` + `env_passthrough` | Case-insensitive blocklist in Nia `local.py` (no `local_env_policy` / `docker_egress` / `remote_common`) |
| 2026-10-01 | `467046753420` | **backported** | `gateway/authz_mixin.py`, SimpleX adapter + tests | Ships: `plugins/platforms/simplex/` discovered from `gateway/config.py:404`. Cherry-pick conflicted (upstream authz helpers Nia lacks). Hand-applied: allowlist matches numeric `user_id` only (`authz_mixin.py:778`) |
| 2026-10-01 | `9c5da5a1c765` | **backported** | `hermes_cli/env_loader.py`, `agent/secret_sources/registry.py`, `hermes_cli/plugins.py` | Nia has no multiplex snapshot helpers. Ported write-record + revoke. Plugin refresh must call per-home reset so the write record survives. No `refresh_installed_secret_scope` on Nia |
| 2026-10-01 | `b543b1053c55` | **backported** | `agent/secret_scope.py` | Upstream test file `tests/cron/test_cron_multiplex_desktop_ticker_scope.py` does not exist. Adapted test in `tests/agent/test_secret_scope.py`. Did not take `bridged_allow_all_users` |
| 2026-10-01 | `6c3aae398ade` | **backported, computer_use excluded** | browser profile, gateway media caches, vision temp caches, in-flight journal purge | **Excluded** `tools/computer_use/` (parked; `docs/fork-deltas/computer-use.md`). **Excluded** `tools/vision_tools_image_prep.py` (not on Nia; equivalent mkdir sites are in `tools/vision_tools.py`). Dropped `test_computer_use_cache_files_owner_only` |
| 2026-10-01 | `45079e6330bc` | **N/A** | — | tirith ships via `tools/tirith_security.py:14` (own GitHub download) and `cli.py:8677`. This commit fixes `pm.ensure("tirith")`. Nia tirith does not `import pm` |
| 2026-10-01 | `df1b647b4242` | **N/A** | — | Same: `missing_is_expected()` / circuit breaker is on the `pm` download path, which Nia does not ship |
| 2026-10-01 | `bd392ba92242` | **N/A** | — | `pm/` package manager is not in the tree (0 files). Commit is entirely `pm/` + `tests/pm` |
| 2026-09-25 | `d966b34cc3` | **backported** | `cron/lifecycle_guard.py` | Windows `hermes.exe` / `taskkill` regex; keep Nia comments |
| 2026-09-25 | `940c610994` | **skipped** | — | N/A: blocklist already defined in `tools/environments/local.py` |
| 2026-10-02 | `43d09822ae12` | **backported** | `tui_gateway/methods_session.py`, `tests/tui_gateway/test_session_hidden_rpc.py` | Nia keeps two-tier live/stored lookup. Missing `hidden` returns 4026 (`4021` is already "title required"). Upstream test kept. |
| 2026-10-02 | `a609bad294c7` | **backported** | `hermes_cli/backup.py`, `tests/hermes_cli/test_restore_source_integrity.py` | `backup_restore.py` is not on Nia. Integrity gate is at the start of `_safe_restore_db`; snapshot restore and existing-db import honor a False return. |
| 2026-10-02 | `87bb0d3827a0` | **skipped — residual risk** | — | `hermes_state_lockguard.py` is not on Nia (no OFD WAL generation guard). The close-order race in that module cannot fire. Do not import the module just to take the fix. |
| 2026-10-02 | `2e36513ef9b2` | **picked** | Windows GPU crash fallback | Clean |
| 2026-10-02 | `b9cb268deffc` | **backported** | `windows-child-options.ts`, probes, `main.ts` | Nia uses `spawn` / `execProbeSync`, not `spawnOwnedBackend`. `backend-serve-support.ts` is inlined in `main.ts`; the `serve --help` probe quotes there. |
| 2026-10-02 | `ffa40b07f020` | **backported** | per-session remote `state.db` | main.ts imported `pathWithRemoteOwnerScope`, `remoteProfileQueryScope`, `tagRemoteSessionRows` and a 4th arg on `fetchRemoteProfileSessions`. Those were not on Nia's `profile-session-routing.ts`. Ported the four helpers. `main.ts:351`, `main.ts:16015` |
| 2026-10-02 | `5d1ab29b0393` | **backported** | `gateway/status.py` plus the upstream test | The upstream commit is test-only. Nia still raised when `gateway.pid` was missing beside a held lock. Identity now comes from the lock record. |
| 2026-10-02 | `0ca79e360233` | **backported** | bootstrap installer update marker | Picked test expected `live_marker_owner` to return none for our pid. `acquire` adopts that pid (`update.rs:282`). Assertion updated to match later upstream: own pid is reported and the marker is kept. `update.rs:1878` |
| 2026-10-02 | `ca16be564d0a` | **picked** | preview print guard | Clean apply; user-visible `[Hermes]` warn rebranded to `[Nia]` |
| 2026-10-02 | `0466a04bc874` | **picked** | Windows spawn lock stdin | Clean |
| 2026-09-25 | S3 bumps | **done** | `uv.lock`, `package.json`, lock | anyio 4.14.2; electron-updater 6.8.9; builder-util-runtime 9.7.0; js-yaml 4.3.2; electron 40.10.6 patch |
| 2026-09-25 | CI gate | **done** | `nia-dep-audit` | pip-audit + `npm audit --omit=dev --audit-level=critical`; no Dependabot auto-PR yaml |
| 2026-10-01 | n/a (CI gate, not a Hermes sha) | diff-aware dependency review | [#24](https://github.com/Jaikarans2003/OkVevo-Nia/pull/24), shipped in v0.18.4 | PRs fail only on high/critical advisories introduced by the diff (`dependency-review-action`, required via `all-checks-pass`). Full pip-audit + npm audit is daily and on push to `staging`/`main`, and files a tracking issue. |
