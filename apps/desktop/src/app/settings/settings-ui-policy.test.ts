// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(globalThis.navigator, 'platform', { configurable: true, value: 'MacIntel' })
})

import { $terminalFontFamily } from '@/app/right-sidebar/terminal/terminal-font'
import { $backdrop } from '@/store/backdrop'
import { $composerPopoutGesturesEnabled } from '@/store/composer-popout'
import { $disableF12, setDisableF12 } from '@/store/disable-f12'
import { $embedMode, setEmbedMode } from '@/store/embed-consent'
import { $introSplash } from '@/store/intro-splash'
import { $keepAwake, setKeepAwake } from '@/store/keep-awake'
import { $petInfo, setPetInfo } from '@/store/pet'
import { $petGallery } from '@/store/pet-gallery'
import { $reactionsEnabled, setReactionsEnabled } from '@/store/reactions-enabled'
import { $reasoningCollapsedByDefault, setReasoningCollapsedByDefault } from '@/store/reasoning-disclosure'
import { $tipsEnabled, setTipsEnabled } from '@/store/tips'
import { $toursEnabled, setToursEnabled } from '@/store/tours'
import { $translucencyBook, GLASS_SUPPORTED } from '@/store/translucency'
import { $vibeHeartsEnabled, setVibeHeartsEnabled } from '@/store/vibe-hearts-enabled'

import {
  applyLockedDesktopPrefs,
  filterVisibleConfigKeys,
  HIDDEN_APPEARANCE_SETTING_IDS,
  isAppearanceSettingVisible,
  isConfigKeyVisible
} from './settings-ui-policy'

const setPercent = vi.fn()

beforeEach(() => {
  window.hermesDesktop = {
    ...window.hermesDesktop,
    glassSupported: true,
    zoom: { setPercent, get: async () => ({ percent: 110, level: 0.5 }), onChanged: () => () => {} },
    setKeepAwake: vi.fn(),
    setDisableF12: vi.fn()
  } as unknown as Window['hermesDesktop']
  setPercent.mockClear()
})

describe('settings UI policy filters', () => {
  it('hides power-user config keys and keeps user-facing ones', () => {
    expect(filterVisibleConfigKeys(['terminal.cwd', 'desktop.repo_scan_roots', 'approvals.mode'])).toEqual([
      'terminal.cwd',
      'approvals.mode'
    ])
    expect(isConfigKeyVisible('browser.allow_private_urls')).toBe(false)
    expect(isConfigKeyVisible('display.personality')).toBe(true)
  })

  it('hides locked appearance deep-link ids', () => {
    expect(isAppearanceSettingVisible('appearance.language')).toBe(true)
    expect(isAppearanceSettingVisible('appearance.translucency')).toBe(false)
    expect(HIDDEN_APPEARANCE_SETTING_IDS.has('appearance.embeds')).toBe(true)
  })
})

describe('applyLockedDesktopPrefs', () => {
  it('force-applies locked store values over persisted offs', () => {
    setReactionsEnabled(false)
    setKeepAwake(false)
    setReasoningCollapsedByDefault(false)
    setEmbedMode('ask')
    setTipsEnabled(false)
    setToursEnabled(false)
    setVibeHeartsEnabled(false)
    setDisableF12(true)
    setPetInfo({ enabled: true })
    $petGallery.set({ enabled: true, active: 'nia', pets: [] })
    $translucencyBook.set({ mode: 'clear', base: { intensity: 0 }, light: {}, dark: {} })

    applyLockedDesktopPrefs()

    expect($reactionsEnabled.get()).toBe(true)
    expect($keepAwake.get()).toBe(true)
    expect($reasoningCollapsedByDefault.get()).toBe(true)
    expect($embedMode.get()).toBe('always')
    expect($tipsEnabled.get()).toBe(true)
    expect($toursEnabled.get()).toBe(true)
    expect($vibeHeartsEnabled.get()).toBe(true)
    expect($disableF12.get()).toBe(false)
    expect($backdrop.get()).toBe(false)
    expect($introSplash.get()).toBe(true)
    expect($composerPopoutGesturesEnabled.get()).toBe(true)
    expect($terminalFontFamily.get()).toBe('')
    expect($petInfo.get().enabled).toBe(false)
    expect($petGallery.get()?.enabled).toBe(false)
    expect($translucencyBook.get().mode).toBe(GLASS_SUPPORTED ? 'glass' : 'clear')
    expect($translucencyBook.get().base.intensity).toBe(GLASS_SUPPORTED ? 100 : 0)
    expect($translucencyBook.get().base.scope).toBe('window')
    expect(setPercent).toHaveBeenCalledWith(110)
  })
})
