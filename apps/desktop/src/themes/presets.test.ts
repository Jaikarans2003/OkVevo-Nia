import { describe, expect, it } from 'vitest'

import { BUILTIN_THEME_LIST, BUILTIN_THEMES, DEFAULT_SKIN_NAME, DEFAULT_TYPOGRAPHY, nousTheme, okvevoTheme } from './presets'

// #40364: none of the UI text/mono fonts carry emoji glyphs, so every font
// stack must end with a color-emoji fallback or emoji render as tofu on
// platforms whose default font lacks them (e.g. Linux).
describe('theme typography emoji fallback (#40364)', () => {
  const stacks: Array<[string, string]> = [
    ['DEFAULT_TYPOGRAPHY.fontSans', DEFAULT_TYPOGRAPHY.fontSans],
    ['DEFAULT_TYPOGRAPHY.fontMono', DEFAULT_TYPOGRAPHY.fontMono],
    // A theme may override only fontMono (fontSans then falls back to the
    // default, which already carries the emoji stack), so skip undefined.
    ...BUILTIN_THEME_LIST.flatMap(theme =>
      (
        [
          [`${theme.name}.fontSans`, theme.typography?.fontSans],
          [`${theme.name}.fontMono`, theme.typography?.fontMono]
        ] as Array<[string, string | undefined]>
      ).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
  ]

  it.each(stacks)('%s includes a color-emoji font', (_label, stack) => {
    expect(stack).toMatch(/Apple Color Emoji|Segoe UI Emoji|Noto Color Emoji|(^|,\s*)emoji\b/)
  })
})

describe('theme typography Latin Extended fallback (#61392)', () => {
  const monoStacks: Array<[string, string]> = [
    ['DEFAULT_TYPOGRAPHY.fontMono', DEFAULT_TYPOGRAPHY.fontMono],
    ...BUILTIN_THEME_LIST.map(
      theme =>
        [
          `${theme.name}.effectiveFontMono`,
          theme.typography?.fontMono ?? nousTheme.typography?.fontMono ?? DEFAULT_TYPOGRAPHY.fontMono
        ] as [string, string]
    )
  ]

  it.each(monoStacks)('%s falls back to bundled JetBrains Mono before generic fonts', (_label, stack) => {
    const jetbrains = stack.indexOf('JetBrains Mono')

    expect(jetbrains).toBeGreaterThanOrEqual(0)

    const genericIndexes = [
      stack.indexOf('ui-monospace'),
      stack.indexOf('monospace'),
      stack.indexOf('Apple Color Emoji'),
      stack.indexOf('Segoe UI Emoji'),
      stack.indexOf('Noto Color Emoji')
    ].filter(index => index >= 0)

    expect(genericIndexes.length).toBeGreaterThan(0)
    expect(jetbrains).toBeLessThan(Math.min(...genericIndexes))
  })

  it('default stack includes common Linux monospace glyph fallbacks', () => {
    expect(DEFAULT_TYPOGRAPHY.fontMono).toContain('DejaVu Sans Mono')
    expect(DEFAULT_TYPOGRAPHY.fontMono).toContain('Liberation Mono')
    expect(DEFAULT_TYPOGRAPHY.fontMono).toContain('Noto Sans Mono')
  })
})

// OkVevo locked look: the default skin, its palette, and the brand font.
describe('okvevo locked theme', () => {
  it('is the default skin and registered in the catalog', () => {
    expect(DEFAULT_SKIN_NAME).toBe('okvevo')
    expect(BUILTIN_THEMES.okvevo).toBe(okvevoTheme)
  })

  it('carries the locked palette, dark-only', () => {
    expect(okvevoTheme.colors.background).toBe('#2b2b2b')
    expect(okvevoTheme.colors.foreground).toBe('#e3dcd6')
    expect(okvevoTheme.colors.primary).toBe('#ff6d1f')
    expect(okvevoTheme.darkColors).toEqual(okvevoTheme.colors)
  })

  it('leads every stack with Ubuntu', () => {
    expect(DEFAULT_TYPOGRAPHY.fontSans.startsWith('"Ubuntu"')).toBe(true)
  })
})
