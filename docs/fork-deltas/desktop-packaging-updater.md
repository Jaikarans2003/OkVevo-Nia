# Fork deltas — desktop packaging / updater / channels

---

### Update feeds + runtime

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` |
| **Files** | `apps/desktop/package.json` `build.publish` → `https://releases.okvevo.com`; `apps/desktop/electron/binary-updater.ts`; pack env `NIA_UPDATE_FEED_URL` / `NIA_UPDATE_CHANNEL`; updates overlay (closeable error) |
| **What** | Staging feed under `/staging/`; production root after Publish release |
| **Why** | OkVevo R2 two-feed model (not Hermes Cloud) |
| **Re-apply** | Prefer Nia publish URLs; keep unsigned-update error UX |
| **Check** | Packaged updater channel smoke; `docs/CI-CD.md` |

### CI pack / publish

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` |
| **Files** | `.github/workflows/desktop-staging.yml`, `desktop-production.yml`, `desktop-publish.yml`, `desktop-pack.yml`, `okvevo-nia-remote-guard.yml`; `apps/desktop/scripts/ci-map-pack-env.mjs`, `ci-desktop-version.mjs`, `publish-release-feed.mjs`, `pack-agent-snapshot.mjs` |
| **What** | OkVevo-only desktop Actions; agent snapshot in DMG/EXE |
| **Why** | Team staging + customer publish pipeline |
| **Re-apply** | Do not replace with Nous release workflows |
| **Check** | Green Desktop staging after push (when pack paths change) |

### Windows STT pins

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` + `[desktop]` |
| **Files** | `hermes_cli/tools_config.py` / `pyproject.toml` — win32 `ctranslate2==4.6.0`, `setuptools>=70,<81`; Silero VAD off on Windows |
| **What** | Packaged Voice Dictate stability |
| **Why** | Upstream bump crashes Windows STT |
| **Re-apply** | Keep pins on win32 only |
| **Check** | Windows packaged STT smoke |

### Ops docs

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` |
| **Files** | `docs/CI-CD.md`, `docs/FINISH-SIGNED-RELEASE.md`, `ENVIRONMENT.md`, `PRE-LIVE-BACKLOG.md` |
| **What** | OkVevo release / signing / pack-env documentation |
| **Why** | Non-technical founder + agent ops |
| **Re-apply** | Keep; do not replace with Hermes Cloud docs |
| **Check** | Doc links match live feeds |
