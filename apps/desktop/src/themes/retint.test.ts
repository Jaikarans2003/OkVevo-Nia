import { describe, expect, it } from 'vitest'

import { contrastRatio, hexToOklch, withHue } from './color'
import { niaTheme } from './presets'
import { retintTheme, themeHue } from './retint'
import type { DesktopThemeColors } from './types'

const HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]

const seedAt = (hue: number) => withHue(niaTheme.colors.primary, hue)

const NOUS_BLUE = '#0053FD'

describe('themeHue', () => {
  it('reads the shipped Nia orange', () => {
    expect(themeHue(niaTheme)).toBe(Math.round(hexToOklch(niaTheme.colors.primary)!.h))
    expect(Math.round(hexToOklch(niaTheme.darkColors!.primary)!.h)).toBe(themeHue(niaTheme))
  })
})

describe('the shipped nia accents', () => {
  it('seeds every accent slot from the orange', () => {
    for (const key of ['primary', 'ring', 'midground', 'composerRing'] as const) {
      expect(niaTheme.colors[key]).toBe('#ff6d1f')
      expect(niaTheme.darkColors![key]).toBe('#ff6d1f')
    }
  })

  it('clears AA on the sidebar', () => {
    expect(contrastRatio('#ff6d1f', niaTheme.colors.sidebarBackground!)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps text on the accent readable', () => {
    expect(contrastRatio('#ff6d1f', niaTheme.colors.primaryForeground)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('retintTheme', () => {
  it('leaves chrome alone when retinted at the theme’s own accent', () => {
    const same = retintTheme(niaTheme, niaTheme.colors.primary)

    for (const key of ['background', 'foreground', 'card', 'border', 'muted', 'mutedForeground'] as const) {
      expect(same.colors[key], key).toBe(niaTheme.colors[key])
      expect(same.darkColors![key], `dark ${key}`).toBe(niaTheme.darkColors![key])
    }
  })

  it('moves every accent-family slot', () => {
    const rose = retintTheme(niaTheme, seedAt(350))

    for (const mode of ['colors', 'darkColors'] as const) {
      const before = niaTheme[mode]!
      const after = rose[mode]!

      for (const key of [
        'primary',
        'ring',
        'midground',
        'composerRing',
        'accent',
        'secondary',
        'userBubble'
      ] as const) {
        expect(after[key], `${mode}.${key}`).not.toBe(before[key])
      }
    }
  })

  it('keeps the four seed slots locked together', () => {
    const teal = retintTheme(niaTheme, seedAt(195)).colors

    expect(teal.ring).toBe(teal.primary)
    expect(teal.midground).toBe(teal.primary)
    expect(teal.composerRing).toBe(teal.primary)
  })

  it('leaves the chrome alone after a hue move', () => {
    const violet = retintTheme(niaTheme, seedAt(285))

    for (const key of ['background', 'foreground', 'card', 'border', 'muted', 'mutedForeground'] as const) {
      expect(violet.colors[key], key).toBe(niaTheme.colors[key])
      expect(violet.darkColors![key], `dark ${key}`).toBe(niaTheme.darkColors![key])
    }
  })

  it('holds perceived lightness and chroma while only the hue moves', () => {
    const base = hexToOklch(niaTheme.colors.primary)!

    for (const hue of HUES) {
      const seed = hexToOklch(retintTheme(niaTheme, seedAt(hue)).colors.primary)!

      expect(Math.abs(seed.l - base.l), `L at ${hue}`).toBeLessThan(0.02)
      expect(seed.c, `C at ${hue}`).toBeLessThanOrEqual(base.c + 0.005)
    }
  })

  it('keeps the accent readable on the sidebar at every hue', () => {
    for (const hue of HUES) {
      const t = retintTheme(niaTheme, seedAt(hue))

      for (const mode of ['colors', 'darkColors'] as const) {
        const c = t[mode] as DesktopThemeColors
        const ratio = contrastRatio(c.primary, c.sidebarBackground ?? c.background)

        expect(ratio, `${mode} @ ${hue}°`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('re-picks the foreground that sits on the accent', () => {
    for (const hue of HUES) {
      const c = retintTheme(niaTheme, seedAt(hue)).colors

      expect(contrastRatio(c.primary, c.primaryForeground), `on-accent @ ${hue}°`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('accepts any hex form and ignores junk', () => {
    expect(retintTheme(niaTheme, '#FF6D1F').colors.primary).toBe(retintTheme(niaTheme, 'ff6d1f').colors.primary)
    expect(retintTheme(niaTheme, '#00').colors).toEqual(niaTheme.colors)
    expect(retintTheme(niaTheme, 'nonsense').colors).toEqual(niaTheme.colors)
  })

  describe('a seed that only works in one mode', () => {
    const blue = retintTheme(niaTheme, NOUS_BLUE)

    it('adapts lightness so the accent stays readable on charcoal', () => {
      expect(contrastRatio(blue.colors.primary, blue.colors.sidebarBackground!)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(blue.darkColors!.primary, blue.darkColors!.sidebarBackground!)).toBeGreaterThanOrEqual(4.5)
    })

    it('adapts by lightness, holding the hue', () => {
      const picked = hexToOklch(NOUS_BLUE)!
      const adapted = hexToOklch(blue.colors.primary)!

      expect(Math.abs(adapted.h - picked.h)).toBeLessThan(3)
    })
  })

  it('does not brand a slot that never tracked the accent', () => {
    const neutralRing = {
      ...niaTheme,
      colors: { ...niaTheme.colors, ring: '#9a9a9a' },
      darkColors: undefined
    }

    expect(retintTheme(neutralRing, '#8250df').colors.ring).toBe('#9a9a9a')
  })

  describe('a theme whose accent slots are shades of each other', () => {
    const shaded = {
      ...niaTheme,
      colors: { ...niaTheme.colors, primary: '#ddd6ff', ring: '#8b80e8', midground: '#8b80e8' },
      darkColors: undefined
    }

    it('moves every slot in the family', () => {
      const teal = retintTheme(shaded, '#0f9b8e')

      expect(teal.colors.ring).not.toBe('#8b80e8')
      expect(Math.abs(hexToOklch(teal.colors.ring)!.h - hexToOklch('#0f9b8e')!.h)).toBeLessThan(3)
    })
  })
})
