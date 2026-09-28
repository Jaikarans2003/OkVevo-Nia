# Fork deltas — UI lockdowns

---

### Local-only v1

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` |
| **Files** | `apps/desktop/src/lib/product.ts` (`LOCAL_ONLY_V1 = true`); `gateway-settings.tsx`; `desktop-install-overlay.tsx`; `boot-failure-overlay.tsx` |
| **What** | Hide cloud / remote / SSH first-run and settings paths |
| **Why** | v1 product is local desktop only |
| **Re-apply** | Keep constant true + gating; do not re-enable Hermes Cloud cards |
| **Check** | Gateway settings / install overlay tests |

### Locked prefs (theme, zoom, chrome)

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` |
| **Files** | `apps/desktop/src/app/settings/settings-ui-policy.ts` (`applyLockedDesktopPrefs`), `nia-locked-prefs.ts`, `apps/desktop/electron/zoom.ts`, `src/store/zoom.ts` (`LOCKED_ZOOM_PERCENT = 110`), Ubuntu fonts / charcoal-orange tokens |
| **What** | Force zoom 110%, fixed appearance, hide BYOK sections on public, default settings view billing |
| **Why** | Visual lock; prevent stale Hermes prefs |
| **Re-apply** | Call `applyLockedDesktopPrefs` on launch; keep zoom SoT in both electron + store |
| **Check** | `settings-ui-policy.test.ts`; zoom tests |

### Windows boot timeout

| Field | Value |
|-------|-------|
| **Tags** | `[desktop]` |
| **Files** | Gateway boot hooks (`use-gateway-boot` / related) — suspend boot timeout during first-run bootstrap |
| **What** | Avoid false boot failure while bootstrap runs |
| **Why** | Windows race |
| **Re-apply** | Keep suspendable timeout |
| **Check** | Windows packaged launch smoke |
