import { beforeEach, describe, expect, it, vi } from 'vitest'

import { brandProviderCatalog, brandProviderSlug } from './provider-branding'

const isByokChromeVisible = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/lib/build-channel', () => ({
  isByokChromeVisible
}))

beforeEach(() => {
  isByokChromeVisible.mockReturnValue(true)
})

describe('brandProviderSlug', () => {
  it('renames openrouter to OkVevo on the public channel', () => {
    isByokChromeVisible.mockReturnValue(false)

    expect(brandProviderSlug('openrouter')).toBe('OkVevo')
    expect(brandProviderSlug('nous')).toBe('nous')
  })

  it('is identity on the internal channel', () => {
    expect(brandProviderSlug('openrouter')).toBe('openrouter')
    expect(brandProviderSlug('nous')).toBe('nous')
  })
})

describe('brandProviderCatalog', () => {
  const openrouter = { models: ['anthropic/claude-opus-4.8'], name: 'OpenRouter', slug: 'openrouter' }
  const opencodeFree = { models: ['kimi'], name: 'OpenCode Free', slug: 'opencode-free' }
  const opencodeZen = { models: ['zen'], name: 'OpenCode Zen', slug: 'opencode-zen' }
  const opencodeGo = { models: ['go'], name: 'OpenCode Go', slug: 'opencode-go' }
  const opencode = { models: ['legacy'], name: 'OpenCode', slug: 'opencode' }
  const nous = { models: ['hermes-4'], name: 'Nous', slug: 'nous' }
  const keylessOther = { keyless: true, models: ['web'], name: 'Exa', slug: 'exa' }

  it('returns the same array on the internal channel', () => {
    const providers = [openrouter, opencodeFree, nous]

    expect(brandProviderCatalog(providers)).toBe(providers)
  })

  it('renames OpenRouter, drops OpenCode slugs, and leaves other rows', () => {
    isByokChromeVisible.mockReturnValue(false)

    const result = brandProviderCatalog([
      openrouter,
      opencodeFree,
      opencodeZen,
      opencodeGo,
      opencode,
      nous,
      keylessOther
    ])

    expect(result.map(row => row.slug)).toEqual(['openrouter', 'nous', 'exa'])
    expect(result[0]?.name).toBe('OkVevo')
    expect(result[1]).toBe(nous)
    expect(result[2]).toBe(keylessOther)
  })

  it('does not drop a keyless non-OpenCode slug', () => {
    isByokChromeVisible.mockReturnValue(false)

    const result = brandProviderCatalog([keylessOther])

    expect(result).toEqual([keylessOther])
    expect(result[0]).toBe(keylessOther)
  })
})
