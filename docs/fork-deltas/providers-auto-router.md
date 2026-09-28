# Fork deltas — provider lock + OkVevo Auto

---

### Public vs internal channel

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` + `[agent]` |
| **Files** | `apps/desktop/src/lib/build-channel.ts` (`isByokChromeVisible`), `apps/desktop/src/app/settings/settings-ui-policy.ts`, `plugins/nia-public-guard/`, `hermes_cli/inventory.py` (`okvevo_signed_in` unlocks OpenRouter row), `tui_gateway/methods_config.py` |
| **What** | Public builds hide BYOK providers/keys; `nia-public-guard` blocks CLI/file leaks; signed-in portal token unlocks OkVevo OpenRouter path |
| **Why** | Lock composer to metered OkVevo models for customers |
| **Re-apply** | Restore policy sets + plugin; keep inventory exemption |
| **Check** | `pytest tests/plugins/test_nia_public_guard.py`; settings-ui-policy tests |

### OkVevo Auto router

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[desktop]` |
| **Files** | `agent/okvevo_auto_router.py`, `agent/okvevo_auto_allowlists.py`, `plugins/model-providers/openrouter/__init__.py` (`auto_plugin`), `agent/transports/chat_completions.py` (`wire_model`), `hermes_cli/models.py`, `apps/desktop/src/app/shell/model-catalog-menu.tsx` |
| **What** | Virtual `okvevo/auto-*` → OpenRouter auto-beta + plugin; composer “OkVevo Auto” |
| **Why** | Branded Auto without BYOK |
| **Re-apply** | Re-add modules + wire_model call; restore menu section |
| **Check** | `pytest tests/providers/test_okvevo_auto_router.py` |

### Toolset defaults (staging)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` |
| **Files** | `hermes_cli/tools_config.py` (`bots`/`manage_bot` row; `video_gen` **on** by default; `_RECENTLY_SHIPPED_TOOLSETS` includes `bots`); `toolsets.py` as needed |
| **What** | Nia product defaults for bots + video |
| **Why** | Product surface |
| **Re-apply** | One-liners after tools_config merges |
| **Check** | tools_config / toolsets unit tests |

### Jev leak shadow (optional)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` |
| **Files** | `tools/openrouter_decisions.py`, `plugins/nia-public-guard` post_llm hook, env `NIA_JEV_LEAK_CLASSIFY` |
| **What** | Off-by-default shadow classifier |
| **Why** | Leak monitoring without rewriting user text |
| **Re-apply** | Keep env-gated |
| **Check** | `tests/agent/test_jev_leak_detect.py` when present |
