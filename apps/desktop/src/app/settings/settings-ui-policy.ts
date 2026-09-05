/**
 * Nia desktop settings lockdown — which controls stay visible, and the
 * values forced on every launch so a leftover localStorage/config.yaml
 * cannot keep a hidden pref off-default.
 */

import { setTerminalTakeover } from '@/app/right-sidebar/store'
import { setTerminalFontFamilyFromConfig } from '@/app/right-sidebar/terminal/terminal-font'
import { $layoutEditMode } from '@/components/pane-shell/edit-mode'
import { hasDeclaredDefaultTree, resetLayoutTree } from '@/components/pane-shell/tree/store'
import { isWindowsPlatform } from '@/lib/platform'
import { setBackdrop } from '@/store/backdrop'
import { setComposerPopoutGesturesEnabled } from '@/store/composer-popout'
import { setDisableF12 } from '@/store/disable-f12'
import { setEmbedMode } from '@/store/embed-consent'
import { setIntroSplash } from '@/store/intro-splash'
import { setKeepAwake } from '@/store/keep-awake'
import { setFileBrowserOpen } from '@/store/layout'
import { $petInfo, setPetInfo } from '@/store/pet'
import { $petGallery } from '@/store/pet-gallery'
import { setReactionsEnabled } from '@/store/reactions-enabled'
import { setReasoningCollapsedByDefault } from '@/store/reasoning-disclosure'
import { setTipsEnabled } from '@/store/tips'
import { setToursEnabled } from '@/store/tours'
import { $translucencyBook, GLASS_SUPPORTED } from '@/store/translucency'
import { setVibeHeartsEnabled } from '@/store/vibe-hearts-enabled'
import { LOCKED_ZOOM_PERCENT, setZoomPercent } from '@/store/zoom'
import type { TranslucencyBook, TranslucencyValues } from '@hermes/shared/translucency'

export const HIDDEN_CONFIG_KEYS = new Set([
  'desktop.repo_scan_roots',
  'desktop.repo_scan_exclude_paths',
  'terminal.persistent_shell',
  'terminal.env_passthrough',
  'file_read_max_chars',
  'approvals.mcp_reload_confirm',
  'security.allow_private_urls',
  'browser.allow_private_urls',
  'browser.auto_local_for_private_urls'
])

export const HIDDEN_APPEARANCE_SETTING_IDS = new Set([
  'appearance.backdrop',
  'appearance.embeds',
  'appearance.intro-splash',
  'appearance.translucency'
])

export function isConfigKeyVisible(key: string): boolean {
  return !HIDDEN_CONFIG_KEYS.has(key)
}

export function filterVisibleConfigKeys(keys: string[]): string[] {
  return keys.filter(isConfigKeyVisible)
}

export function isAppearanceSettingVisible(id: string): boolean {
  return !HIDDEN_APPEARANCE_SETTING_IDS.has(id)
}

/** Settings → Providers Accounts / API Keys / Custom Endpoints is BYOK chrome. */
export function isProvidersByokChromeVisible(signedIn: boolean): boolean {
  return !signedIn
}

function lockedTranslucencyValues(): TranslucencyValues {
  return {
    intensity: GLASS_SUPPORTED ? 100 : 0,
    fade: 0,
    material: isWindowsPlatform() ? 'titlebar' : 'header',
    scope: 'window'
  }
}

function lockedTranslucencyBook(): TranslucencyBook {
  const values = lockedTranslucencyValues()

  return {
    mode: GLASS_SUPPORTED ? 'glass' : 'clear',
    base: values,
    light: values,
    dark: values
  }
}

function helperWindowSkipsZoom(): boolean {
  if (typeof window === 'undefined') {
    return true
  }

  try {
    const win = new URLSearchParams(window.location.search).get('win')

    return win === 'overlay' || win === 'quick' || win === 'wake'
  } catch {
    return false
  }
}

function persistBlankTerminalFont(): void {
  void import('@/hermes')
    .then(async ({ getHermesConfigRecord, saveHermesConfig }) => {
      const { getNested, setNested } = await import('./helpers')
      const config = await getHermesConfigRecord()
      const current = getNested(config, 'terminal.font_family')

      if (typeof current !== 'string' || current.trim() === '') {
        return
      }

      await saveHermesConfig(setNested(config, 'terminal.font_family', ''))
    })
    .catch(() => {
      // Gateway not ready — renderer already uses the bundled family.
    })
}

export function applyLockedDesktopPrefs(): void {
  $translucencyBook.set(lockedTranslucencyBook())
  setBackdrop(false)
  setIntroSplash(true)
  setComposerPopoutGesturesEnabled(true)
  setReactionsEnabled(true)
  setTipsEnabled(true)
  setToursEnabled(true)
  setVibeHeartsEnabled(true)
  setReasoningCollapsedByDefault(true)
  setEmbedMode('always')
  setKeepAwake(true)
  setDisableF12(false)
  setTerminalFontFamilyFromConfig('')
  persistBlankTerminalFont()

  const gallery = $petGallery.get()

  if (gallery?.enabled) {
    $petGallery.set({ ...gallery, enabled: false })
  }

  if ($petInfo.get().enabled) {
    setPetInfo({ enabled: false })
  }

  if (!helperWindowSkipsZoom()) {
    setZoomPercent(LOCKED_ZOOM_PERCENT)
  }

  $layoutEditMode.set(false)

  if (hasDeclaredDefaultTree()) {
    resetLayoutTree()
    setFileBrowserOpen(false)
    setTerminalTakeover(false)
  }
}
