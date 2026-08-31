import { beforeEach, describe, expect, it } from 'vitest'

import { modePref, skinPref } from './context'
import { DEFAULT_SKIN_NAME } from './presets'

describe('per-profile skin', () => {
  beforeEach(() => window.localStorage.clear())

  it('falls back to nia when unassigned', () => {
    expect(skinPref.resolve('default')).toBe(DEFAULT_SKIN_NAME)
    expect(skinPref.resolve('work')).toBe(DEFAULT_SKIN_NAME)
  })

  it('normalizes deleted or unknown preset names to nia', () => {
    skinPref.assign('work', 'ember')
    skinPref.assign('default', 'nope')
    expect(skinPref.resolve('work')).toBe(DEFAULT_SKIN_NAME)
    expect(skinPref.resolve('default')).toBe(DEFAULT_SKIN_NAME)
  })
})

describe('per-profile mode', () => {
  beforeEach(() => window.localStorage.clear())

  it('is always dark — Nia has no light or OS-follow mode', () => {
    expect(modePref.resolve('default')).toBe('dark')
    expect(modePref.resolve('work')).toBe('dark')
  })

  it('normalizes stored light/system prefs to dark', () => {
    modePref.assign('default', 'light')
    modePref.assign('work', 'system')
    expect(modePref.resolve('default')).toBe('dark')
    expect(modePref.resolve('work')).toBe('dark')
  })
})
