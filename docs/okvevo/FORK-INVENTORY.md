# FORK-INVENTORY — every OkVevo change vs upstream, classified

Generated 2026-10-22 during the upstream reset ([plan](../../.cursor/plans/okvevo-upstream-reset.plan.md)).
Upstream merge target: **`v0.22.4`** (latest stable release tag).
Comparator for this inventory: **`v2026.8.31`** — the upstream tag with the smallest diff to `okvevo/staging` (2,806 files; the repo history is a 48-commit grafted snapshot, so commits alone under-count fork edits; amendment 1).

In plain words: this file lists everything our product changed relative to the open-source Hermes Agent, and what happens to each change in the reset — kept in our own files, re-applied to the desktop app, patched into upstream with justification, or dropped so the upstream release wins.

## Feature groups (what the fork actually built)

Evidence: the 48 repo commits + marker scan (`okvevo|NIA_|drama|…`) across core files. "Port" = re-express through an upstream extension point in OkVevo-owned files (commit 2 or 3).

| # | Feature | Files (main) | Outcome |
|---|---|---|---|
| G1 | OkVevo LLM provider + auto-router (portal gateway, model allowlists) | `agent/okvevo_gateway.py`, `agent/okvevo_auto_router.py`, `agent/okvevo_auto_allowlists.py`, patch in `plugins/model-providers/openrouter/__init__.py`, `hermes_cli/models.py`, `tools/openrouter_decisions.py` | KEEP-PLUGIN → `plugins/model-providers/okvevo/` (provider id `okvevo`; HTTP 402 → "out of credits" copy) |
| G2 | Portal sign-in, token store, env wiring | `apps/desktop/electron/okvevo-auth*.ts`, `okvevo-env.ts`, `agent/billing_links.py` delta | KEEP-UI (desktop) + token read in `plugins/okvevo/` |
| G3 | Credits + user-facing error mapping | `agent/user_facing_errors.py`, `agent/user_facing_brand.py` + tests | KEEP-PLUGIN → error mapping inside `plugins/okvevo*`; concealment parts dropped |
| G4 | Image / video / TTS via portal Fal (incl. GPT Image 2, wan-3.0, seedance pins) | patches in `plugins/image_gen/openai*`, `plugins/video_gen/fal`, `tools/fal_common.py`, `tools/image_generation_tool.py`, `tools/video_generation_tool.py`, `tools/tts_tool.py`, `agent/image_gen_provider.py`, `agent/image_routing.py`, `agent/provider_media.py` | KEEP-PLUGIN → image/video providers registered from `plugins/okvevo/` via upstream registries |
| G5 | Web search via portal gateway | patch in `plugins/web/tavily/provider.py` (tavily itself exists upstream at v0.22.4) | KEEP-PLUGIN → OkVevo web provider in `plugins/okvevo/` |
| G6 | Short-drama pipeline (portal Fal adapter, quote fail-closed, voice clone, schemas) | `okvevo/drama_fal_adapter.py`, `okvevo/fal-schemas/*`, `okvevo/drama-cards.json`, `okvevo/media-catalog.json`, 31 fork-only `skills/creative/*` dirs | KEEP-OWNED (`okvevo/`) + KEEP-SKILL (relocate skills to `okvevo/skills/creative/`, load via upstream `skills.external_dirs`) |
| G7 | Generated-media durability / output_dir honoring (PRs #57–#58) | `agent/nia_generated_media.py`, `tools/media_catalog.py`, `scripts/check_media_catalog.py` | CHECK: upstream v0.22.4 has `tests/agent/test_generated_media_durable.py` — compare; port only the residual not covered upstream |
| G8 | manage_bot + bots/group UX deltas | `tools/manage_bot_tool.py` delta, `tui_gateway/methods_bot_relay.py`, group member picker (#46) | manage_bot exists upstream (fork delta = OkVevo copy) → re-express or drop; #46 see G11 |
| G9 | Brand overlay (icons, locale catalogs at pack time) | `brand/**`, `scripts/overlay-brand-assets.mjs(+test)`, `apps/desktop/scripts/prepare-app-icon.mjs` | KEEP-OWNED + KEEP-UI; move `scripts/overlay-brand-assets.*` under `apps/desktop/scripts/` (upstream-owned `scripts/` must stay clean) |
| G10 | Desktop pack/release machinery (build channel, snapshot, release feed, ffmpeg bundling #51) | `apps/desktop/scripts/*.mjs`, `nia-build-channel.d.ts`, `packaged-snapshot.ts`, `fetch-ffmpeg.mjs`, `resources/ffmpeg-licenses/` | KEEP-UI (renamed `NIA_` → `OKVEVO_`) |
| G11 | Product features #45–#49 (MCP discovery caps, group member picker, sub-task steer/stop, cron re-run of unreached jobs, sibling chats & cron follow main model) | `gateway/`, `tui_gateway/`, `cron/unreachable_retry.py`, `tools/async_delegation.py` deltas | CHECK upstream v0.22.4 for equivalents (15k commits landed). Equivalent → DROP-RESET. No equivalent → DEFER + `PRE-LIVE-BACKLOG.md` entry (do NOT burn KEEP-PATCH slots on non-business features) |
| G12 | Concealment machinery (root cause of slow/vague answers) | `agent/brand_scrub.py`, `plugins/nia-public-guard/`, `PRODUCT_IDENTITY_GUIDANCE` in `agent/prompt_builder.py`, desktop path painting (commit 173ba), `scripts/check_nia_branding.py`, `scripts/nia_dep_audit.py` + workflow | DROP-CONCEAL (delete) |
| G13 | Security hardening for portal auth file (block token globs, redact token bytes — commit c59c31c) | deltas in `agent/file_safety.py`, `agent/redact.py`, `agent/secret_scope.py`, `tools/file_tools.py`, `tools/credential_files.py` | RESOLVED 2026-10-22: upstream v0.22.4 ships `agent/redact.py::register_redaction_patterns()` and `PluginContext.register_secret_source()` → port into `plugins/okvevo/`. No patch |
| G14 | Bootstrap/install pointing at our repo | `apps/bootstrap-installer/src-tauri/src/install_script.rs`, `apps/desktop/electron/bootstrap-runner.ts`, `scripts/install.sh` / `install.ps1` deltas | RESOLVED 2026-10-22: upstream `install.sh` line 23 / `install.ps1` line 80 accept `HERMES_REPO_URL` (re-runs included) → scripts reset clean; desktop (KEEP-UI) passes our repo URL + the build-time commit SHA (amendment 13). Installer Rust patch only if we ship the Tauri bootstrap-installer — decide in commit 3 |
| G15 | Fork tests for kept features | `tests/**` A-status subset | Move the ones covering kept features into `plugins/okvevo/tests` or `okvevo/tests`; the rest DROP-RESET |

## KEEP-PATCH ledger (hard cap 3 — final list lives in PATCHES.md)

1. `apps/bootstrap-installer/src-tauri/src/install_script.rs` — clone our repo at the build-time-pinned commit SHA. Upstream hard-codes `NousResearch/hermes-agent` with only a dev-env override. **Only needed if we ship the Tauri bootstrap-installer** (the Electron DMG path uses `bootstrap-runner.ts` + `HERMES_REPO_URL`, both ours/UI). Decide in commit 3.
2. — (eliminated: G13 redaction ports via upstream plugin hooks)
3. — (eliminated: G14 install scripts honor `HERMES_REPO_URL`)

Anything beyond cap 3 → stop and ask Karan (plan stop condition).
## Full classification (generated 2026-10-22)

Comparator: `git diff v2026.8.31 okvevo/staging` — the upstream tag with the smallest diff to the product branch (2,806 files; scan: v2026.8.16→v0.22.4, minimum at v2026.8.31).
Status: A = only in fork, M = modified vs comparator, D = only in comparator.

| Class | Files |
|---|---|
| KEEP-OWNED | 55 |
| KEEP-SKILL | 1145 |
| KEEP-PLUGIN | 39 |
| KEEP-UI | 157 |
| KEEP-PATCH | 1 |
| REPLACE-CI | 7 |
| DROP-CONCEAL | 7 |
| DROP-RESET | 1395 |


### KEEP-OWNED (55 files)

| S | Path | Why |
|---|---|---|
| A | `.cursor/rules/nia-fork-deltas.mdc` | OkVevo-owned path; survives merge |
| A | `.cursor/rules/okvevo-nia-remote.mdc` | OkVevo-owned path; survives merge |
| A | `ENVIRONMENT.md` | OkVevo-owned path; survives merge |
| A | `PRE-LIVE-BACKLOG.md` | OkVevo-owned path; survives merge |
| A | `brand/assets/apps/bootstrap-installer/src-tauri/icons/128x128.png` | OkVevo-owned path; survives merge |
| A | `brand/assets/apps/bootstrap-installer/src-tauri/icons/128x128@2x.png` | OkVevo-owned path; survives merge |
| A | `brand/assets/apps/bootstrap-installer/src-tauri/icons/32x32.png` | OkVevo-owned path; survives merge |
| A | `brand/assets/apps/bootstrap-installer/src-tauri/icons/icon.icns` | OkVevo-owned path; survives merge |
| A | `brand/assets/apps/bootstrap-installer/src-tauri/icons/icon.ico` | OkVevo-owned path; survives merge |
| A | `brand/assets/apps/desktop/assets/icon.icns` | OkVevo-owned path; survives merge |
| A | `brand/assets/apps/desktop/assets/icon.ico` | OkVevo-owned path; survives merge |
| A | `brand/assets/apps/desktop/assets/icon.png` | OkVevo-owned path; survives merge |
| A | `brand/locales/af.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/ar.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/de.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/desktop/ar.ts` | OkVevo-owned path; survives merge |
| A | `brand/locales/desktop/en.ts` | OkVevo-owned path; survives merge |
| A | `brand/locales/desktop/ja.ts` | OkVevo-owned path; survives merge |
| A | `brand/locales/desktop/zh-hant.ts` | OkVevo-owned path; survives merge |
| A | `brand/locales/desktop/zh.ts` | OkVevo-owned path; survives merge |
| A | `brand/locales/en.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/es.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/fr.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/ga.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/hu.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/it.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/ja.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/ko.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/pt.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/ru.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/tr.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/uk.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/zh-hant.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/locales/zh.overlay.json` | OkVevo-owned path; survives merge |
| A | `brand/nia.json` | OkVevo-owned path; survives merge |
| A | `okvevo/drama-cards.json` | OkVevo-owned path; survives merge |
| A | `okvevo/drama_fal_adapter.py` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/alibaba__wan-3.0-prime__image-to-video.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/alibaba__wan-3.0-prime__reference-to-video.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/alibaba__wan-3.0-prime__text-to-video.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/bytedance__seedance-2.0__image-to-video.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/bytedance__seedance-2.0__reference-to-video.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/bytedance__seedance-2.0__text-to-video.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/bytedance__seedance-2.5__image-to-video.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/bytedance__seedance-2.5__reference-to-video.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/bytedance__seedance-2.5__text-to-video.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/fal-ai__minimax__speech-02-hd.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/fal-ai__minimax__voice-clone.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/minimax__h3-max__image-to-video.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/minimax__h3-max__reference-to-video.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/minimax__h3-max__text-to-video.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/minimax__music-3.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/openai__gpt-image-2.json` | OkVevo-owned path; survives merge |
| A | `okvevo/fal-schemas/openai__gpt-image-2__edit.json` | OkVevo-owned path; survives merge |
| A | `okvevo/media-catalog.json` | OkVevo-owned path; survives merge |

### KEEP-SKILL (1145 files)

Grouped (path, status, count):

| Path group | S | Files |
|---|---|---|
| `skills/creative/media-use` | A | 153 |
| `skills/creative/embedded-captions` | A | 138 |
| `skills/creative/music-to-video` | A | 132 |
| `skills/creative/hyperframes-animation` | A | 108 |
| `skills/creative/hyperframes-creative` | A | 78 |
| `skills/creative/remotion-to-hyperframes` | A | 70 |
| `skills/creative/short-drama-develop` | A | 37 |
| `skills/creative/short-drama` | A | 35 |
| `skills/creative/pr-to-video` | A | 30 |
| `skills/creative/short-drama-edit` | A | 30 |
| `skills/creative/product-launch-video` | A | 29 |
| `skills/creative/talking-head-recut` | A | 28 |
| `skills/creative/short-drama-video-prompts` | A | 27 |
| `skills/creative/faceless-explainer` | A | 24 |
| `skills/creative/short-drama-storyboard` | A | 24 |
| `skills/creative/motion-graphics` | A | 23 |
| `skills/creative/short-drama-assets` | A | 22 |
| `skills/creative/hyperframes-core` | A | 20 |
| `skills/creative/short-drama-write` | A | 20 |
| `skills/creative/short-drama-image-prompts` | A | 19 |
| `skills/creative/hyperframes` | A | 17 |
| `skills/creative/short-drama-review` | A | 17 |
| `skills/creative/short-drama-produce` | A | 14 |
| `skills/creative/hyperframes-cli` | A | 11 |
| `skills/creative/short-drama-novel-analyze` | A | 11 |
| `skills/creative/hyperframes-registry` | A | 10 |
| `skills/creative/hyperframes-audio` | A | 7 |
| `skills/creative/general-video` | A | 4 |
| `skills/creative/hyperframes-keyframes` | A | 3 |
| `skills/creative/figma` | A | 2 |
| `skills/creative/slideshow` | A | 2 |

### KEEP-PLUGIN (39 files)

| S | Path | Why |
|---|---|---|
| M | `agent/agent_runtime_helpers.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `agent/auxiliary_client.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `agent/billing_links.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `agent/conversation_loop.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `agent/image_gen_provider.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| A | `agent/nia_generated_media.py` | OkVevo business logic; port to plugins/okvevo* (commit 2) |
| A | `agent/okvevo_auto_allowlists.py` | OkVevo business logic; port to plugins/okvevo* (commit 2) |
| A | `agent/okvevo_auto_router.py` | OkVevo business logic; port to plugins/okvevo* (commit 2) |
| A | `agent/okvevo_gateway.py` | OkVevo business logic; port to plugins/okvevo* (commit 2) |
| M | `agent/prompt_builder.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| A | `agent/provider_media.py` | OkVevo business logic; port to plugins/okvevo* (commit 2) |
| M | `agent/redact.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `agent/transports/chat_completions.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| A | `agent/user_facing_brand.py` | OkVevo business logic; port to plugins/okvevo* (commit 2) |
| A | `agent/user_facing_errors.py` | OkVevo business logic; port to plugins/okvevo* (commit 2) |
| M | `agent/video_gen_provider.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `cli.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `hermes_cli/banner.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `hermes_cli/default_soul.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `hermes_cli/env_loader.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `hermes_cli/inventory.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `hermes_cli/main.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `hermes_cli/model_switch.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `hermes_cli/models.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `plugins/model-providers/openrouter/__init__.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `plugins/video_gen/fal/__init__.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| A | `plugins/web/tavily/provider.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `run_agent.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `tools/fal_common.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `tools/file_tools.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `tools/image_generation_tool.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| A | `tools/manage_bot_tool.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| A | `tools/media_catalog.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| A | `tools/openrouter_decisions.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `tools/registry.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `tools/tts_tool.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `tools/video_generation_tool.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `tui_gateway/methods_config.py` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |
| M | `web/src/i18n/en.ts` | upstream file with OkVevo delta; re-express via plugin/config, else PATCHES.md (commit 2) |

### KEEP-UI (157 files)

| S | Path | Why |
|---|---|---|
| A | `apps/bootstrap-installer/public/apple-touch-icon.png` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/bootstrap-installer/public/nia.png` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/bootstrap-installer/src-tauri/src/bootstrap.rs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/bootstrap-installer/src-tauri/tauri.conf.json` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/bootstrap-installer/src/styles.css` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/e2e/boot.spec.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/e2e/fixtures.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/e2e/launch-packaged-app.spec.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/backend-env.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/backend-env.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/backend-health.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/backend-health.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/binary-update-error.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/binary-updater.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/binary-updater.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/bootstrap-runner.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/bootstrap-runner.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/connection-config.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/main.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/nia-build-channel.d.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/okvevo-auth-flow.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/okvevo-auth-flow.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/okvevo-auth-store.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/okvevo-auth-store.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/okvevo-auth.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/okvevo-auth.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/okvevo-env.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/okvevo-env.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/packaged-snapshot.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/electron/packaged-snapshot.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/preload.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/remote-lifecycle.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/terminal-ipc.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/update-count.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/update-remote.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/update-remote.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/electron/vscode-marketplace.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/package.json` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/resources/ffmpeg-licenses/SOURCE-OFFER.txt` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/scripts/after-pack.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/scripts/before-pack.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/scripts/bundle-electron-main.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/ci-map-pack-env.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/ci-map-pack-env.test.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/fetch-ffmpeg.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/scripts/local-pack-publish.test.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/scripts/notarize.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/pack-agent-snapshot.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/pack-agent-snapshot.test.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/prepare-app-icon.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/publish-release-feed.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/publish-release-feed.test.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/require-release-secrets.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/require-release-secrets.test.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/resolve-build-channel.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/resolve-build-channel.test.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/run-internal-builder.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/scripts/set-exe-identity.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/sign-windows.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/smoke-release-feed.test.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/scripts/test-desktop.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/write-okvevo-pack-env.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/scripts/write-okvevo-pack-env.test.mjs` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/artifacts/index.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/app/pet-generate/components/generate-unavailable.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/pet-generate/components/generate-unavailable.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/message-stream.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/status.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/session/hooks/use-model-controls.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/app/settings/about-settings.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/about-settings.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/billing/api.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/billing/dev-fixtures.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/billing/errors.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/billing/index.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/billing/index.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/billing/types.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/billing/use-billing-state.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/billing/use-billing-state.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/billing/use-charge-poller.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/constants.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/gateway-settings.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/helpers.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/model-settings.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/model-settings.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/providers-settings.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/settings/settings-search.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/app/settings/settings-ui-policy.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/app/settings/settings-ui-policy.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/shell/model-catalog-menu.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/shell/model-catalog-menu.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/shell/model-menu-panel.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/shell/titlebar-controls.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/shell/titlebar.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/skills/embedded-hub-picker.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/skills/index.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/app/updates-overlay.blockers.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/assistant-ui/thread/assistant-message.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/assistant-ui/thread/assistant-message.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/assistant-ui/tool/fallback-model.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/boot-failure-overlay.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/boot-failure-overlay.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/chat/diff-lines.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/chat/intro-copy.jsonl` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/components/chat/intro.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/chat/intro.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/chat/wordmark.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/desktop-install-overlay.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/onboarding/index.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/onboarding/index.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/onboarding/providers.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/components/send-diagnostics-dialog.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/global.d.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/lib/build-channel.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/lib/display-path.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/lib/display-path.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/lib/model-options.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/lib/model-status-label.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/lib/model-status-label.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/lib/okvevo-billing-listener.selfcheck.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/lib/okvevo-billing-listener.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/lib/okvevo-billing-listener.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/lib/okvevo-firebase.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/lib/provider-branding.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/lib/provider-branding.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/lib/user-facing-error.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/main.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/accent/picker.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/plugins/hermes-bots/chat-empty.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/data.identity.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/data.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/group-chat.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/group-chat.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/group-rounds.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/labels.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/model-picker.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/relay.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/routing.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/row-helpers.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/skills-hub-picker.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/skills-hub.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/plugins/hermes-bots/soul.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/sdk/index.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/store/notifications.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/store/okvevo-auth.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| A | `apps/desktop/src/store/okvevo-auth.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/store/onboarding.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/store/profile-share.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/store/reactions-enabled.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/store/updates.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/themes/backend-sync.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/themes/presets.test.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/themes/presets.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/themes/request.test.tsx` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/src/vite-env.d.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/vite.config.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |
| M | `apps/desktop/vitest.config.ts` | OkVevo desktop delta; re-apply on upstream desktop (commit 3) |

### KEEP-PATCH (1 files)

| S | Path | Why |
|---|---|---|
| M | `apps/bootstrap-installer/src-tauri/src/install_script.rs` | bootstrap repo URL + SHA pin; no upstream override (PATCHES.md) |

### REPLACE-CI (7 files)

| S | Path | Why |
|---|---|---|
| A | `.github/workflows/desktop-pack.yml` | fork workflow; replaced by okvevo-*.yml in commit 4 |
| A | `.github/workflows/desktop-preview.yml` | fork workflow; replaced by okvevo-*.yml in commit 4 |
| A | `.github/workflows/desktop-production.yml` | fork workflow; replaced by okvevo-*.yml in commit 4 |
| A | `.github/workflows/desktop-publish.yml` | fork workflow; replaced by okvevo-*.yml in commit 4 |
| A | `.github/workflows/desktop-staging.yml` | fork workflow; replaced by okvevo-*.yml in commit 4 |
| A | `.github/workflows/okvevo-nia-remote-guard.yml` | fork workflow; replaced by okvevo-*.yml in commit 4 |
| A | `.github/workflows/profile-artifact-check.yml` | fork workflow; replaced by okvevo-*.yml in commit 4 |

### DROP-CONCEAL (7 files)

| S | Path | Why |
|---|---|---|
| A | `.github/nia-dep-audit-allowlist.txt` | concealment/scrub machinery; delete (Decision 4) |
| A | `.github/workflows/nia-dep-audit.yml` | concealment/scrub machinery; delete (Decision 4) |
| A | `agent/brand_scrub.py` | concealment/scrub machinery; delete (Decision 4) |
| A | `plugins/nia-public-guard/__init__.py` | concealment/scrub machinery; delete (Decision 4) |
| A | `plugins/nia-public-guard/plugin.yaml` | concealment/scrub machinery; delete (Decision 4) |
| A | `scripts/check_nia_branding.py` | concealment/scrub machinery; delete (Decision 4) |
| A | `scripts/nia_dep_audit.py` | concealment/scrub machinery; delete (Decision 4) |

### DROP-RESET (1395 files)

Grouped (path, status, count):

| Path group | S | Files |
|---|---|---|
| `apps/desktop` | M | 279 |
| `website/docs` | M | 217 |
| `contributors/emails` | D | 72 |
| `apps/desktop` | A | 58 |
| `tests/tools` | M | 48 |
| `tests/hermes_cli` | M | 46 |
| `tests/gateway` | M | 41 |
| `apps/desktop` | D | 28 |
| `tests/agent` | M | 28 |
| `tests/gateway` | D | 26 |
| `website/docs` | A | 21 |
| `tests/cron` | M | 19 |
| `.github/workflows` | M | 16 |
| `apps/bootstrap-installer` | M | 15 |
| `plugins/platforms` | M | 15 |
| `tests/hermes_cli` | D | 14 |
| `tests/agent` | A | 13 |
| `ui-tui/src` | M | 13 |
| `tests/tui_gateway` | M | 10 |
| `tests/tui_gateway` | D | 10 |
| `docs/fork-deltas` | A | 9 |
| `optional-skills/creative` | D | 8 |
| `tests/agent` | D | 8 |
| `tests/plugins` | M | 7 |
| `tests/skills` | A | 7 |
| `plugins/web` | M | 6 |
| `tests/cron` | D | 5 |
| `gateway/platforms` | M | 4 |
| `gateway/platforms` | D | 4 |
| `skills/autonomous-ai-agents` | M | 4 |
| `tools/environments` | M | 4 |
| `agent/pet` | M | 3 |
| `contributors/emails` | M | 3 |
| `scripts/desktop-update` | M | 3 |
| `skills/software-development` | M | 3 |
| `tests/gateway` | A | 3 |
| `tests/hermes_cli` | A | 3 |
| `tests/hermes_state` | D | 3 |
| `tests/state` | D | 3 |
| `tests/tools` | A | 3 |
| `website/i18n` | M | 3 |
| `hermes_cli/dashboard_auth` | M | 2 |
| `hermes_cli/subcommands` | M | 2 |
| `hermes_cli/web_routers` | M | 2 |
| `optional-skills/creative` | M | 2 |
| `optional-skills/research` | M | 2 |
| `plugins/image_gen` | M | 2 |
| `plugins/memory` | M | 2 |
| `plugins/web` | A | 2 |
| `tests/cli` | M | 2 |
| `tests/cli` | D | 2 |
| `tests/cron` | A | 2 |
| `tests/fixtures` | A | 2 |
| `tests/plugins` | D | 2 |
| `tests/providers` | A | 2 |
| `tests/run_agent` | D | 2 |
| `tests/tools` | D | 2 |
| `tests/tui_gateway` | A | 2 |
| `web/src` | D | 2 |
| `.dockerignore` | M | 1 |
| `.env.example` | M | 1 |
| `.githooks/pre-commit` | A | 1 |
| `.github/dependabot.yml` | M | 1 |
| `.gitignore` | M | 1 |
| `AGENTS.md` | M | 1 |
| `SOUL.md` | M | 1 |
| `agent/agent_init.py` | M | 1 |
| `agent/anthropic_adapter.py` | M | 1 |
| `agent/chat_completion_helpers.py` | M | 1 |
| `agent/codex_headers.py` | D | 1 |
| `agent/context_compressor.py` | M | 1 |
| `agent/context_references.py` | M | 1 |
| `agent/conversation_compression.py` | M | 1 |
| `agent/copilot_acp_client.py` | M | 1 |
| `agent/curator.py` | M | 1 |
| `agent/deadline.py` | M | 1 |
| `agent/estop.py` | M | 1 |
| `agent/file_safety.py` | M | 1 |
| `agent/i18n.py` | M | 1 |
| `agent/image_routing.py` | M | 1 |
| `agent/memory_manager.py` | M | 1 |
| `agent/message_sanitization.py` | M | 1 |
| `agent/model_metadata.py` | M | 1 |
| `agent/secret_scope.py` | M | 1 |
| `agent/secret_sources` | M | 1 |
| `agent/skill_utils.py` | M | 1 |
| `agent/system_prompt.py` | M | 1 |
| `agent/transports` | M | 1 |
| `agent/turn_context.py` | M | 1 |
| `agent/web_search_provider.py` | M | 1 |
| `agent/web_search_registry.py` | M | 1 |
| `apps/bootstrap-installer` | D | 1 |
| `apps/shared` | M | 1 |
| `cli-config.yaml.example` | M | 1 |
| `cron/jobs.py` | M | 1 |
| `cron/lifecycle_guard.py` | M | 1 |
| `cron/scheduler.py` | M | 1 |
| `cron/scheduler_provider.py` | M | 1 |
| `cron/unreachable_retry.py` | A | 1 |
| `docker/SOUL.md` | M | 1 |
| `docs/CI-CD.md` | A | 1 |
| `docs/FINISH-SIGNED-RELEASE.md` | A | 1 |
| `docs/cron-doctor-spec.md` | D | 1 |
| `docs/session-lifecycle.md` | M | 1 |
| `docs/state-db-recovery.md` | D | 1 |
| `evals/browser_use` | M | 1 |
| `gateway/authz_mixin.py` | M | 1 |
| `gateway/config.py` | M | 1 |
| `gateway/display_config.py` | M | 1 |
| `gateway/hooks.py` | M | 1 |
| `gateway/hosted_room_discussion.py` | D | 1 |
| `gateway/hosted_room_driver.py` | D | 1 |
| `gateway/hosted_room_execution_policy.py` | D | 1 |
| `gateway/hosted_room_links.py` | D | 1 |
| `gateway/hosted_room_peer.py` | D | 1 |
| `gateway/hosted_room_policy_checkpoint.py` | D | 1 |
| `gateway/hosted_room_replicas.py` | D | 1 |
| `gateway/hosted_rooms.py` | D | 1 |
| `gateway/lifecycle_ledger.py` | M | 1 |
| `gateway/restart.py` | M | 1 |
| `gateway/run.py` | M | 1 |
| `gateway/session.py` | M | 1 |
| `gateway/session_context.py` | M | 1 |
| `gateway/session_stall.py` | M | 1 |
| `gateway/slash_commands.py` | M | 1 |
| `gateway/slash_commands_branch_thread.py` | A | 1 |
| `gateway/status.py` | M | 1 |
| `gateway/sticker_cache.py` | M | 1 |
| `gateway/stream_consumer.py` | M | 1 |
| `gateway/turn_lease.py` | M | 1 |
| `hermes_cli/__init__.py` | M | 1 |
| `hermes_cli/_startup_fast.py` | M | 1 |
| `hermes_cli/_subprocess_compat.py` | M | 1 |
| `hermes_cli/archive_safe.py` | M | 1 |
| `hermes_cli/backup.py` | M | 1 |
| `hermes_cli/browser_connect.py` | M | 1 |
| `hermes_cli/cli_agent_setup_mixin.py` | M | 1 |
| `hermes_cli/cli_commands_mixin.py` | M | 1 |
| `hermes_cli/commands.py` | M | 1 |
| `hermes_cli/config.py` | M | 1 |
| `hermes_cli/config_defaults.py` | M | 1 |
| `hermes_cli/config_migrations.py` | M | 1 |
| `hermes_cli/credential_lifecycle.py` | M | 1 |
| `hermes_cli/cron.py` | M | 1 |
| `hermes_cli/curator.py` | M | 1 |
| `hermes_cli/dashboard_procs.py` | M | 1 |
| `hermes_cli/doctor.py` | M | 1 |
| `hermes_cli/dump.py` | M | 1 |
| `hermes_cli/gateway.py` | M | 1 |
| `hermes_cli/gateway_windows.py` | M | 1 |
| `hermes_cli/gitlock.py` | M | 1 |
| `hermes_cli/goals.py` | M | 1 |
| `hermes_cli/gui_uninstall.py` | M | 1 |
| `hermes_cli/install_identity.py` | D | 1 |
| `hermes_cli/linux_desktop_entry.py` | M | 1 |
| `hermes_cli/nous_subscription.py` | M | 1 |
| `hermes_cli/oneshot.py` | M | 1 |
| `hermes_cli/plugin_dev.py` | M | 1 |
| `hermes_cli/plugins.py` | M | 1 |
| `hermes_cli/profiles.py` | M | 1 |
| `hermes_cli/pt_input_extras.py` | M | 1 |
| `hermes_cli/runtime_provider.py` | M | 1 |
| `hermes_cli/service_manager.py` | M | 1 |
| `hermes_cli/setup.py` | M | 1 |
| `hermes_cli/skin_engine.py` | M | 1 |
| `hermes_cli/status.py` | M | 1 |
| `hermes_cli/tools_config.py` | M | 1 |
| `hermes_cli/toolset_scope.py` | D | 1 |
| `hermes_cli/toolset_validation.py` | M | 1 |
| `hermes_cli/uninstall.py` | M | 1 |
| `hermes_cli/update_cmd.py` | M | 1 |
| `hermes_cli/web_git.py` | M | 1 |
| `hermes_cli/web_server.py` | M | 1 |
| `hermes_cli/worktree_gc.py` | M | 1 |
| `hermes_constants.py` | M | 1 |
| `hermes_logging.py` | M | 1 |
| `hermes_state.py` | M | 1 |
| `hermes_state_common.py` | M | 1 |
| `hermes_state_portability.py` | M | 1 |
| `hermes_state_schema.py` | M | 1 |
| `hermes_state_search.py` | M | 1 |
| `hermes_time.py` | M | 1 |
| `locales/af.yaml` | M | 1 |
| `locales/ar.yaml` | M | 1 |
| `locales/de.yaml` | M | 1 |
| `locales/en.yaml` | M | 1 |
| `locales/es.yaml` | M | 1 |
| `locales/fr.yaml` | M | 1 |
| `locales/ga.yaml` | M | 1 |
| `locales/hu.yaml` | M | 1 |
| `locales/it.yaml` | M | 1 |
| `locales/ja.yaml` | M | 1 |
| `locales/ko.yaml` | M | 1 |
| `locales/pt.yaml` | M | 1 |
| `locales/ru.yaml` | M | 1 |
| `locales/tr.yaml` | M | 1 |
| `locales/uk.yaml` | M | 1 |
| `locales/zh-hant.yaml` | M | 1 |
| `locales/zh.yaml` | M | 1 |
| `optional-skills/autonomous-ai-agents` | M | 1 |
| `optional-skills/devops` | M | 1 |
| `optional-skills/migration` | M | 1 |
| `package-lock.json` | M | 1 |
| `package.json` | M | 1 |
| `pyproject.toml` | M | 1 |
| `scripts/check_media_catalog.py` | A | 1 |
| `scripts/ci` | A | 1 |
| `scripts/ci` | M | 1 |
| `scripts/contributor_audit.py` | M | 1 |
| `scripts/desktop-update` | D | 1 |
| `scripts/ensure-electron-binary.mjs` | A | 1 |
| `scripts/install.ps1` | M | 1 |
| `scripts/install.sh` | M | 1 |
| `scripts/lib` | M | 1 |
| `scripts/overlay-brand-assets.mjs` | A | 1 |
| `scripts/overlay-brand-assets.test.mjs` | A | 1 |
| `scripts/probe_okvevo_auto_router.py` | A | 1 |
| `scripts/probe_okvevo_auto_router.report.json` | A | 1 |
| `scripts/release.py` | M | 1 |
| `skills/creative/baoyu-infographic` | M | 1 |
| `skills/creative/manim-video` | M | 1 |
| `tests-js/window-open-policy.test.ts` | A | 1 |
| `tests/ci` | M | 1 |
| `tests/conftest.py` | M | 1 |
| `tests/fixtures` | D | 1 |
| `tests/openviking_plugin` | M | 1 |
| `tests/plugins` | A | 1 |
| `tests/providers` | M | 1 |
| `tests/run_agent` | A | 1 |
| `tests/scripts` | A | 1 |
| `tests/security` | A | 1 |
| `tests/skills` | M | 1 |
| `tests/state` | M | 1 |
| `tests/test_98924_readonly_fts_decode_error.py` | D | 1 |
| `tests/test_desktop_update_windows_retry_policy.py` | D | 1 |
| `tests/test_env_loader_secret_sources.py` | M | 1 |
| `tests/test_estop.py` | M | 1 |
| `tests/test_fts_update_of_narrowing.py` | M | 1 |
| `tests/test_gitlock.py` | M | 1 |
| `tests/test_hermes_logging.py` | M | 1 |
| `tests/test_hermes_state.py` | M | 1 |
| `tests/test_hermes_state_conn_lock_audit.py` | D | 1 |
| `tests/test_install_clone_throttle_fallback.py` | D | 1 |
| `tests/test_install_sh_node_deps_workspaces.py` | D | 1 |
| `tests/test_install_sh_node_prerelease.py` | D | 1 |
| `tests/test_install_sh_node_probe_87460.py` | D | 1 |
| `tests/test_ollama_num_ctx.py` | M | 1 |
| `tests/test_packaging_metadata.py` | M | 1 |
| `tests/test_profile_isolation_runtime.py` | M | 1 |
| `tests/test_session_db_profile_stamp.py` | D | 1 |
| `tests/test_session_db_read_conn_pool.py` | M | 1 |
| `tests/test_session_db_read_path_split.py` | M | 1 |
| `tests/test_session_detail_malformed_db.py` | D | 1 |
| `tests/test_state_db_malformed_repair.py` | M | 1 |
| `tests/test_timezone.py` | M | 1 |
| `tests/test_tui_gateway_server.py` | M | 1 |
| `tests/test_windows_subprocess_no_window_flags.py` | M | 1 |
| `tests/test_zeroed_state_db.py` | M | 1 |
| `tools/annotate_preview_tool.py` | M | 1 |
| `tools/apply_layout_tool.py` | M | 1 |
| `tools/approval.py` | M | 1 |
| `tools/async_delegation.py` | M | 1 |
| `tools/bot_mode_dm.py` | M | 1 |
| `tools/bot_mode_probe.py` | M | 1 |
| `tools/bot_relay.py` | M | 1 |
| `tools/browser_lightpanda.py` | D | 1 |
| `tools/browser_tool.py` | M | 1 |
| `tools/browser_use_cli.py` | M | 1 |
| `tools/checkpoint_manager.py` | M | 1 |
| `tools/close_preview_tool.py` | M | 1 |
| `tools/code_execution_tool.py` | M | 1 |
| `tools/computer_use` | M | 1 |
| `tools/credential_files.py` | M | 1 |
| `tools/cronjob_tools.py` | M | 1 |
| `tools/delegate_tool.py` | M | 1 |
| `tools/drive_preview_tool.py` | M | 1 |
| `tools/env_passthrough.py` | M | 1 |
| `tools/environments` | D | 1 |
| `tools/focus_pane_tool.py` | M | 1 |
| `tools/interrupt.py` | M | 1 |
| `tools/lazy_deps.py` | M | 1 |
| `tools/mcp_oauth.py` | M | 1 |
| `tools/mcp_tool.py` | M | 1 |
| `tools/open_preview_tool.py` | M | 1 |
| `tools/path_security.py` | M | 1 |
| `tools/preview_tool.py` | M | 1 |
| `tools/process_registry.py` | M | 1 |
| `tools/react_to_message_tool.py` | M | 1 |
| `tools/read_preview_tool.py` | M | 1 |
| `tools/read_terminal_tool.py` | M | 1 |
| `tools/read_window_tool.py` | M | 1 |
| `tools/send_message_tool.py` | M | 1 |
| `tools/setup_mcp_tool.py` | M | 1 |
| `tools/skill_ledger.py` | M | 1 |
| `tools/skill_manager_tool.py` | M | 1 |
| `tools/skill_usage.py` | M | 1 |
| `tools/skills_sync.py` | M | 1 |
| `tools/skills_tool.py` | M | 1 |
| `tools/subagent_worktree.py` | M | 1 |
| `tools/terminal_tool.py` | M | 1 |
| `tools/tip_tool.py` | M | 1 |
| `tools/tour_tool.py` | M | 1 |
| `tools/transcription_tools.py` | M | 1 |
| `tools/url_safety.py` | M | 1 |
| `tools/vision_tools.py` | M | 1 |
| `tools/wake_word.py` | M | 1 |
| `tools/web_tools.py` | M | 1 |
| `tools/working_diff.py` | M | 1 |
| `toolsets.py` | M | 1 |
| `trajectory_compressor.py` | M | 1 |
| `tui_gateway/compute_host.py` | M | 1 |
| `tui_gateway/host_supervisor.py` | M | 1 |
| `tui_gateway/hosted_room_driver.py` | D | 1 |
| `tui_gateway/hosted_room_peer_http.py` | D | 1 |
| `tui_gateway/hosted_room_peer_transport.py` | D | 1 |
| `tui_gateway/hosted_room_server_rpc.py` | D | 1 |
| `tui_gateway/hosted_room_service.py` | D | 1 |
| `tui_gateway/methods_bot_relay.py` | M | 1 |
| `tui_gateway/methods_complete.py` | M | 1 |
| `tui_gateway/methods_groups.py` | D | 1 |
| `tui_gateway/methods_images.py` | M | 1 |
| `tui_gateway/methods_profiles.py` | M | 1 |
| `tui_gateway/methods_prompt.py` | M | 1 |
| `tui_gateway/methods_session.py` | M | 1 |
| `tui_gateway/methods_tools.py` | M | 1 |
| `tui_gateway/server.py` | M | 1 |
| `utils.py` | M | 1 |
| `uv.lock` | M | 1 |
| `web/index.html` | M | 1 |
| `web/src` | M | 1 |
| `website/docs` | D | 1 |
| `website/i18n` | D | 1 |
| `website/sidebars.ts` | M | 1 |


## Identity audit at v0.22.4 (2026-10-22)

Every model-facing identity string at the tag, and how it resolves — zero core patches:

| Surface | Where | Resolution |
|---|---|---|
| `SOUL.md` seeded to users (`DEFAULT_SOUL_MD`) | `hermes_cli/default_soul.py`, seeded by `hermes_cli/config.py::_ensure_default_soul_md` + `hermes_cli/profiles_initialization.py` | `scripts/okvevo/make_soul.py` generates the OkVevo SOUL (identity phrases only, fail-closed); desktop writes it before first backend boot and the config migration upgrades any SOUL.md that byte-matches the upstream/Nia default (root + every `~/.hermes/profiles/*`) |
| `DEFAULT_AGENT_IDENTITY` fallback | `agent/prompt_builder.py:159`; used by `agent/system_prompt.py::_identity_parts`, codex transports | Fires only for soul-skipping internal sessions (curator, `ignore_rules` managed workers, gateway platforms that opt into `skip_context_files`, codex instructions fallback). Internal-only; accepted residual, tested in `plugins/okvevo/tests/test_identity.py::test_internal_fallback_is_upstream_default` |
| `HERMES_AGENT_HELP_GUIDANCE(_NO_SKILLS)` — "You run on Hermes Agent (by Nous Research)… docs" | `agent/prompt_builder.py:170/182`, injected in every session's stable parts | Kept: honest engine attribution + self-help docs pointer. Does not change self-identification (SOUL is identity slot #1). Flag to Karan in TESTING.md |
| Desktop/TUI platform hints — "Hermes desktop app", "Hermes terminal UI" | `agent/prompt_builder.py:691/700` | Upstream hook `agent.platform_hints.<platform>.replace` (`agent/agent_init.py:1440`, `agent/system_prompt.py::_resolve_platform_hint`); commit-3 config migration sets `agent.platform_hints.desktop.replace` with OkVevo wording |
| Curator / MoA / compaction / ACP "Hermes" mentions | `agent/curator.py:291`, `agent/moa_loop.py`, `agent/compaction_events.py`, `agent/copilot_acp_client.py:49` | Internal machinery prompts, not user-persona surfaces. Accepted |
| Default bot name on Bots screen | desktop renderer | Commit 3: default agent/bot = "OkVevo agent"; bots created in the app get the generated SOUL |

Prompt-assembly tests: `plugins/okvevo/tests/test_identity.py` (default bot, new bot profile, subagent → "You are OkVevo agent, built by OkVevo."; reverse-swap restores upstream SOUL byte-for-byte; `is_legacy_template_soul` must not match the generated soul so upstream's scaffold upgrade can never overwrite it).

## Pre-existing test failures on clean v0.22.4 (not caused by this fork)

`pytest tests/providers/ tests/hermes_cli/test_actual_provider.py` in one run → 29 failures from
cross-file test pollution; the identical 29 fail on a clean `v0.22.4` worktree (verified 2026-10-22,
failure lists diffed byte-identical). Each file passes standalone. Upstream CI shards these; do the
same in okvevo-checks.yml and do not chase these as fork regressions.
