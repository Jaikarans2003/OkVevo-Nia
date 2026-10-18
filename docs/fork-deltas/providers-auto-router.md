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

### GPT Image 2 shipped + named model mandatory (2026-10-18)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[portal]` |
| **Files** | `okvevo/media-catalog.json` + `OkVevo-Web/.../media-catalog.json` (byte-identical); `image_generation_tool.py`; `media_catalog.py`; `prompt_builder.py` skills preamble; `dramaChooser.selfcheck.ts` |
| **What** | One `openai/gpt-image-2` + `/edit` row each, `shipped: true`, alias `fal-ai/gpt-image-2`. Refusal text forbids retrying with `model` omitted. Klein remains default only when no model was named. |
| **Check** | `python3 scripts/check_media_catalog.py`; `pytest tests/tools/test_image_generation.py::TestNamedCatalogModel`; `npx tsx src/lib/fal/mediaCatalog.selfcheck.ts`; `npx tsx src/lib/fal/dramaChooser.selfcheck.ts` |

### Public-guard glob + token value mask (2026-10-18)

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[desktop]` |
| **Files** | `plugins/nia-public-guard/__init__.py`; `agent/redact.py` (`_redact_okvevo_token_values`); `apps/desktop/electron/backend-env.ts` (`NIA_USER_DATA_DIR`); `tests/plugins/test_nia_public_guard.py`; `tests/agent/test_redact.py` |
| **What** | Best-effort denylist: glob-expand `~/.h*` / `$HOME/.h*`, block token basenames and `OKVEVO_FIREBASE_*_TOKEN_FILE` env forms, protect `NIA_USER_DATA_DIR`. Exact-value mask of id/refresh token file contents (strip whitespace; skip empty / &lt;20 chars) → `[REDACTED]`. Refresh token stays on disk for Python rotation (not Electron safeStorage). |
| **Why** | Agent bridge.py used `~/.h*` + token basename to bypass the literal `/.hermes` substring check; JWTs also sat in Chromium leveldb under userData. |
| **Re-apply** | Keep glob + basename + env checks; keep value mask re-reading files each call; pass `app.getPath('userData')` as `NIA_USER_DATA_DIR`. |
| **Check** | `pytest tests/plugins/test_nia_public_guard.py tests/agent/test_redact.py -k "TokenAndGlob or OkvevoToken"` |

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
