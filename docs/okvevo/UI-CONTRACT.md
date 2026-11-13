# OkVevo UI contract

Inventory of OkVevo-specific UI. Every upstream sync and every OkVevo UI change
must keep these rows green. Visual baselines are per-OS (`-darwin` / `-win32`)
and live in git; update only with an explicit `--update-snapshots` commit.

## Design tokens (one SoT — do not duplicate)

| Token class | Owner |
|-------------|--------|
| Colors, theme CSS variables | `apps/desktop/src/themes/presets.ts` (+ shared palettes) |
| Brand palette orange | `brand/nia.json` `palette.orange` = `#ff6f20` — desktop presets must match (no second orange) |
| Product / agent names | `okvevo/config/identity.json` |
| Logo / icon paths | `brand/` asset overlay (`brand/assets/…`, `brand/nia.json`) |
| User-facing copy overrides | `brand/locales/desktop/okvevo-overrides.ts` (merged in `apps/desktop/src/i18n/catalog.ts`) |
| Radii / composer chrome | CSS vars (e.g. `--composer-corner-radius`); locked prefs in `settings-ui-policy.ts` |

Prefer upstream components reading CSS variables / brand helpers so new screens
inherit OkVevo styling. Do not invent a second token tree.

## Overrides, not edits

| Kind | Path |
|------|------|
| Text | `brand/locales/desktop/okvevo-overrides.ts` |
| Images | `brand/` asset overlay |
| Visibility | `apps/desktop/src/app/settings/settings-ui-policy.ts` |

Editing an upstream component is last resort — list it in `docs/okvevo/PATCHES.md`
with a reason (KEEP-PATCH cap still applies).

## Element inventory

| Element | Where implemented | Test |
|---------|-------------------|------|
| Splash / intro | `apps/desktop/src/components/chat/intro.tsx` | `intro.test.tsx`; visual: chat / boot |
| Composer disclaimer | `apps/desktop/src/app/chat/composer/composer-disclaimer.tsx` (below dock) | `composer-disclaimer.test.tsx`; TESTING.md step 21 |
| About | `apps/desktop/electron/okvevo-about.ts`; pack stamps `HERMES_PAYLOAD_VERSION` so `PLACEHOLDER_VERSIONS` (0.0.0) stay hidden | `electron/okvevo-about.test.ts`, `app-version.test.ts`; TESTING.md step 1; pack: `ci-assert-packaged-icons.mjs` install-stamp check |
| Model menu | `apps/desktop/src/app/shell/model-catalog-menu.tsx` | `model-catalog-menu.test.tsx`; TESTING.md step 17 |
| Bots labels / `@okvevo` | `hermes-bots/okvevo-mention-alias.ts` + `plugin.tsx` always claims `@okvevo` (+ twins); merge drops gateway `@hermes`/`@default` | packed `e2e/okvevo/packed-mention-menu.spec.ts` (Mac+Win); `plugin.mentions.test.ts`, `use-at-completions-contrib.test.tsx`, `group-rounds.primary-alias.test.ts`, `data.identity.test.ts`; TESTING.md step 22 |
| Billing / credits | portal + desktop billing UI | billing listener / portal tests; TESTING.md step 2 |
| Sign-in | onboarding / packed sign-in | `e2e/okvevo/packed-signin-chat.spec.ts`; TESTING.md step 2 |
| Hidden settings | `settings-ui-policy.ts` | `settings-ui-policy.test.ts`; TESTING.md step 3 |
| Icons / BrandMark | Hooks: `before-build` → `overlayBrandAssets`; `after-pack` `restoreLegacyMacIcon` + `set-exe-identity` via `okvevo-brand-paths.mjs`; `electron-builder` mac/dmg/win/nsis → `brand/assets/…`; `brand-mark.tsx` imports brand `okvevo.png`; bootstrap DMG volume → `brand/.../packaging/dmg-volume.icns` | `asset_spec.py --check`; `overlay-brand-assets.test.mjs`; `after-pack.test.mjs`; `ci-assert-packaged-icons.mjs` after Mac+Windows pack |
| DMG Finder window | `dmg-layout.json` → `okvevo-dmg-layout.mjs` → electron-builder `dmg`; watercolor 1x+2x under `brand/.../packaging/` | `ci-assert-dmg-layout.mjs`; TESTING.md DMG light+dark mount |
| Brand orange | `brand/nia.json` `palette.orange` = `#ff6f20`; desktop presets match | `presets.test.ts` ↔ brand palette assert |

Cross-links: `DESKTOP-PARITY.md`, `TESTING.md`, `SYNC.md`.

## Visual regression (6 public screens)

Hard Playwright `toHaveScreenshot` (per-OS suffix). Mask timestamps, credit
balances, avatars, version strings; animations off; `maxDiffPixelRatio` ≤ 0.01.

Screens: **chat**, **bots**, **model menu**, **settings**, **About**, **sign-in**.

Public sign-in is the unsigned empty intro (`Hi, I'm OkVevo`) — Hermes provider
onboarding is hidden when BYOK chrome is off. Packed portal OAuth is covered by
`e2e/okvevo/packed-signin-chat.spec.ts`.

Spec: `apps/desktop/e2e/okvevo-ui-contract.spec.ts` (+ existing boot/chat/onboarding
snapshots). Baselines committed under `e2e/okvevo-ui-contract.spec.ts-snapshots/`
(`-darwin` / `-win32`).

## On every upstream sync

1. Re-apply everything in this file.
2. List every new or changed upstream screen with screenshots.
3. Brand each new screen via tokens + overrides (OkVevo names, colors, icons; no Hermes/Nous user-facing text) before merging.
4. Visual tests green, or diffs explicitly approved before baseline update.

## On every OkVevo UI change (not only syncs)

1. Use the design tokens (no hard-coded colors/fonts).
2. Live in OkVevo-owned files or overrides; any upstream file edit listed in `PATCHES.md` with a reason.
3. Add or update its row in this file.
4. Update screenshot baselines in the same PR (diff shown for approval).
