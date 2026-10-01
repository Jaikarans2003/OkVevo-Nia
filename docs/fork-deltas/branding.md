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
| **Files** | `brand/nia.json`, `brand/assets/` (Nia icon bytes), `scripts/overlay-brand-assets.mjs`, `apps/desktop/package.json` (`productName` Nia, `appId` `com.okvevo.nia`), `apps/desktop/scripts/before-pack.mjs`. Git copies of `apps/desktop/assets/icon.*`, bootstrap `src-tauri/icons/`, and `apps/desktop/public/apple-touch-icon.png` stay on the upstream blobs. |
| **What** | OS name, bundle id, publisher strings. Pack copies `brand/assets/` onto those icon paths and deletes `apple-touch-icon.png` (Nia does not ship it) before vite and in `beforePack`. |
| **Why** | Customer-facing installers and About. Upstream icon paths stay untouched so sync does not conflict on blobs. |
| **Re-apply** | New icon edits go in `brand/assets/`, not onto the upstream paths. Do not commit a dirty tree after a pack; reset the overlaid paths to upstream. |
| **Check** | `node --test scripts/overlay-brand-assets.test.mjs`; `python3 scripts/check_nia_branding.py` |

### Phase 5 — user-visible scrub (before paying customers)

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` + installer copy in `[agent]` scripts customers see |
| **Files** | `apps/desktop/src/i18n/*`, Electron/renderer string literals (dialogs, menus, tray, notifications, errors, About), `apps/bootstrap-installer/` UI, `scripts/install.sh` / `install.ps1` banners and logs, `locales/*.yaml` CLI catalog, `set-exe-identity.mjs` CompanyName, `tauri.conf.json` publisher, bootstrap `Info.plist` permission strings |
| **What** | Product words Hermes → Nia and Nous → OkVevo in those strings. Help links leave `hermes-agent.nousresearch.com`, `portal.nousresearch.com`, and `github.com/NousResearch/hermes-agent` for `www.okvevo.com` or `Jaikarans2003/OkVevo-Nia`. Windows CompanyName and Tauri publisher are OkVevo. |
| **Why** | Paying customers must not see the upstream product name |
| **Keep** | Root `LICENSE` / `NOTICE` stay the Hermes MIT text (`Copyright (c) 2025 Nous Research`). `apps/desktop/THIRD_PARTY_NOTICES.txt` is the same notice, bundled in the packaged app via electron-builder `extraResources` (`package.json` → `Contents/Resources/` on Mac, `resources/` on Windows). It is not linked from any UI. OSS notice bundled as a file, not shown in UI; website `/legal/open-source` page planned (OkVevo-Web, later). Product copyright on About, the installer, Windows `LegalCopyright`, and Mac `NSHumanReadableCopyright` is `© 2026 Azonova Technologies Pvt Ltd`. There is no About “Open-source licenses” section and no i18n string for it (the heading was hardcoded English; locale catalogs never had a key). Internal ids stay: `~/.hermes`, `hermes` CLI, `hermes://`, `HERMES_*`, `X-Hermes-Session-Token` (gateway session header; the Python server still requires this name), package name `hermes`, `Hermes.app` path tokens, `.agents.nousresearch.com` host checks. Installer grep still matches the old `# Hermes Agent browser tools` comment so upgrades strip it. Diagnostics copy does not claim the bundle is stored by OkVevo. |
| **Re-apply** | Rebrand new user-visible strings before merge; do not rename internal ids to make the checker pass |
| **Check** | `python3 scripts/check_nia_branding.py` (fails if Hermes or Nous Research appears in UI strings or i18n; those words are allowed only in `THIRD_PARTY_NOTICES.txt`, `LICENSE`, and `NOTICE`. Also fails on the phrase “open-source licenses” in UI copy, on `discord.gg/NousResearch`, or on a Nous Research copyright outside those three files) |

### AGENTS / process

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` (docs) |
| **Files** | `AGENTS.md` (OkVevo push header), `.cursor/rules/okvevo-nia-remote.mdc`, `.github/workflows/okvevo-nia-remote-guard.yml` |
| **What** | Push only `okvevo`, never `origin`/Nous |
| **Why** | Hard fork rule |
| **Re-apply** | Keep header + guard workflow |
| **Check** | Remote-guard workflow on PR |
