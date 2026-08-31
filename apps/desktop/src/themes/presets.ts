/**
 * Built-in desktop theme. Nia ships one fixed dark palette — no picker, no
 * OS-follow, no light variant. Stored prefs pointing at retired preset names
 * fall back here via `normalizeSkin`.
 */

import type { DesktopTheme, DesktopThemeTypography } from './types'

// Color-emoji fonts to append to every stack as a last resort. None of the UI
// text/mono fonts carry emoji glyphs, so without this emoji render as tofu
// boxes on platforms whose default text font lacks them (e.g. Linux/#40364).
// Covers macOS, Windows, Linux, plus the `emoji` generic for anything else.
export const EMOJI_FALLBACK = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji'

const SYSTEM_SANS =
  '"Segoe WPC", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif, ' +
  EMOJI_FALLBACK

const SYSTEM_MONO = 'Menlo, Monaco, "SF Mono", "Courier Prime", monospace, ' + EMOJI_FALLBACK

export const DEFAULT_TYPOGRAPHY: DesktopThemeTypography = {
  fontSans: `"Ubuntu", ${SYSTEM_SANS}`,
  fontMono: SYSTEM_MONO
}

/** Nous dark-terminal ANSI, kept verbatim — code/terminal surfaces are unchanged. */
const NIA_DARK_TERMINAL = {
  foreground: '#e6edf3',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#ffffff'
} as const

/**
 * Nia — charcoal / sand / orange. Dark-only; `colors` and `darkColors` are the
 * same so a leaked light request still paints this look.
 *
 * Seeds: background #2b2b2b, foreground #e3dcd6, accent #ff6d1f. Soft surfaces
 * are mixes of the charcoal with the orange; chrome steps sit around the bg.
 */
const NIA_COLORS = {
  background: '#2b2b2b',
  foreground: '#e3dcd6',
  card: '#242424',
  cardForeground: '#e3dcd6',
  muted: '#323232',
  mutedForeground: '#908c89',
  popover: '#333333',
  popoverForeground: '#e3dcd6',
  primary: '#ff6d1f',
  primaryForeground: '#161616',
  secondary: '#513728',
  secondaryForeground: '#e3dcd6',
  accent: '#40322a',
  accentForeground: '#e3dcd6',
  border: '#41403f',
  input: '#2b2b2b',
  ring: '#ff6d1f',
  midground: '#ff6d1f',
  midgroundForeground: '#161616',
  composerRing: '#ff6d1f',
  destructive: '#f85149',
  destructiveForeground: '#ffffff',
  sidebarBackground: '#252525',
  sidebarBorder: '#41403f',
  userBubble: '#493429',
  userBubbleBorder: '#41403f'
} as const

export const niaTheme: DesktopTheme = {
  name: 'nia',
  label: 'Nia',
  description: 'Charcoal, sand, and orange',
  colors: NIA_COLORS,
  darkColors: NIA_COLORS,
  typography: {
    fontSans: DEFAULT_TYPOGRAPHY.fontSans,
    fontMono: DEFAULT_TYPOGRAPHY.fontMono,
    fontUrl: 'https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap'
  },
  terminal: NIA_DARK_TERMINAL,
  darkTerminal: NIA_DARK_TERMINAL
}

export const BUILTIN_THEMES: Record<string, DesktopTheme> = { nia: niaTheme }

export const BUILTIN_THEME_LIST = Object.values(BUILTIN_THEMES)

/** Skin used when nothing is persisted or the persisted name is retired. */
export const DEFAULT_SKIN_NAME = 'nia'
