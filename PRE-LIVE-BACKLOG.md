# Pre-live backlog

Items here are **not urgent day-to-day**, but **must be closed before any external tester or production ship** (“go live”). They are easy to defer and expensive to rediscover — keep this file current.

**Canonical repo:** `Jaikarans2003/OkVevo-Nia`  
**Last reviewed:** 2026-08-31 (public-repo bootstrap retest — repo public by deliberate choice; do not re-private without auth or bundled path)

---

## How to use this file

1. **Before go-live:** every row in **Hard gates** must be `[x]` done; **Required before live** should be `[x]` unless explicitly accepted with a dated waiver note.
2. **When deferring work:** if a task is out of scope for the current pass but must ship eventually, add or extend an entry here **in the same PR/session** — do not rely on chat memory or plan files alone.
3. **When closing an item:** mark the checkbox, add `Closed:` date + commit/PR link, move to **Closed** at the bottom (keep history).
4. **Verification:** each entry lists a concrete grep, test, or manual check — run it when claiming done.

### Entry template (copy for new items)

```markdown
### [ ] Short title

| Field | Value |
|-------|-------|
| **Gate** | Hard gate / Required before live / Nice-to-have |
| **Risk if skipped** | One sentence — what breaks for real users |
| **Scope** | Files or directories |
| **Fix** | What to change (specific constants, strings, URLs) |
| **Verify** | Command or checklist |
| **Notes** | Context, links, dependencies |
```

---

## Hard gates (block go-live)

### [ ] Desktop auto-update still targets Nous releases

| Field | Value |
|-------|-------|
| **Gate** | Hard gate |
| **Risk if skipped** | A **working** Nia install can silently check updates against `NousResearch/hermes-agent` releases and drift back toward Hermes — worse than a broken first install because it hits users who already succeeded. |
| **Scope** | `apps/desktop/electron/update-remote.ts`, `apps/desktop/electron/update-remote.test.ts`, `apps/desktop/electron/update-count.test.ts` |
| **Fix** | Repoint `OFFICIAL_REPO_HTTPS_URL` and `OFFICIAL_REPO_CANONICAL` to `https://github.com/Jaikarans2003/OkVevo-Nia.git` / `github.com/jaikarans2003/okvevo-nia`. Update all test fixtures that hardcode Nous URLs or compare API paths. |
| **Verify** | `rg 'NousResearch/hermes-agent' apps/desktop/electron/update-remote.ts apps/desktop/electron/update-remote.test.ts apps/desktop/electron/update-count.test.ts` → 0 matches (except historical comments if any remain intentionally). Run desktop electron tests for those files. |
| **Notes** | Out of scope for first-install bootstrap (already fixed: `install.sh`, `install.ps1`, `bootstrap-runner.ts`, `install_script.rs`). This is the **first-update** path. Source: installer identity rebrand plan, Cursor pass 2026-08-31. |

### [ ] Private repo breaks DMG first-install bootstrap

| Field | Value |
|-------|-------|
| **Gate** | Hard gate |
| **Risk if skipped** | `raw.githubusercontent.com` does not serve private repos without a token. Packaged DMG bootstrap (`bootstrap-runner.ts` `downloadInstallScript`) and `install.sh` git clone both hit GitHub unauthenticated — same HTTP 404 as 2026-08-31 if the repo is private. First install never starts: no clone, no SOUL.md, no first chat. |
| **Scope** | `apps/desktop/electron/bootstrap-runner.ts` (`downloadInstallScript`), `apps/bootstrap-installer/src-tauri/src/install_script.rs` (same raw URL pattern). Product/repo policy: `Jaikarans2003/OkVevo-Nia` visibility. |
| **Why acceptable now** | Repo is **public by deliberate choice** to unblock first-install bootstrap — not because the fetch path is safe when private. |
| **Fix (pick one before re-privatizing; do not implement both speculatively)** | **Auth path:** repo-scoped read-only GitHub deploy token embedded in the shipped app, sent as `Authorization` on both the raw script fetch and the git clone. Keeps a **live GitHub dependency at every install**; smaller DMG; secret to manage and rotate. **Bundled path:** ship `install.sh` and an initial repo snapshot inside the DMG so first-install has **no live GitHub dependency**. Bigger DMG; requires a rebuild whenever shipped backend code changes. |
| **Hard gate** | Do **not** flip `Jaikarans2003/OkVevo-Nia` back to private until one of the above is implemented **and tested**, not just noted. Public visibility is an interim workaround, not the close condition. |
| **Verify** | 1) While public: `curl -sI "https://raw.githubusercontent.com/Jaikarans2003/OkVevo-Nia/main/scripts/install.sh"` → **200**. 2) Fresh install: `rm -rf ~/.hermes`, launch DMG app, complete first-run — bootstrap log must **not** show `HTTP 404` on raw fetch; must reach clone + Nia SOUL. 3) Before re-privatizing: auth or bundled path implemented and same fresh-install test passes with repo private. |
| **Notes** | **Reproduced 2026-08-31 (private):** DMG `Nia-0.17.0-mac-arm64.dmg`, stamp `07567979f4`, log `~/.hermes/logs/desktop.log`: `fetching install.sh for 07567979f4b8 from GitHub` → `404 from https://raw.githubusercontent.com/Jaikarans2003/OkVevo-Nia/07567979f4.../scripts/install.sh`. `git ls-remote okvevo main` succeeds (commit exists); raw + unauthenticated API return 404. Existing fallback to `installed-agent` only helps **re**-bootstrap, not first install on empty `~/.hermes`. |

---

## Required before live

### [ ] Clone-shipped TUI + web dashboard still say “Hermes” in many user-facing strings

| Field | Value |
|-------|-------|
| **Gate** | Required before live |
| **Risk if skipped** | Fresh installs get Nia SOUL/persona from backend, but TUI and web UI still show Hermes in setup, updates, channels, achievements, wake-word help, etc. — inconsistent product identity. |
| **Scope** | `ui-tui/src/**`, `web/src/**` (exclude `**/*.test.*`, `**/__tests__/**` where identifiers are intentional). Partial Nia work already landed: `ui-tui/src/components/branding.tsx`, `ui-tui/src/theme.ts`, `web/index.html`, `web/src/i18n/en.ts` (commit `e23f5d5c05`). |
| **Fix** | Scoped rebrand pass: user-visible copy → Nia / OkVevo; keep internal API names (`HermesSkin`, `X-Hermes-Session-Token`, `updateHermes` **keys** in i18n types) only where they are protocol/SDK identifiers — rename display strings, not wire format, unless a deliberate API change is approved. |
| **Verify** | `rg 'Hermes' ui-tui/src web/src --glob '*.{tsx,ts,html}' --glob '!**/*.test.*' --glob '!**/__tests__/**'` — triage every match; user-facing hits should → 0 or be explicitly documented exceptions. |
| **Notes** | Known examples (non-exhaustive): `ui-tui/src/content/setup.ts` (“Hermes needs a model provider”), `useMainApp.ts` fallback `'Hermes'`, wake-word help (“Hey Hermes”), `web/src/i18n/en.ts` `updateHermes` / “Hermes Achievements”, `ChannelsPage.tsx` `bot_name: "Hermes Agent"`, all non-English `web/src/i18n/*.ts` `brand: "Hermes Agent"`. Not blocking SOUL.md / bootstrap URL fix. |

### [ ] Desktop/Electron shell rebrand not yet committed

| Field | Value |
|-------|-------|
| **Gate** | Required before live (for DMG/desktop ship) |
| **Risk if skipped** | Shipped desktop app shows Hermes icons, window title, shortcuts, onboarding copy — contradicts Nia identity in clone-shipped backend. |
| **Scope** | ~50 unstaged files under `apps/desktop/**`, `apps/bootstrap-installer/**` (icons, `brand-mark.tsx`, i18n, `product.ts`, etc.). Local-only as of 2026-08-31; not on `okvevo/main`. |
| **Fix** | Review unstaged desktop work, complete rebrand, commit as dedicated desktop identity pass. Include `install.ps1` shortcut names (`Hermes.lnk` → `Nia.lnk`) if desktop product name is Nia. |
| **Verify** | Build DMG/installer; spot-check window title, icon, onboarding, uninstall strings. `rg -i 'hermes' apps/desktop/src --glob '!**/*.test.*'` — user-facing hits triaged. |
| **Notes** | DMG-baked assets do not affect `git clone` bootstrap; separate from clone-shipped backend commit `e23f5d5c05`. |

---

## Should fix before live (lower severity)

### [ ] CLI update-check / release links still point at Nous

| Field | Value |
|-------|-------|
| **Gate** | Should fix before live |
| **Risk if skipped** | `hermes update` / banner version checks query Nous repo, not OkVevo-Nia. |
| **Scope** | `hermes_cli/banner.py` — `_UPSTREAM_REPO_URL` (L141) |
| **Fix** | `https://github.com/Jaikarans2003/OkVevo-Nia.git` |
| **Verify** | `rg 'NousResearch/hermes-agent' hermes_cli/banner.py` → 0 |

### [ ] npm package metadata still references Nous repo

| Field | Value |
|-------|-------|
| **Gate** | Should fix before live |
| **Risk if skipped** | Package/repository metadata mislabels product source. |
| **Scope** | `apps/desktop/package.json` — `repository.url` |
| **Fix** | Point at `Jaikarans2003/OkVevo-Nia` |
| **Verify** | Inspect `package.json` repository field |

### [ ] Public docs still quote Hermes fallback identity

| Field | Value |
|-------|-------|
| **Gate** | Should fix before live (if website ships with product) |
| **Risk if skipped** | Documentation contradicts Nia persona. |
| **Scope** | `website/docs/**` |
| **Fix** | Replace Hermes/Nous fallback identity strings with Nia/OkVevo |
| **Verify** | `rg 'Hermes Agent|Nous Research' website/docs` — triage |

### [ ] Dev/tooling scripts still default to Nous upstream (non-bootstrap)

| Field | Value |
|-------|-------|
| **Gate** | Nice-to-have before live; required for contributors targeting OkVevo fork |
| **Risk if skipped** | Contributor/dev scripts clone or audit wrong repo; does not affect end-user first install. |
| **Scope** | `scripts/dev-sandbox.sh`, `scripts/contributor_audit.py`, `scripts/release.py`, `scripts/install.cmd` (comment), others — see grep below |
| **Fix** | Repoint defaults to OkVevo-Nia where appropriate; keep overrides env-driven |
| **Verify** | `rg 'NousResearch/hermes-agent' scripts/` — triage each hit (bootstrap paths already clean) |

---

## Closed

_(Move items here when done.)_

| Item | Closed | Commit / PR |
|------|--------|-------------|
| First-install bootstrap clone/download URLs → OkVevo-Nia | 2026-08-31 | `07567979f4` |
| Installer SOUL.md seed + legacy Hermes upgrade | 2026-08-31 | `07567979f4` |
| Clone-shipped backend identity (Python, SOUL, locales, tests) | 2026-08-31 | `e23f5d5c05` |
