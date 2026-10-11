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

### Electron runtime pin

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` |
| **Files** | `apps/desktop/package.json` (`electron` + `build.electronVersion` + `build.mac.minimumSystemVersion`); `scripts/ensure-electron-binary.mjs`; `.github/workflows/{js-tests,e2e-desktop,desktop-pack}.yml`; `electron/clipboard-image.ts` |
| **What** | Electron **44.4.5** (supported stable); builder **26.16.1**; explicit `ensure:electron` after npm ci (Electron 42+ dropped postinstall download); macOS **13.0+** |
| **Why** | Electron 40.x EOL 2026-06-30; Chromium CVEs stop landing on 40 |
| **Re-apply** | Keep exact pin (no `^`); keep `ensure:electron` in CI; prefer Nia clipboard IPC over renderer Electron clipboard |
| **Check** | `desktop-electron-pin.test.ts`; `npm run ensure:electron`; Desktop preview / staging pack |

### CI pack / publish

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` |
| **Files** | `.github/workflows/desktop-staging.yml`, `desktop-production.yml`, `desktop-publish.yml`, `desktop-pack.yml`, `okvevo-nia-remote-guard.yml`; `apps/desktop/scripts/ci-map-pack-env.mjs`, `ci-desktop-version.mjs`, `publish-release-feed.mjs`, `pack-agent-snapshot.mjs` |
| **What** | OkVevo-only desktop Actions; agent snapshot in DMG/EXE |
| **Why** | Team staging + customer publish pipeline |
| **Re-apply** | Do not replace with Nous release workflows |
| **Check** | Green Desktop staging after push (when pack paths change) |

### Bundled LGPL ffmpeg (2026-10-10)

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` + `[agent]` |
| **Files** | `apps/desktop/scripts/fetch-ffmpeg.mjs`, `build-ffmpeg-macos.mjs`, `resources/ffmpeg-licenses/`; `apps/desktop/electron/backend-env.ts` (`bundledFfmpegDir`); `apps/desktop/package.json` extraResources `ffmpeg/`; `.github/workflows/desktop-pack.yml` fetch step + cache; `skills/creative/short-drama-edit/scripts/edit_tool.py` (`_h264_delivery_args`) |
| **What** | Pinned LGPL-only ffmpeg/ffprobe ship in the DMG/EXE (macOS built from checksummed source, Windows BtbN lgpl pinned). No GPL encoders; H.264 = VideoToolbox / Media Foundation at 12 Mbps, libx264 only on dev machines. Backend PATH resolves bundled first, then PATH. |
| **Why** | Drama edit must not depend on a user-installed ffmpeg, and GPL x264 cannot ship in a commercial bundle |
| **Re-apply** | Keep `--disable-gpl` and the fetch-time asserts (no `--enable-gpl`/libx264/libx265, hardware encoder present); keep licenses + `SOURCE-OFFER.txt` in the bundle |
| **Check** | `pytest tests/skills/test_drama_edit_h264.py` (bundled last-frame extraction runs when `resources/ffmpeg/` is populated); `npx vitest run electron/backend-env.test.ts` |

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

### Later — remote install hint (no change in this pass)

The desktop remote-host hint still tells the user to run the public GitHub install script:

`curl -fsSL https://raw.githubusercontent.com/Jaikarans2003/OkVevo-Nia/staging/scripts/install.sh | sh`

(`apps/desktop/src/i18n/en.ts`, and the same URL in the other locale files.)

That fetch is unauthenticated. It stops working when `OkVevo-Nia` goes private. Do not change the hint until the private-repo bootstrap gate is implemented (deploy token, or `install.sh` bundled in the installer) and a fresh install is tested. See `PRE-LIVE-BACKLOG.md`.
