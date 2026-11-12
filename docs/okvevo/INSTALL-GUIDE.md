# OkVevo install guide (focus-group beta)

Download only from **[www.okvevo.com/okvevo-download](https://www.okvevo.com/okvevo-download)** (or the testing portal’s matching page). Do not use old `Nia-*` bookmarks once Cloudflare redirects are live.

Support: **help@okvevo.com**

## Mac (unsigned beta)

1. Download `OkVevo-mac-arm64.dmg`.
2. Open the DMG and drag OkVevo to Applications.
3. If Gatekeeper blocks: right-click OkVevo → **Open** → **Open** again (or System Settings → Privacy & Security → Open Anyway).
4. Sign in with your OkVevo account.

**Updates while unsigned:** in-app update will **not** complete on an unsigned Mac build. Download a fresh DMG from `/okvevo-download` when a new version ships.

## Windows (unsigned beta)

1. Download `OkVevo-win-x64.exe`.
2. Run the installer. SmartScreen may warn on unsigned builds — choose **More info** → **Run anyway** when you trust the OkVevo download page.
3. Sign in with your OkVevo account.

**Updates while unsigned:** SmartScreen / signature errors can break in-app update. Prefer re-downloading the EXE from `/okvevo-download`.

## Existing Nia installs

Ignore them. There is no in-app migration. Always fresh-install OkVevo from `/okvevo-download`.

## Rollback = fix-forward

`allowDowngrade: false` — the app will not auto-install an older same-channel build.

If v0.1.0 has a blocking bug, ship **v0.1.1** through the same pipeline within hours:

1. Fix on a feature/fix branch → PR → `staging` (after yes).
2. Team tests the staging installers.
3. PR `staging` → `main` (after yes).
4. Annotated tag `v0.1.1` on `okvevo/main` tip → push tag (after yes).
5. Wait for **OkVevo desktop production** archive.
6. Actions → **Publish release** with version `0.1.1` (Karan).
7. Testers re-download from `/okvevo-download` (or use in-app update once signed builds exist).

Operator detail: `docs/okvevo/CI-CD.md`.
