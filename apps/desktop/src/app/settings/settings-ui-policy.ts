/**
 * Nia desktop settings lockdown — which controls stay visible, and the
 * values forced on every launch so a leftover localStorage/config.yaml
 * cannot keep a hidden pref off-default.
 */

import type { TranslucencyBook, TranslucencyValues } from '@hermes/shared/translucency'

import { setTerminalTakeover } from '@/app/right-sidebar/store'
import { setTerminalFontFamilyFromConfig } from '@/app/right-sidebar/terminal/terminal-font'
import { $layoutEditMode } from '@/components/pane-shell/edit-mode'
import { hasDeclaredDefaultTree, resetLayoutTree } from '@/components/pane-shell/tree/store'
import { DEFAULT_LOCALE, localeConfigValue, normalizeLocale } from '@/i18n/languages'
import { isByokChromeVisible } from '@/lib/build-channel'
import { IS_MAC } from '@/lib/keybinds/combo'
import { isWindowsPlatform } from '@/lib/platform'
import { setBackdrop } from '@/store/backdrop'
import { setComposerPopoutGesturesEnabled } from '@/store/composer-popout'
import { setDisableF12 } from '@/store/disable-f12'
import { setEmbedMode } from '@/store/embed-consent'
import { setIntroSplash } from '@/store/intro-splash'
import { setBinding } from '@/store/keybinds'
import { setFileBrowserOpen } from '@/store/layout'
import { $petInfo, setPetInfo } from '@/store/pet'
import { $petGallery } from '@/store/pet-gallery'
import { setReactionsEnabled } from '@/store/reactions-enabled'
import { setReasoningCollapsedByDefault } from '@/store/reasoning-disclosure'
import { $statusbarVisible } from '@/store/statusbar-prefs'
import { setTipsEnabled } from '@/store/tips'
import { setToursEnabled } from '@/store/tours'
import { $translucencyBook, GLASS_SUPPORTED } from '@/store/translucency'
import { setVibeHeartsEnabled } from '@/store/vibe-hearts-enabled'
import { LOCKED_ZOOM_PERCENT, setZoomPercent } from '@/store/zoom'

import { SECTIONS } from './constants'
import type { SettingsView } from './types'

export { isByokChromeVisible }

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

export const PUBLIC_HIDDEN_CONFIG_SECTION_IDS = new Set(['chat', 'memory', 'model', 'workspace'])

export const PUBLIC_FALLBACK_SETTINGS_VIEW = 'config:appearance' as const

export const PUBLIC_HIDDEN_SETTINGS_VIEWS = new Set<SettingsView>([
  'connections',
  'gateway',
  'keybinds',
  'plugins',
  'providers'
])

/** Tools & Keys env rows hidden on public (filter keys, not the whole tab). */
export const PUBLIC_HIDDEN_TOOL_ENV_KEYS = new Set(['FAL_KEY', 'TAVILY_API_KEY'])

export function isPublicHiddenToolProvider(toolset: string, name: string): boolean {
  if (toolset === 'image_gen' || toolset === 'video_gen') {
    return name === 'FAL.ai' || name === 'FAL' || name === 'Nous Subscription'
  }
  if (toolset === 'web') {
    return name === 'Tavily'
  }
  return false
}

const PUBLIC_VISIBLE_VOICE_KEYS = new Set(['tts.edge.voice', 'voice.max_recording_seconds'])

const PUBLIC_HIDDEN_ADVANCED_KEYS = SECTIONS.find(section => section.id === 'advanced')?.keys ?? []

const PUBLIC_HIDDEN_VOICE_KEYS = (SECTIONS.find(section => section.id === 'voice')?.keys ?? []).filter(
  key => !PUBLIC_VISIBLE_VOICE_KEYS.has(key)
)

const LOCKED_VOICE_SHORTCUT = IS_MAC ? 'ctrl+b' : 'ctrl+space'

export const PUBLIC_HIDDEN_CONFIG_KEYS = new Set([
  'command_allowlist',
  'security.redact_secrets',
  ...PUBLIC_HIDDEN_ADVANCED_KEYS,
  ...PUBLIC_HIDDEN_VOICE_KEYS
])

export const PUBLIC_HIDDEN_APPEARANCE_SETTING_IDS = new Set([
  'appearance.intro',
  'appearance.language',
  'appearance.session-density',
  'appearance.tab-strip'
])

export function isConfigKeyVisible(key: string): boolean {
  if (HIDDEN_CONFIG_KEYS.has(key)) {
    return false
  }

  return isByokChromeVisible() || !PUBLIC_HIDDEN_CONFIG_KEYS.has(key)
}

export function filterVisibleConfigKeys(keys: string[]): string[] {
  return keys.filter(isConfigKeyVisible)
}

export function isConfigSectionVisible(id: string): boolean {
  return isByokChromeVisible() || !PUBLIC_HIDDEN_CONFIG_SECTION_IDS.has(id)
}

export function isAppearanceSettingVisible(id: string): boolean {
  if (HIDDEN_APPEARANCE_SETTING_IDS.has(id)) {
    return false
  }

  return isByokChromeVisible() || !PUBLIC_HIDDEN_APPEARANCE_SETTING_IDS.has(id)
}

export function isSettingsViewVisible(view: SettingsView): boolean {
  if (isByokChromeVisible()) {
    return true
  }

  if (PUBLIC_HIDDEN_SETTINGS_VIEWS.has(view)) {
    return false
  }

  if (view.startsWith('config:')) {
    return isConfigSectionVisible(view.slice('config:'.length))
  }

  return true
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

function persistLockedYamlPrefs(): void {
  void import('@/hermes')
    .then(async ({ getHermesConfigRecord, saveHermesConfig }) => {
      const { getNested, setNested } = await import('./helpers')
      let config = await getHermesConfigRecord()
      let changed = false
      const currentFont = getNested(config, 'terminal.font_family')

      if (typeof currentFont === 'string' && currentFont.trim() !== '') {
        config = setNested(config, 'terminal.font_family', '')
        changed = true
      }

      if (!isByokChromeVisible()) {
        if (normalizeLocale(getNested(config, 'display.language')) !== DEFAULT_LOCALE) {
          config = setNested(config, 'display.language', localeConfigValue(DEFAULT_LOCALE))
          changed = true
        }

        if (getNested(config, 'security.redact_secrets') !== true) {
          config = setNested(config, 'security.redact_secrets', true)
          changed = true
        }

        if (getNested(config, 'tts.provider') !== 'edge') {
          config = setNested(config, 'tts.provider', 'edge')
          changed = true
        }

        if (getNested(config, 'stt.enabled') !== true) {
          config = setNested(config, 'stt.enabled', true)
          changed = true
        }

        if (getNested(config, 'stt.echo_transcripts') !== true) {
          config = setNested(config, 'stt.echo_transcripts', true)
          changed = true
        }

        if (getNested(config, 'voice.record_key') !== LOCKED_VOICE_SHORTCUT) {
          config = setNested(config, 'voice.record_key', LOCKED_VOICE_SHORTCUT)
          changed = true
        }
      }

      const wakePhrase = String(getNested(config, 'wake_word.phrase') ?? '')
        .trim()
        .toLowerCase()

      if (!wakePhrase || wakePhrase === 'hey hermes' || wakePhrase === 'hey nia') {
        if (getNested(config, 'wake_word.provider') !== 'sherpa') {
          config = setNested(config, 'wake_word.provider', 'sherpa')
          changed = true
        }

        if (String(getNested(config, 'wake_word.phrase') ?? '') !== 'ok nia') {
          config = setNested(config, 'wake_word.phrase', 'ok nia')
          changed = true
        }
      }

      if (changed) {
        await saveHermesConfig(config)
      }
    })
    .catch(() => {
      // Gateway not ready — renderer already uses the bundled family / English.
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
  setDisableF12(false)
  setTerminalFontFamilyFromConfig('')
  persistLockedYamlPrefs()

  if (!isByokChromeVisible()) {
    setBinding('composer.voice', [LOCKED_VOICE_SHORTCUT])
    // Public: status bar is product chrome we don't ship — clear leftover
    // localStorage that would otherwise keep it on until the next toggle.
    $statusbarVisible.set(false)
  }

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
