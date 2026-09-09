import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Settings2, Wrench } from '@/lib/icons'
import type { ConfigFieldSchema, HermesConfigRecord } from '@/types/hermes'

import {
  APPEARANCE_SETTING_IDS,
  buildConfigSearchEntries,
  buildCredentialSearchEntries,
  credentialSettingsView,
  filterSettingsSearchEntries
} from './settings-search'
import { isAppearanceSettingVisible } from './settings-ui-policy'
import { envVar } from './test-utils'

const isByokChromeVisible = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/lib/build-channel', () => ({
  isByokChromeVisible
}))

const searchCopy = {
  fieldDescriptions: {
    'display.personality': 'Choose how Hermes sounds in conversation.',
    'tts.edge.voice': 'Voice used by Edge TTS.'
  },
  fieldLabels: {
    'display.personality': 'Personality',
    'tts.edge.voice': 'Edge voice',
    'tts.openai.voice': 'OpenAI voice'
  },
  sections: {
    chat: 'Chat',
    voice: 'Voice'
  }
}

describe('settings search index', () => {
  beforeEach(() => {
    isByokChromeVisible.mockReturnValue(true)
  })

  it('builds config results from renderable schema fields with exact deep links', () => {
    const schema: Record<string, ConfigFieldSchema> = {
      'display.personality': { type: 'select' },
      'tts.edge.voice': { type: 'string' },
      'tts.openai.voice': { type: 'string' }
    }

    const config = {
      display: { personality: 'default' },
      tts: { provider: 'edge', edge: { voice: '' }, openai: { voice: '' } }
    } as unknown as HermesConfigRecord

    const entries = buildConfigSearchEntries(schema, config, searchCopy)

    expect(entries.map(entry => entry.id)).toEqual([
      'config-field:display.personality',
      'config-field:tts.provider',
      'config-field:tts.edge.voice'
    ])
    expect(entries[0]).toMatchObject({
      context: 'Chat',
      description: 'Choose how Hermes sounds in conversation.',
      label: 'Personality',
      target: { field: 'display.personality', view: 'config:chat' }
    })
    expect(entries.some(entry => entry.id === 'config-field:tts.openai.voice')).toBe(false)
  })

  it('omits Nia-hidden config keys from the search index', () => {
    const schema: Record<string, ConfigFieldSchema> = {
      'terminal.cwd': { type: 'string' },
      'desktop.repo_scan_roots': { type: 'array' },
      'browser.allow_private_urls': { type: 'boolean' }
    }

    const config = {
      terminal: { cwd: '/tmp' },
      desktop: { repo_scan_roots: [] },
      browser: { allow_private_urls: false }
    } as unknown as HermesConfigRecord

    const entries = buildConfigSearchEntries(schema, config, {
      ...searchCopy,
      sections: { ...searchCopy.sections, workspace: 'Workspace', browser: 'Browser' }
    })

    expect(entries.map(entry => entry.id)).toEqual(['config-field:terminal.cwd'])
  })

  it('discovers future tool and setting entries entirely from backend metadata', () => {
    const vars = {
      FUTURE_CRAWLER_API_KEY: envVar('tool', {
        description: 'Fetch structured pages from a new crawler.',
        tools: ['future_crawl'],
        url: 'https://future.example/keys'
      }),
      FUTURE_GATEWAY_URL: envVar('setting', { description: 'Route gateway traffic.' }),
      TELEGRAM_BOT_TOKEN: envVar('messaging', { channel_managed: true }),
      MODEL_PROVIDER_API_KEY: envVar('provider')
    }

    const entries = buildCredentialSearchEntries(
      vars,
      { settings: 'Settings', tools: 'Tools' },
      { settings: Settings2, tools: Wrench }
    )

    expect(entries.map(entry => entry.id)).toEqual([
      'credential:FUTURE_CRAWLER_API_KEY',
      'credential:FUTURE_GATEWAY_URL'
    ])
    expect(entries[0]).toMatchObject({
      context: 'Tools',
      label: 'FUTURE CRAWLER',
      target: { key: 'FUTURE_CRAWLER_API_KEY', keysView: 'tools', view: 'keys' }
    })
    expect(filterSettingsSearchEntries(entries, 'structured crawler')).toHaveLength(1)
    expect(filterSettingsSearchEntries(entries, 'future_crawl')[0]?.id).toBe('credential:FUTURE_CRAWLER_API_KEY')
    expect(filterSettingsSearchEntries(entries, 'gateway traffic')[0]?.id).toBe('credential:FUTURE_GATEWAY_URL')
  })

  it('shares the Tools and Settings category boundary with the rendered page', () => {
    expect(credentialSettingsView(envVar('tool'))).toBe('tools')
    expect(credentialSettingsView(envVar('setting'))).toBe('settings')
    expect(credentialSettingsView(envVar('messaging'))).toBe('settings')
    expect(credentialSettingsView(envVar('messaging', { channel_managed: true }))).toBeNull()
    expect(credentialSettingsView(envVar('provider'))).toBeNull()
  })

  it('uses AND matching across labels, context, descriptions, and raw keys', () => {
    const entries = buildCredentialSearchEntries(
      {
        BRAVE_SEARCH_API_KEY: envVar('tool', { description: 'Search public web pages.' }),
        FIRECRAWL_API_KEY: envVar('tool', { description: 'Extract public web pages.' })
      },
      { settings: 'Settings', tools: 'Tools' },
      { settings: Settings2, tools: Wrench }
    )

    expect(filterSettingsSearchEntries(entries, 'brave tools')[0]?.id).toBe('credential:BRAVE_SEARCH_API_KEY')
    expect(filterSettingsSearchEntries(entries, 'firecrawl extract')[0]?.id).toBe('credential:FIRECRAWL_API_KEY')
    expect(filterSettingsSearchEntries(entries, 'brave extract')).toEqual([])
  })

  it('drops Model, Chat, and Workspace fields from the public search catalog', () => {
    isByokChromeVisible.mockReturnValue(false)

    const schema: Record<string, ConfigFieldSchema> = {
      'display.personality': { type: 'select' },
      'terminal.cwd': { type: 'string' },
      'approvals.mode': { type: 'select' }
    }

    const config = {
      display: { personality: 'default' },
      terminal: { cwd: '/tmp' },
      approvals: { mode: 'manual' }
    } as unknown as HermesConfigRecord

    const entries = buildConfigSearchEntries(schema, config, {
      ...searchCopy,
      sections: { ...searchCopy.sections, workspace: 'Workspace', safety: 'Safety' }
    })

    expect(entries.map(entry => entry.id)).toEqual(['config-field:approvals.mode'])
  })

  it('keeps Approval Mode and drops Command Allowlist and Enabled Toolsets on public', () => {
    isByokChromeVisible.mockReturnValue(false)

    const schema: Record<string, ConfigFieldSchema> = {
      'approvals.mode': { type: 'select' },
      command_allowlist: { type: 'list' },
      'security.redact_secrets': { type: 'boolean' },
      toolsets: { type: 'list' }
    }

    const config = {
      approvals: { mode: 'smart' },
      command_allowlist: [],
      security: { redact_secrets: true },
      toolsets: ['hermes-cli']
    } as unknown as HermesConfigRecord

    const entries = buildConfigSearchEntries(schema, config, {
      ...searchCopy,
      sections: { ...searchCopy.sections, safety: 'Safety', advanced: 'Advanced' }
    })

    expect(entries.map(entry => entry.label)).toEqual(['Approval Mode'])
    expect(entries.some(entry => entry.label === 'Command Allowlist')).toBe(false)
    expect(entries.some(entry => entry.label === 'Enabled Toolsets')).toBe(false)
  })

  it('keeps Voices and Max Recording Length and drops TTS Provider and Memory fields on public', () => {
    isByokChromeVisible.mockReturnValue(false)

    const schema: Record<string, ConfigFieldSchema> = {
      'tts.provider': { type: 'select' },
      'tts.edge.voice': { type: 'string' },
      'voice.max_recording_seconds': { type: 'number' },
      'memory.memory_enabled': { type: 'boolean' }
    }

    const config = {
      tts: { provider: 'edge', edge: { voice: 'en-US-AriaNeural' } },
      voice: { max_recording_seconds: 120 },
      memory: { memory_enabled: true }
    } as unknown as HermesConfigRecord

    const entries = buildConfigSearchEntries(schema, config, {
      ...searchCopy,
      fieldLabels: {
        ...searchCopy.fieldLabels,
        'tts.edge.voice': 'Voices',
        'tts.provider': 'Text-To-Speech Provider',
        'voice.max_recording_seconds': 'Max Recording Length',
        'memory.memory_enabled': 'Persistent Memory'
      },
      sections: { ...searchCopy.sections, memory: 'Memory & Context' }
    })

    expect(entries.map(entry => entry.label)).toEqual(['Voices', 'Max Recording Length'])
    expect(entries.some(entry => entry.label === 'Text-To-Speech Provider')).toBe(false)
  })

  it('hides Tool Call Display (technical mode is internal-only) and Language on public', () => {
    isByokChromeVisible.mockReturnValue(false)

    expect(isAppearanceSettingVisible(APPEARANCE_SETTING_IDS.toolView)).toBe(false)
    expect(isAppearanceSettingVisible(APPEARANCE_SETTING_IDS.language)).toBe(false)
  })
})
