# Fork deltas — branding / white-label

Surface tags: `[agent]` = Python agent (also needed on a future Docker/Cloud image); `[desktop]` = Electron/UI; `[portal]` = OkVevo-Web contract (usually noted only).

Keep root `LICENSE` (MIT, Copyright Nous Research). Never strip NOTICE/copyright attribution. Internal identifiers stay: `~/.hermes`, `hermes` CLI, `hermes://`, `HERMES_*` env, Python module paths.

---

### Identity seed and prompts

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` |
| **Files** | `SOUL.md`, `docker/SOUL.md`, `hermes_cli/default_soul.py`, `scripts/install.sh`, `scripts/install.ps1`, `agent/prompt_builder.py` (`DEFAULT_AGENT_IDENTITY`, `PRODUCT_IDENTITY_GUIDANCE` ~L201+), `agent/system_prompt.py` |
| **What** | Persona is Nia / OkVevo; structural product-identity guidance; install seeds clone `Jaikarans2003/OkVevo-Nia` |
| **Why** | White-label; stop “Hermes/Nous built this” and wrong clone URLs |
| **Re-apply** | Restore Nia SOUL text + identity blocks after taking upstream files; keep install repo URLs on OkVevo-Nia |
| **Check** | `pytest tests/agent/test_identity_prompt.py`; `python3 scripts/check_nia_branding.py` |

### User-facing brand scrub

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[desktop]` |
| **Files** | `agent/brand_scrub.py`, `agent/user_facing_brand.py`, `tests/fixtures/brand_scrub_golden.json`, desktop `src/lib/product-phrasing.ts`, `display-path.ts`, `user-facing-error.ts`, `provider-branding.ts`, assistant-message scrub hooks |
| **What** | Hermes/Nous/vendor paths rewritten to Nia/OkVevo for user-visible strings; `~/.hermes` → `~/.nia` in display paths |
| **Why** | Public chat and errors must not leak upstream brand |
| **Re-apply** | Port modules + golden; keep TS table in sync with Python |
| **Check** | `pytest tests/agent/test_brand_scrub.py tests/agent/test_user_facing_brand.py` |

### Desktop shell identity

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` |
| **Files** | `apps/desktop/package.json` (`productName` Nia, `appId` `com.okvevo.nia`, internal `com.okvevo.nia.internal`), icons under `apps/desktop/assets/`, `apps/bootstrap-installer/`, i18n locales, About → okvevo.com |
| **What** | OS name, bundle id, icons, publisher strings |
| **Why** | Customer-facing installers and About |
| **Re-apply** | Prefer Nia side of `package.json` / assets when merging electron-builder blocks |
| **Check** | `python3 scripts/check_nia_branding.py`; visual About/icon smoke |

### Phase 5 — user-visible scrub (before paying customers)

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` + installer copy in `[agent]` scripts customers see |
| **Files** | `apps/desktop/src/i18n/*`, Electron/renderer string literals (dialogs, menus, tray, notifications, errors, About), `apps/bootstrap-installer/` UI, `scripts/install.sh` / `install.ps1` banners and logs, `locales/*.yaml` CLI catalog, `set-exe-identity.mjs` CompanyName, `tauri.conf.json` publisher, bootstrap `Info.plist` permission strings |
| **What** | Product words Hermes → Nia and Nous → OkVevo in those strings. Help links leave `hermes-agent.nousresearch.com`, `portal.nousresearch.com`, and `github.com/NousResearch/hermes-agent` for `www.okvevo.com` or `Jaikarans2003/OkVevo-Nia`. Windows CompanyName and Tauri publisher are OkVevo. |
| **Why** | Paying customers must not see the upstream product name |
| **Keep** | `LICENSE` / NOTICE / `LegalCopyright` and Tauri `copyright` still name Nous Research. Internal ids stay: `~/.hermes`, `hermes` CLI, `hermes://`, `HERMES_*`, package name `hermes`, `Hermes.app` path tokens, `.agents.nousresearch.com` host checks. Installer grep still matches the old `# Hermes Agent browser tools` comment so upgrades strip it. Diagnostics copy does not claim the bundle is stored by OkVevo. |
| **Re-apply** | Rebrand new user-visible strings before merge; do not rename internal ids to make the checker pass |
| **Check** | `python3 scripts/check_nia_branding.py` (fails if a seeded product word lands in any Phase 5 path) |

### AGENTS / process

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` (docs) |
| **Files** | `AGENTS.md` (OkVevo push header), `.cursor/rules/okvevo-nia-remote.mdc`, `.github/workflows/okvevo-nia-remote-guard.yml` |
| **What** | Push only `okvevo`, never `origin`/Nous |
| **Why** | Hard fork rule |
| **Re-apply** | Keep header + guard workflow |
| **Check** | Remote-guard workflow on PR |
