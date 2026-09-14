// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(globalThis.navigator, 'platform', { configurable: true, value: 'MacIntel' })
})

const isByokChromeVisibleMock = vi.hoisted(() => vi.fn(() => true))
const getHermesConfigRecord = vi.hoisted(() => vi.fn(async () => ({})))
const saveHermesConfig = vi.hoisted(() => vi.fn(async () => ({ ok: true })))

vi.mock('@/lib/build-channel', () => ({
  isByokChromeVisible: isByokChromeVisibleMock
}))

vi.mock('@/hermes', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hermes')>()

  return {
    ...actual,
    getHermesConfigRecord,
    saveHermesConfig
  }
})

import { $terminalTakeover, setTerminalTakeover } from '@/app/right-sidebar/store'
import { $terminalFontFamily } from '@/app/right-sidebar/terminal/terminal-font'
import { $layoutEditMode } from '@/components/pane-shell/edit-mode'
import { group, split } from '@/components/pane-shell/tree/model'
import { $activePresetId, $layoutTree, declareDefaultTree, markActivePreset } from '@/components/pane-shell/tree/store'
import { IS_MAC } from '@/lib/keybinds/combo'
import { $backdrop } from '@/store/backdrop'
import { $composerPopoutGesturesEnabled } from '@/store/composer-popout'
import { $disableF12, setDisableF12 } from '@/store/disable-f12'
import { $embedMode, setEmbedMode } from '@/store/embed-consent'
import { $introSplash } from '@/store/intro-splash'
import { $keepAwake, setKeepAwake } from '@/store/keep-awake'
import { $bindings, setBinding } from '@/store/keybinds'
import { $fileBrowserOpen, setFileBrowserOpen } from '@/store/layout'
import { $petInfo, setPetInfo } from '@/store/pet'
import { $petGallery } from '@/store/pet-gallery'
import { $reactionsEnabled, setReactionsEnabled } from '@/store/reactions-enabled'
import { $reasoningCollapsedByDefault, setReasoningCollapsedByDefault } from '@/store/reasoning-disclosure'
import { $statusbarVisible, toggleStatusbarVisible } from '@/store/statusbar-prefs'
import { $tipsEnabled, setTipsEnabled } from '@/store/tips'
import { $toursEnabled, setToursEnabled } from '@/store/tours'
import { $translucencyBook, GLASS_SUPPORTED } from '@/store/translucency'
import { $vibeHeartsEnabled, setVibeHeartsEnabled } from '@/store/vibe-hearts-enabled'

import {
  applyLockedDesktopPrefs,
  filterVisibleConfigKeys,
  HIDDEN_APPEARANCE_SETTING_IDS,
  isAppearanceSettingVisible,
  isByokChromeVisible,
  isConfigKeyVisible,
  isConfigSectionVisible,
  isPublicHiddenToolProvider,
  isSettingsViewVisible,
  PUBLIC_FALLBACK_SETTINGS_VIEW,
  PUBLIC_HIDDEN_TOOL_ENV_KEYS
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
  isByokChromeVisibleMock.mockReturnValue(true)
  getHermesConfigRecord.mockReset()
  saveHermesConfig.mockReset()
  getHermesConfigRecord.mockResolvedValue({})
  saveHermesConfig.mockResolvedValue({ ok: true })
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
    expect(isAppearanceSettingVisible('appearance.session-density')).toBe(true)
    expect(isAppearanceSettingVisible('appearance.tab-strip')).toBe(true)
    expect(isAppearanceSettingVisible('appearance.intro')).toBe(true)
    expect(isAppearanceSettingVisible('appearance.tool-view')).toBe(true)
    expect(isAppearanceSettingVisible('appearance.translucency')).toBe(false)
    expect(HIDDEN_APPEARANCE_SETTING_IDS.has('appearance.embeds')).toBe(true)
  })

  it('hides Model, Chat, Workspace, Memory and Appearance only on public', () => {
    isByokChromeVisibleMock.mockReturnValue(false)

    expect(isConfigSectionVisible('model')).toBe(false)
    expect(isConfigSectionVisible('chat')).toBe(false)
    expect(isConfigSectionVisible('workspace')).toBe(false)
    expect(isConfigSectionVisible('memory')).toBe(false)
    expect(isConfigSectionVisible('appearance')).toBe(false)
    expect(isConfigSectionVisible('safety')).toBe(true)
    expect(isConfigSectionVisible('voice')).toBe(true)
    expect(PUBLIC_FALLBACK_SETTINGS_VIEW).toBe('billing')

    expect(isAppearanceSettingVisible('appearance.language')).toBe(false)
    expect(isAppearanceSettingVisible('appearance.session-density')).toBe(false)
    expect(isAppearanceSettingVisible('appearance.tab-strip')).toBe(false)
    expect(isAppearanceSettingVisible('appearance.intro')).toBe(false)
    expect(isAppearanceSettingVisible('appearance.tool-view')).toBe(false)
    expect(isAppearanceSettingVisible('appearance.translucency')).toBe(false)
  })

  it('hides Gateways, Keyboard Shortcuts, Tools & Keys, Command Allowlist, Redact Secrets, and Advanced schema keys only on public', () => {
    isByokChromeVisibleMock.mockReturnValue(false)

    expect(isSettingsViewVisible('gateway')).toBe(false)
    expect(isSettingsViewVisible('connections')).toBe(false)
    expect(isSettingsViewVisible('keybinds')).toBe(false)
    expect(isSettingsViewVisible('keys')).toBe(false)
    expect(isSettingsViewVisible('providers')).toBe(false)
    expect(isSettingsViewVisible('plugins')).toBe(false)
    expect(isSettingsViewVisible('config:memory')).toBe(false)
    expect(isSettingsViewVisible('config:model')).toBe(false)
    expect(isSettingsViewVisible('config:appearance')).toBe(false)
    expect(isSettingsViewVisible('config:voice')).toBe(true)
    expect(isSettingsViewVisible('billing')).toBe(true)
    expect(isSettingsViewVisible('config:safety')).toBe(true)
    expect(isSettingsViewVisible('config:advanced')).toBe(true)

    expect(isConfigKeyVisible('command_allowlist')).toBe(false)
    expect(isConfigKeyVisible('security.redact_secrets')).toBe(false)
    expect(isConfigKeyVisible('toolsets')).toBe(false)
    expect(isConfigKeyVisible('terminal.backend')).toBe(false)
    expect(isConfigKeyVisible('agent.max_turns')).toBe(false)
    expect(isConfigKeyVisible('updates.non_interactive_local_changes')).toBe(false)
    expect(isConfigKeyVisible('approvals.mode')).toBe(true)
    expect(isConfigKeyVisible('approvals.timeout')).toBe(true)
    expect(isConfigKeyVisible('checkpoints.enabled')).toBe(true)

    expect(isConfigKeyVisible('tts.provider')).toBe(false)
    expect(isConfigKeyVisible('stt.enabled')).toBe(false)
    expect(isConfigKeyVisible('voice.record_key')).toBe(false)
    expect(isConfigKeyVisible('voice.client_direct')).toBe(false)
    expect(isConfigKeyVisible('tts.edge.voice')).toBe(true)
    expect(isConfigKeyVisible('voice.max_recording_seconds')).toBe(true)
  })

  it('keeps Gateways, Keyboard Shortcuts, Tools & Keys, Plugins, Appearance, and public-hidden keys visible on the internal channel', () => {
    expect(isSettingsViewVisible('gateway')).toBe(true)
    expect(isSettingsViewVisible('keybinds')).toBe(true)
    expect(isSettingsViewVisible('keys')).toBe(true)
    expect(isSettingsViewVisible('providers')).toBe(true)
    expect(isSettingsViewVisible('plugins')).toBe(true)
    expect(isSettingsViewVisible('config:appearance')).toBe(true)
    expect(isConfigSectionVisible('appearance')).toBe(true)
    expect(isConfigKeyVisible('command_allowlist')).toBe(true)
    expect(isConfigKeyVisible('security.redact_secrets')).toBe(true)
    expect(isConfigKeyVisible('toolsets')).toBe(true)
    expect(isConfigKeyVisible('tts.provider')).toBe(true)
    expect(isConfigKeyVisible('voice.client_direct')).toBe(true)
  })

  it('keeps Model, Chat, Workspace, and Memory visible on the internal channel', () => {
    expect(isConfigSectionVisible('model')).toBe(true)
    expect(isConfigSectionVisible('chat')).toBe(true)
    expect(isConfigSectionVisible('workspace')).toBe(true)
    expect(isConfigSectionVisible('memory')).toBe(true)
  })

  it('shows BYOK chrome only on the internal baked channel', () => {
    expect(isByokChromeVisible()).toBe(__NIA_BUILD_CHANNEL__ === 'internal')
  })

  it('hides FAL/Nous image-video rows and Tavily on public', () => {
    expect(PUBLIC_HIDDEN_TOOL_ENV_KEYS.has('FAL_KEY')).toBe(true)
    expect(PUBLIC_HIDDEN_TOOL_ENV_KEYS.has('TAVILY_API_KEY')).toBe(true)
    expect(isPublicHiddenToolProvider('image_gen', 'FAL.ai')).toBe(true)
    expect(isPublicHiddenToolProvider('image_gen', 'Nous Subscription')).toBe(true)
    expect(isPublicHiddenToolProvider('video_gen', 'FAL')).toBe(true)
    // Public image/video is OkVevo Fal only — every leftover BYOK row hides.
    expect(isPublicHiddenToolProvider('image_gen', 'Nous Portal (image)')).toBe(true)
    expect(isPublicHiddenToolProvider('image_gen', 'OpenRouter (image)')).toBe(true)
    expect(isPublicHiddenToolProvider('image_gen', 'OpenAI')).toBe(true)
    expect(isPublicHiddenToolProvider('image_gen', 'Krea')).toBe(true)
    expect(isPublicHiddenToolProvider('image_gen', 'DeepInfra')).toBe(true)
    expect(isPublicHiddenToolProvider('image_gen', 'xAI Grok Imagine (image)')).toBe(true)
    expect(isPublicHiddenToolProvider('video_gen', 'xAI Grok Imagine')).toBe(true)
    expect(isPublicHiddenToolProvider('video_gen', 'DeepInfra')).toBe(true)
    expect(isPublicHiddenToolProvider('web', 'Tavily')).toBe(true)
    expect(isPublicHiddenToolProvider('web', 'Firecrawl')).toBe(false)
    expect(isPublicHiddenToolProvider('tts', 'ElevenLabs')).toBe(false)
  })

  it('does not read process.env.NIA_BUILD_CHANNEL at runtime', () => {
    const prev = process.env.NIA_BUILD_CHANNEL
    process.env.NIA_BUILD_CHANNEL = 'internal'
    expect(isByokChromeVisible()).toBe(__NIA_BUILD_CHANNEL__ === 'internal')
    process.env.NIA_BUILD_CHANNEL = 'public'
    expect(isByokChromeVisible()).toBe(__NIA_BUILD_CHANNEL__ === 'internal')

    if (prev === undefined) {
      delete process.env.NIA_BUILD_CHANNEL
    } else {
      process.env.NIA_BUILD_CHANNEL = prev
    }
  })
})

const alreadyLockedPublicYaml = {
  tts: { provider: 'edge' },
  stt: { enabled: true, echo_transcripts: true },
  voice: { record_key: IS_MAC ? 'ctrl+b' : 'ctrl+space' },
  wake_word: { provider: 'sherpa', phrase: 'ok nia' }
}

describe('applyLockedDesktopPrefs', () => {
  it('force-applies locked store values over persisted offs', () => {
    setReactionsEnabled(false)
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
    expect($layoutEditMode.get()).toBe(false)
  })

  it('resets a leftover layout tree to the declared default and closes the right rail', () => {
    const lockedDefault = split(
      'row',
      [
        group(['sessions'], { id: 'grp-sessions' }),
        group(['workspace'], { id: 'grp-main' }),
        group(['files'], { id: 'grp-files' })
      ],
      [1, 3, 1],
      'spl-locked-default'
    )

    const leftover = split('row', [group(['workspace'], { id: 'grp-main' })], [1], 'spl-leftover')

    declareDefaultTree(lockedDefault)
    $layoutTree.set(leftover)
    markActivePreset('focus')
    $layoutEditMode.set(true)
    setFileBrowserOpen(true)
    setTerminalTakeover(true)

    applyLockedDesktopPrefs()

    expect($activePresetId.get()).toBe('default')
    expect($layoutTree.get()?.id).toBe('spl-locked-default')
    expect($fileBrowserOpen.get()).toBe(false)
    expect($terminalTakeover.get()).toBe(false)
    expect($layoutEditMode.get()).toBe(false)
  })

  it('does not re-force Keep Computer Awake on boot, so Off stays Off', () => {
    setKeepAwake(false)

    applyLockedDesktopPrefs()

    expect($keepAwake.get()).toBe(false)
  })

  it('persists display.language=en on public when the file is not English', async () => {
    isByokChromeVisibleMock.mockReturnValue(false)
    getHermesConfigRecord.mockResolvedValue({
      display: { language: 'zh' },
      security: { redact_secrets: true },
      terminal: { cwd: '/tmp' },
      ...alreadyLockedPublicYaml
    })

    applyLockedDesktopPrefs()

    await vi.waitFor(() =>
      expect(saveHermesConfig).toHaveBeenCalledWith({
        display: { language: 'en' },
        security: { redact_secrets: true },
        terminal: { cwd: '/tmp' },
        ...alreadyLockedPublicYaml
      })
    )
  })

  it('persists security.redact_secrets=true on public when leftover is false', async () => {
    isByokChromeVisibleMock.mockReturnValue(false)
    getHermesConfigRecord.mockResolvedValue({
      security: { redact_secrets: false },
      ...alreadyLockedPublicYaml
    })

    applyLockedDesktopPrefs()

    await vi.waitFor(() =>
      expect(saveHermesConfig).toHaveBeenCalledWith({
        security: { redact_secrets: true },
        ...alreadyLockedPublicYaml
      })
    )
  })

  it('persists Edge TTS, STT on, echo on, and voice.record_key on public', async () => {
    isByokChromeVisibleMock.mockReturnValue(false)
    getHermesConfigRecord.mockResolvedValue({
      security: { redact_secrets: true },
      tts: { provider: 'elevenlabs' },
      stt: { enabled: false, echo_transcripts: false },
      voice: { record_key: 'alt+v', client_direct: false },
      wake_word: { provider: 'sherpa', phrase: 'ok nia' }
    })

    applyLockedDesktopPrefs()

    await vi.waitFor(() =>
      expect(saveHermesConfig).toHaveBeenCalledWith({
        security: { redact_secrets: true },
        tts: { provider: 'edge' },
        stt: { enabled: true, echo_transcripts: true },
        voice: { record_key: IS_MAC ? 'ctrl+b' : 'ctrl+space', client_direct: false },
        wake_word: { provider: 'sherpa', phrase: 'ok nia' }
      })
    )
  })

  it('does not persist display.language, redact_secrets, or voice locks on the internal channel', async () => {
    getHermesConfigRecord.mockResolvedValue({
      display: { language: 'zh' },
      security: { redact_secrets: false },
      tts: { provider: 'elevenlabs' },
      stt: { enabled: false, echo_transcripts: false },
      voice: { record_key: 'alt+v' },
      wake_word: { provider: 'sherpa', phrase: 'ok nia' }
    })

    applyLockedDesktopPrefs()

    await vi.waitFor(() => expect(getHermesConfigRecord).toHaveBeenCalled())
    expect(saveHermesConfig).not.toHaveBeenCalled()
  })

  it('resets leftover composer.voice rebind on public', () => {
    isByokChromeVisibleMock.mockReturnValue(false)
    setBinding('composer.voice', ['alt+v'])

    applyLockedDesktopPrefs()

    expect($bindings.get()['composer.voice']).toEqual(IS_MAC ? ['ctrl+b'] : ['ctrl+space'])
  })

  it('does not reset leftover composer.voice rebind on internal', () => {
    setBinding('composer.voice', ['alt+v'])

    applyLockedDesktopPrefs()

    expect($bindings.get()['composer.voice']).toEqual(['alt+v'])
  })

  it('forces the status bar off on public even when leftover localStorage had it on', () => {
    isByokChromeVisibleMock.mockReturnValue(false)
    $statusbarVisible.set(true)

    applyLockedDesktopPrefs()

    expect($statusbarVisible.get()).toBe(false)
  })

  it('does not force the status bar off on internal', () => {
    $statusbarVisible.set(true)

    applyLockedDesktopPrefs()

    expect($statusbarVisible.get()).toBe(true)
  })
})

describe('toggleStatusbarVisible channel lock', () => {
  it('no-ops on public so the bar cannot be shown again', () => {
    isByokChromeVisibleMock.mockReturnValue(false)
    $statusbarVisible.set(false)

    toggleStatusbarVisible()

    expect($statusbarVisible.get()).toBe(false)
  })

  it('still flips on internal', () => {
    $statusbarVisible.set(false)

    toggleStatusbarVisible()

    expect($statusbarVisible.get()).toBe(true)
  })
})

describe('leftover wake phrase lock', () => {
  it.each(['hey hermes', 'hey nia', '', '  '])(
    'rewrites leftover phrase %j to sherpa + ok nia on both channels',
    async phrase => {
      getHermesConfigRecord.mockResolvedValue({
        wake_word: { provider: 'openwakeword', phrase }
      })

      applyLockedDesktopPrefs()

      await vi.waitFor(() =>
        expect(saveHermesConfig).toHaveBeenCalledWith({
          wake_word: { provider: 'sherpa', phrase: 'ok nia' }
        })
      )
    }
  )

  it('does not clobber a custom wake phrase', async () => {
    getHermesConfigRecord.mockResolvedValue({
      wake_word: { provider: 'sherpa', phrase: 'ok computer' }
    })

    applyLockedDesktopPrefs()

    await vi.waitFor(() => expect(getHermesConfigRecord).toHaveBeenCalled())
    expect(saveHermesConfig).not.toHaveBeenCalled()
  })
})
