import { describe, expect, it } from 'vitest'

import { genericProductPhrasing, listedProductPhrasing } from './product-phrasing'

describe('listedProductPhrasing', () => {
  it('is deterministic for the same toolCallId (no flicker across re-renders)', () => {
    const first = listedProductPhrasing('web_search', 'call-123', 'okra recipes')
    const second = listedProductPhrasing('web_search', 'call-123', 'okra recipes')

    expect(first).toBe(second)
  })

  it('interpolates the search query into the web_search deck', () => {
    const title = listedProductPhrasing('web_search', 'call-123', 'okra recipes')

    expect(title).toContain('okra recipes')
    expect(title).toMatch(/hunt|dig/i)
  })

  it('interpolates the file basename for read_file and file-edit tools', () => {
    expect(listedProductPhrasing('read_file', 'call-1', 'config.ts')).toContain('config.ts')
    expect(listedProductPhrasing('write_file', 'call-1', 'config.ts')).toContain('config.ts')
    expect(listedProductPhrasing('patch', 'call-1', 'config.ts')).toContain('config.ts')
    expect(listedProductPhrasing('edit_file', 'call-1', 'config.ts')).toContain('config.ts')
  })

  it('returns null when a {file}/{query} phrase has no detail to show', () => {
    expect(listedProductPhrasing('read_file', 'call-1', '')).toBeNull()
    expect(listedProductPhrasing('web_search', 'call-1', '   ')).toBeNull()
  })

  it('returns set phrases without interpolation for media/vision tools', () => {
    expect(listedProductPhrasing('image_generate', 'call-1', '')).toBeTruthy()
    expect(listedProductPhrasing('video_generate', 'call-1', '')).toBeTruthy()
    expect(listedProductPhrasing('vision_analyze', 'call-1', '')).toBeTruthy()
  })

  it('returns null for tools without their own set', () => {
    expect(listedProductPhrasing('terminal', 'call-1', '')).toBeNull()
    expect(listedProductPhrasing('memory', 'call-1', '')).toBeNull()
  })
})

describe('genericProductPhrasing', () => {
  it('is deterministic and comes from the fallback deck', () => {
    const deck = ['Working on it…', 'Doing the thing…', 'On it…']
    const first = genericProductPhrasing('call-xyz')

    expect(first).toBe(genericProductPhrasing('call-xyz'))
    expect(deck).toContain(first)
  })
})
