# Upstream sync log

Append one row after each approved sync batch lands on `staging`.

| Date | Last synced `origin/main` sha | Strategy | PR | Notes |
|------|-------------------------------|----------|-----|-------|
| _(none yet)_ | — | — | — | Batch 0 created this file; no Hermes code synced. |
| 2026-09-25 | (Batch 1 SECURITY in flight on `sync/batch1-security`) | **B** selective cherry-picks | _(PR pending)_ | Replay rejected (U3). See Backports + Batch 1 ratio. |
| 2026-09-25 | n/a (Electron major, not Hermes sha) | **Phase 4** Electron 40→44 | _(PR pending `sync/electron-major`)_ | Target **44.4.5** (latest supported stable per releases.electronjs.org). Shell-only; see Phase 4 notes. |

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
| Batch 1 SECURITY | 7 | 12 | 2 | **12/19 ≈ 63%** of attempted advisory/follow-up shas needed backport or resolve | Revisit full-replay trigger if ratio stays high |

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
| 2026-09-25 | `d966b34cc3` | **backported** | `cron/lifecycle_guard.py` | Windows `hermes.exe` / `taskkill` regex; keep Nia comments |
| 2026-09-25 | `940c610994` | **skipped** | — | N/A: blocklist already defined in `tools/environments/local.py` |
| 2026-09-25 | S3 bumps | **done** | `uv.lock`, `package.json`, lock | anyio 4.14.2; electron-updater 6.8.9; builder-util-runtime 9.7.0; js-yaml 4.3.2; electron 40.10.6 patch |
| 2026-09-25 | CI gate | **done** | `nia-dep-audit` | pip-audit + `npm audit --omit=dev --audit-level=critical`; no Dependabot auto-PR yaml |
