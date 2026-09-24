# Fork deltas — computer-use scope (upstream sync 2026-09-24)

Every Nia/OkVevo patch applied on top of `NousResearch/hermes-agent` in the
computer-use + tools_config-split scope, and how to re-apply each on the next
`origin/main` sync. Sync branch: `computer-use-upstream-sync`
(merge-base `4f22543509`, upstream tip `ee5ee84a34`).

Re-apply procedure per patch: after taking upstream's version of the file
(`git checkout origin/main -- <path>`), re-do the edit described. Each patch
is marked in-tree with a `Nia` / `Nia fork delta` comment — grep for those.

---

## Product patches (must never be lost)



### 1. `hermes_cli/tools_config_cua.py` — CUA driver version pin

- **What:** `PINNED_CUA_DRIVER_VERSION = "0.28.2"` + `_parse_cua_driver_semver()`
helper (after the no-pre-install-probe comment block). Fresh installs pass
`pin_version=PINNED_CUA_DRIVER_VERSION or None`. The compatible-existing
install path treats an off-pin binary as `off_pin=True` and falls through to
a refresh install of the pinned release. The upgrade path
(`_confirmed_update_check`) is skipped entirely when pinned: on-pin → success
message + return; off-pin → `confirmed_version = PINNED`. Final installer
call uses `pin_version=confirmed_version or (PINNED_CUA_DRIVER_VERSION or None)`.
- **Why:** Nia ships a validated cua-driver; an upstream "install latest"
prompt or auto-upgrade can pull an unvalidated driver and break the packaged
app (TCC identity, MCP contract).
- **Re-apply:** re-add the constant + helper, then wire the three call sites
(fresh install, off-pin detection in the compatible path, upgrade-path pin
guard). Tests: `tests/hermes_cli/test_install_cua_driver.py` (see patch 8).



### 2. `hermes_cli/subcommands/computer_use.py` — status pin guard

- **What:** in `_cu_status`, before the `cua_driver_update_check()` nudge:
when the installed driver equals the pin, print
`✓ On pinned release {have} (Nia pin).` and return — no "update available"
prompt.
- **Why:** same as patch 1 — suppress upstream's check-update prompt when pinned.
- **Re-apply:** re-add the early-return guard ahead of the update check.



### 3. `hermes_cli/tools_config.py` — pin re-exports + Nia toolset defaults

- **What:** (a) `PINNED_CUA_DRIVER_VERSION` and `_parse_cua_driver_semver`
added to the `tools_config_cua` re-export list; (b) `("bots", "🤖 Bots", "manage_bot")` row in `CONFIGURABLE_TOOLSETS` (between clarify and
delegation); (c) `"video_gen"` removed from `_DEFAULT_OFF_TOOLSETS`.
- **Why:** (a) tests and other modules import the pin via the slim shell;
(b) Nia's bot-management surface; (c) video generation is ON by default in
Nia (product decision 2026-09).
- **Re-apply:** all three are one-liners in the slim shell.



### 4. `toolsets.py` — Nia toolset content on upstream's registry rewrite

- **What:** (a) `video_generate` added to `_HERMES_CORE_TOOLS`
("Vision + image/video generation"); (b) `manage_bot` added to
`_HERMES_CORE_TOOLS` after `clarify`; (c) `video_gen` toolset static
membership reduced to `["video_generate"]` with the subset-inference comment
(issue #49622 — xai_video_edit/extend merge back via the registry);
(d) `"bots"` toolset: `_ts("Create, list, and update Nia bots", ["manage_bot"])`.
- **Why:** Nia product surface — video on by default; manage_bot is the
least-privilege bot tool. In upstream's new architecture `_HERMES_CORE_TOOLS`
feeds every platform bundle via `_bundle()`, so the old per-composite
`manage_bot` hunk is subsumed by (b).
- **Re-apply:** four small edits; all carry `Nia:` comments.



### 5. `agent/image_routing.py` — shipped-default aux-vision skip

- **What:** inside `_explicit_aux_vision_override`, Nia's 14-line block: compute
provider/model/base_url, return False early when unset, then skip the override
when the config still matches the shipped DEFAULT_CONFIG (so packaged users
aren't forced onto an aux-vision path they never chose), then `return True`.
- **Why:** packaged Nia must not treat the shipped default config as an
explicit user override.
- **Re-apply:** take upstream's file, re-insert the DEFAULT_CONFIG comparison
block in `_explicit_aux_vision_override`.



### 6. `tools/computer_use/vision_routing.py` — delegate to agent.image_routing

- **What:** upstream inlines its own `_explicit_aux_vision_override`; Nia
replaces the body with a delegation to
`agent.image_routing._explicit_aux_vision_override`.
- **Why:** single source of truth — the computer-use vision gate must inherit
patch 5's shipped-default skip, not diverge from it.
- **Re-apply:** replace the inlined function with the delegation.



### 6b. `hermes_cli/config_defaults.py` — shipped vision / compression / voice

- **What:** `auxiliary.vision` ships `openrouter` / `z-ai/glm-5.3-flash`;
`auxiliary.compression` ships `openrouter` / `z-ai/glm-5.2`; Windows
`stt.vad` defaults off (onnxruntime crash); wake `provider` is `sherpa`
and `phrase` is `ok nia`.
- **Why:** packaged Nia must work without a user naming a vision backend;
patch 5 treats exactly this vision block as "not user-pinned".
- **Re-apply:** re-insert the Nia comments + values on those four keys.



### 6c. `hermes_cli/config_migrations.py` — `_migrate_to_40` GLM aux pin

- **What:** inherit-main (`provider=auto` + empty model) compression/vision
slots are rewritten to the shipped GLM pins. Shares target version 40
with upstream's model_catalog ttl step (disjoint keys).
- **Why:** existing installs have empty aux slots on disk that would
otherwise win over DEFAULT_CONFIG via deep-merge.
- **Re-apply:** re-add `_aux_slot_is_inherit_main`, `_migrate_to_40`, and
the `(40, _migrate_to_40)` row in `MIGRATIONS`.



### 6d. `hermes_cli/profiles.py` — named-profile (bot) seed

- **What:** new profiles seed `SOUL.md` with the bot's name, not Nia's
`DEFAULT_SOUL_MD`. `provision_named_profile` (+ voice-section mirror)
is the shared RPC / `manage_bot` helper.
- **Why:** a blank-personality bot must not introduce itself as Nia.
- **Re-apply:** keep the SOUL seed one-liner and the helper block at the
file tail.



## Compatibility shims / split adaptations (needed because Nia does not carry upstream's browser-tool and web-server splits)



### 7. `tools/browser_tool_install.py` — NEW Nia shim module

- **What:** re-exports `_chromium_installed`, `_find_agent_browser`,
`_is_npx_agent_browser_sentinel`, `_resolve_npx_bin`, `_running_in_docker`
from `tools.browser_tool`, plus `node_tool_runnable` / `agent_browser_runnable`
from `hermes_constants`.
- **Why:** upstream moved these helpers out of `browser_tool.py` into
`browser_tool_install.py` (browser-tool split Nia doesn't carry). Shared code
(`hermes_cli/tools_config_post_setup.py`) and upstream tests import the new
path; the shim keeps both working.
- **Re-apply:** keep the shim as long as the browser-tool split is not taken.



### 8. `tests/hermes_cli/test_install_cua_driver.py` — pin test adaptations

- **What:** `test_non_upgrade_with_binary_skips_install` mocks the pinned
version; added `test_non_upgrade_off_pin_refreshes_to_pinned_release` and
`test_upgrade_on_pin_skips_check_update`; pin_version asserts on repair and
fresh-install tests; `TestRequireConfirmedUpdate` /
`TestConfirmedVersionPinning` patch `PINNED_CUA_DRIVER_VERSION` to `""` to
exercise the upstream unpinned flow.
- **Why:** covers patch 1 both ways (pinned behavior + upstream flow intact
when the pin is lifted).
- **Re-apply:** same edits against upstream's version of the test file.



### 9. `tests/hermes_cli/test_tools_config.py` — patch-target + signature adaptations

- **What:** (a) `tools.browser_tool_install.node_tool_runnable` patch targets
repointed to `tools.browser_tool.node_tool_runnable` (indirect calls must be
patched where looked up — the shim's re-export doesn't intercept
`browser_tool`'s internal use); (b) the managed-catalog test calls Nia's
2-arg `_toolset_model_catalog("image_gen", plugin)` (Nia's web router loads
config internally; upstream's split takes a third config arg).
- **Re-apply:** same two edits.



### 10. `tests/hermes_cli/test_web_routers_tools_install_on_enable.py` — split patch targets

- **What:** module-level `import hermes_cli.tools_config_cua as tools_config_cua` / `tools_config_post_setup`; monkeypatches of
`_resolved_cua_driver_cmd` / `_cua_driver_install_ready` target those modules
instead of the `tools_config` re-export shell.
- **Why:** after the split, `_POST_SETUP_INSTALLED["cua_driver"]` resolves
`_cua_driver_install_ready` in `tools_config_post_setup`'s namespace;
patching the shell no longer propagates.
- **Re-apply:** re-point the monkeypatches.



### 11. `tests/computer_use/test_cua_no_overlay.py` — platform pin

- **What:** `test_serve_process_disables_overlay_when_policy_requires_it` also
patches `sys.platform` to `"linux"` for the duration of `daemon.start()`.
- **Why:** the asserted command shape is the non-darwin one; upstream only
exercises this test on linux CI, and on a macOS dev machine the darwin
branch requires a real CuaDriver.app. Pinning the platform makes the test
deterministic everywhere.
- **Re-apply:** re-add the `patch.object(cua_backend.sys, "platform", "linux")`.



### 12. `hermes_cli/web_server.py` — managed image catalog dispatch

- **What:** `_resolve_toolset_model_plugin` image_gen branch passes
`imagegen_backend` through verbatim (was: coerced to `"fal"`);
`_toolset_model_catalog` dispatches image_gen through `IMAGEGEN_BACKENDS`
(`backend["catalog_fn"](load_config())`) before falling back to the plugin
catalog.
- **Why:** with the tools_config split, the managed "nous" row's union catalog
(FAL + Krea + Portal) lives in `IMAGEGEN_BACKENDS`; without this the local
dashboard's model picker shows only FAL for managed accounts.
- **Re-apply:** port the same two edits (upstream's 3-arg signature is NOT
taken — Nia's web_server is the monolith).



### 13. `hermes_cli/tools_config_post_setup.py` — comment only

- **What:** comment noting the `browser_tool_install` import resolves to Nia's
shim (patch 7). No behavior change.



### 14. `tools/process_registry.py` — rebrand string

- **What:** "close_terminal is only available in the Nia desktop app."
- **Re-apply:** one-line string swap after taking upstream's file.



### 15. `tools/image_generation_tool.py` — `_get_plugin_provider` helper

- **What:** upstream's 9-line `_get_plugin_provider(name, *, force=False)`
added ahead of `check_image_generation_requirements`. Nia's file keeps its
own inline probe copies (not refactored — surgical).
- **Why:** taken `plugins/image_gen/` modules import the helper.
- **Re-apply:** re-add the function.



## Deletions (intentional)



### 16. `tests/computer_use/test_cua_cli_fallback_env.py` — deleted (upstream purged it)

- **What it covered:** the CLI-fallback spawn path sanitizing the driver
environment (stripping `HERMES_*`/`CUA_*` parent vars) and hiding the console
window on Windows when the driver is launched without the MCP wrapper.
- **Still tested?** YES — the behavior moved into
`tests/computer_use/test_cua_cli_fallback_env.py`'s replacement:
`tests/computer_use/test_cua_spawn_env_sanitization.py` L129
`test_cli_fallback_sanitizes_env_and_hides_console_on_windows` covers the same
env sanitization + Windows console hiding. Intentional removal of a duplicate,
not a coverage loss.



### 17. `tests/hermes_cli/test_subcommands_final_batch.py` — deleted

- **Why:** upstream batch test importing subcommands Nia does not carry (e.g.
`hermes_cli.subcommands.worktree`). computer-use subcommand coverage lives in
`test_computer_use_cli.py`, `test_computer_use_screen_install.py`, and
`test_bot_desktop_screen_stop.py`.



## Not taken (upstream workstreams Nia does not carry in this sync)

- `hermes_cli/web_routers/tools.py`, `hermes_cli/web_deps.py` — upstream's
web-server split (26 routers). Nia keeps its monolith `web_server.py` + its
own 9 routers; taking upstream's pair Frankensteined the portal surface
(15 behavioral test failures). Nia's `tests/hermes_cli/test_web_server.py`
and `test_web_routers_tools_install_on_enable.py` stay at Nia's versions.
- Upstream's `plugins/video_gen/fal` rewrite — Nia has its own +121/-9 delta
there; left untouched (no test required it).



### 15. `tools/computer_use/schema.py` — model-facing description (byte-frozen)

- **What:** One stable edit to `COMPUTER_USE_SCHEMA` description + `open_app`
  on the action enum + `query` property. Restored SAFETY / doctor /
  "Requires cua-driver" lines upstream dropped. Added C2 routing sentence
  (no Tally until S7) and
  `Never click/type from terminal (osascript System Events / SendKeys); use computer_use`.
  Default capture documented as `ax`. **Do not re-edit this description**
  (prompt cache).
- **Why:** R2 A/B first-tool mix on WhatsApp collapsed after upstream
  shortened the schema (B 1/3 `computer_use` vs A 3/3). Schema is the
  contract the model sees every turn.
- **Re-apply:** restore the description block on `COMPUTER_USE_SCHEMA` in
  `schema.py`; keep `open_app` in the enum and `query` in `_PROPERTIES`.
  Pair with tool.py `open_app` / fail-closed / Shift+Return / 2-retry /
  AX-first / `query` plumbing (S3, same session).
- **Verify:** `python3 -c "from tools.computer_use.schema import COMPUTER_USE_SCHEMA; d=COMPUTER_USE_SCHEMA['description']; assert 'open_app' in COMPUTER_USE_SCHEMA['parameters']['properties']['action']['enum']; assert 'Never click/type from terminal' in d; assert 'SAFETY' in d; assert 'Requires cua-driver' in d; assert 'Tally' not in d"`



## Bot Screen inertness (verified 2026-09-24)

Upstream's "Bot Screen" (`tools/bot_desktop/`, `computer-use screen`
subcommand) is **inert in Nia**, no gating needed:

- No UI entry — `apps/desktop` untouched by the sync.
- No model-facing tool — upstream dropped the handoff actions from the schema;
`computer_use` tool schema has no bot-screen actions.
- No network calls — the lease is file-based; `desktop_env()` is a pure file
read and a no-op when no desktop env is published.
- Reachable only via `tools/computer_use/tool.py` L334 `assert_agent_may_act()`
/ `ensure_started_for_tool()`: lease holder is never HUMAN on Nia, and
auto-start requires linux + `bot_desktop.auto_start` (default off).
- `is_supported_host()` is linux-only; Nia ships macOS/Windows.



## Taken wholesale from upstream (owned by upstream; do not hand-edit)

`tools/computer_use/` (split into `cua_backend_{capture,daemon,driver,input, parse,session}.py` etc.), `hermes_platform/`, `tools/bot_desktop/`,
`tools/vision_tools.py` + `vision_tools_history_budget.py` +
`vision_tools_image_prep.py`, `tools/image_source.py`, `tools/terminal_scope.py`,
`tools/mcp_tool_*.py` (common/config/discovery/errors/lifecycle/loop/
registration/schema/scope), `tools/browser_lightpanda.py`,
`tools/browser_tool_{cdp,cloud,lifecycle,lightpanda_fallback,origin, real_profile,session,snapshot}.py`, `tools/arg_coercion.py`,
`tools/approval_context.py`, `tools/connectors/`, `tools/environments/`,
`tools/file_tools_{paths,read_tracking}.py`,
`tools/image_generation_{catalog,managed}.py`, `tools/kanban_toolset_context.py`,
`tools/managed_gateway_auth.py`, `tools/mcp_liveness.py`,
`tools/process_registry.py` (less patch 14), `tools/send_message_senders.py`,
`tools/skills_hub_*.py`, `tools/terminal_tool_{backends,config,lifecycle}.py`,
`tools/tool_search_{catalog,validation}.py`, `agent/command_token_source.py`,
`agent/secret_scope.py`, `agent/turn_failure_copy.py`, `agent/codex_headers.py`,
`agent/rich_output.py` (optional-import shim target; guarded),
`hermes_cli/tools_config{,_cua,_mcp,_post_setup,_providers}.py` (less patches
1–3), `hermes_cli/toolset_{scope,validation}.py`,
`hermes_cli/subcommands/{_shared,computer_use,computer_use_screen}.py` (less
patch 2), `hermes_cli/local_runtime/`, `hermes_cli/web_routers/_common.py`,
`hermes_cli/web_server_{gateway,mcp,profiles}.py`, the `hermes_cli/auth_*` /
`anon_*` / `update_*` / `gateway_*` / `plugin_*` / `models_*` cascade modules,
`gateway/config_{env,loader}.py`, `gateway/host_*.py`,
`gateway/platforms/_shared.py`, `model_tools.py`, `utils.py`,
`hermes_constants.py`, `plugins/image_gen/` (whole directory),
`tui_gateway/launch_profile_policy.py`, `tui_gateway/contracts/connectors.py`.

Cascade rule for the next sync: these were pulled because the tools_config
split's import closure requires them. All were verified to have **zero
Nia-side deltas** (`git diff <merge-base> HEAD -- <path>` empty) before taking.
If a future sync shows Nia deltas on any of them, stop and 3-way merge instead.