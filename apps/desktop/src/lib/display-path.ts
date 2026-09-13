/**
 * One place to format filesystem paths for DISPLAY.
 *
 * Industry standard (shells, VS Code `tildify`, Finder path bar): collapse the
 * user's home directory to `~`, keep forward slashes, leave everything else
 * alone. Copy/reveal/IPC still use the real absolute path — this is paint only.
 *
 * When `home` is unknown (renderer has no `os.homedir()` and remote cwd may
 * not match the local machine), a conservative heuristic still collapses the
 * common `/Users/<name>`, `/home/<name>`, and `C:/Users/<name>` prefixes so a
 * long absolute path never paints raw in chrome.
 */

export interface DisplayPathOptions {
  /** Explicit home directory to collapse (local machine home, remote $HOME). */
  home?: null | string
}

/** Normalize separators and drop a trailing slash (except root / drive root). */
export function normalizeDisplayPath(raw: string): string {
  let path = (raw || '').trim().replace(/\\/g, '/')

  if (!path) {
    return ''
  }

  // Collapse repeated slashes, but keep a leading UNC `//server/...` pair.
  if (path.startsWith('//')) {
    path = `//${path.slice(2).replace(/\/{2,}/g, '/')}`
  } else {
    path = path.replace(/\/{2,}/g, '/')
  }

  // Drop trailing slash except bare `/` or `C:/`.
  if (path.length > 1 && path.endsWith('/') && !/^[A-Za-z]:\/$/.test(path)) {
    path = path.replace(/\/+$/, '')
  }

  return path
}

function normalizeHome(home: string): string {
  const normalized = normalizeDisplayPath(home)

  if (!normalized) {
    return ''
  }

  // Home itself should not keep a trailing slash for prefix checks.
  return normalized.replace(/\/+$/, '')
}

function startsWithHome(path: string, home: string, caseInsensitive: boolean): boolean {
  if (!home) {
    return false
  }

  if (path === home) {
    return true
  }

  const prefix = `${home}/`

  return caseInsensitive
    ? path.toLowerCase().startsWith(prefix.toLowerCase()) || path.toLowerCase() === home.toLowerCase()
    : path.startsWith(prefix) || path === home
}

/**
 * Best-effort home prefix when callers don't pass one. Matches the usual
 * single-user layouts; never collapses `/Users` or `/home` alone.
 */
function inferredHomePrefix(path: string): string {
  // macOS: /Users/name[/...]
  let match = path.match(/^(\/Users\/[^/]+)(?:\/|$)/)

  if (match) {
    return match[1]
  }

  // Linux (and most UNIX): /home/name[/...]
  match = path.match(/^(\/home\/[^/]+)(?:\/|$)/)

  if (match) {
    return match[1]
  }

  // Windows user profile: C:/Users/name[/...] (also works after \ → /)
  match = path.match(/^([A-Za-z]:\/Users\/[^/]+)(?:\/|$)/)

  if (match) {
    return match[1]
  }

  return ''
}

/**
 * Format a filesystem path for UI chrome.
 *
 *   /Users/brooklyn/www/hermes-agent  →  ~/www/hermes-agent
 *   /Users/brooklyn                   →  ~
 *   C:\Users\brooklyn\src             →  ~/src
 *   /var/log                          →  /var/log
 *   already/relative                  →  already/relative
 */
export function displayPath(raw: null | string | undefined, options: DisplayPathOptions = {}): string {
  const path = normalizeDisplayPath(raw || '')

  if (!path) {
    return ''
  }

  // Already tildified — normalize only.
  if (path === '~' || path.startsWith('~/')) {
    return path
  }

  const explicitHome = options.home ? normalizeHome(options.home) : ''
  // Windows paths are case-insensitive; POSIX paths with an explicit home keep
  // case-sensitive matching (Linux). Heuristic homes on mac/win ignore case.
  const home = explicitHome || inferredHomePrefix(path)

  if (!home) {
    return path
  }

  const caseInsensitive = !explicitHome || /^[A-Za-z]:\//.test(home) || home.startsWith('/Users/')

  if (!startsWithHome(path, home, caseInsensitive)) {
    return path
  }

  if (path.length === home.length) {
    return '~'
  }

  return `~${path.slice(home.length)}`
}

/** Last path segment for compact labels (statusbar leaf, settings rows). */
export function pathLeaf(raw: null | string | undefined): string {
  const path = normalizeDisplayPath(raw || '')

  if (!path || path === '/' || path === '~') {
    return path
  }

  // `C:/` drive root
  if (/^[A-Za-z]:\/$/.test(path) || /^[A-Za-z]:$/.test(path)) {
    return path.endsWith('/') ? path : `${path}/`
  }

  const leaf = path.split('/').filter(Boolean).pop()

  return leaf || path
}

/**
 * Nickname the on-disk Hermes root when painting it. Disk stays `~/.hermes`;
 * the UI prints `.nia` / `nia-agent`. Do not use this on inputs, commands,
 * URLs, or copy payloads.
 */
export function displayInstallPath(raw: string): string {
  return raw.replaceAll('hermes-agent', 'nia-agent').replaceAll('.hermes', '.nia')
}

const HERMES_DESKTOP_APP_RE = /\bHermes desktop app\b/g
const HERMES_AGENT_RE = /\bHermes Agent\b/g
const HERMES_WORD_RE = /\bHermes\b/g
const NOUS_RESEARCH_RE = /\bNous Research\b/g
const NOUS_WORD_RE = /\bNous\b/g
const OPENROUTER_WORD_RE = /\bOpenRouter\b/g
const FAL_WORD_RE = /\bfal\.ai\b/g
const HEY_HERMES_RE = /\bhey hermes\b/gi
const HEY_NIA_RE = /\bhey nia\b/gi
const HERMES_PROFILE_AT_RE = /@hermes\b(?!\/)/g
const HERMES_CLI_SPAN_RE = /`hermes [^`]*`/g
const FENCED_CODE_RE = /```[\s\S]*?(?:```|$)/g
const THE_GATEWAY_RE = /\bthe gateway\b/gi
const BACKEND_PROCESS_RE = /\bbackend process\b/gi
const GATEWAY_WORD_RE = /\bgateway\b/gi
const BACKEND_WORD_RE = /\bbackend\b/gi
const ROSTER_WORD_RE = /\broster\b/gi
const HOME_DOTFILE_PATH_RE =
  /(?:~|\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:[\\/]Users[\\/][^\\/\s]+)[\\/]\.[^\s`'"]+/g
const HOME_DOTFILE_PATH_TEST_RE =
  /(?:~|\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:[\\/]Users[\\/][^\\/\s]+)[\\/]\.[^\s`'"]+/
const INTERNAL_FENCE_PLACEHOLDER = '[internal details omitted]'

const LEGACY_WAKE_PHRASES = new Set(['', 'hey hermes', 'hey nia'])

/** Paint-only: leftover YAML `hey hermes` / `hey nia` never reach the tooltip. */
export function displayWakePhrase(phrase: string | null | undefined): string {
  const raw = (phrase ?? '').trim()

  return LEGACY_WAKE_PHRASES.has(raw.toLowerCase()) ? 'ok nia' : raw
}

function fenceContainsInternal(block: string): boolean {
  const stripped = block.replace(/hermes:\/\//gi, '').replace(/@hermes\//g, '')

  return (
    /\bhermes\b/i.test(stripped) ||
    /\bnous\b/i.test(stripped) ||
    /\bopenrouter\b/i.test(stripped) ||
    /\bfal\.ai\b/i.test(stripped) ||
    /\bgateway\b/i.test(stripped) ||
    /\bbackend\b/i.test(stripped) ||
    /\broster\b/i.test(stripped) ||
    /\.hermes\b/.test(stripped) ||
    HOME_DOTFILE_PATH_TEST_RE.test(stripped)
  )
}

function sanitizeUserFacingProse(raw: string): string {
  return displayInstallPath(raw)
    .replace(HERMES_CLI_SPAN_RE, 'a Nia command')
    .replace(HERMES_DESKTOP_APP_RE, 'Nia desktop app')
    .replace(HERMES_AGENT_RE, 'Nia')
    .replace(HERMES_WORD_RE, 'Nia')
    .replace(NOUS_RESEARCH_RE, 'OkVevo')
    .replace(NOUS_WORD_RE, 'OkVevo')
    .replace(OPENROUTER_WORD_RE, 'OkVevo')
    .replace(FAL_WORD_RE, 'OkVevo')
    .replace(HEY_HERMES_RE, 'ok nia')
    .replace(HEY_NIA_RE, 'ok nia')
    .replace(HERMES_PROFILE_AT_RE, '@nia')
    .replace(THE_GATEWAY_RE, 'the app')
    .replace(BACKEND_PROCESS_RE, 'app')
    .replace(GATEWAY_WORD_RE, 'app')
    .replace(BACKEND_WORD_RE, 'app')
    .replace(ROSTER_WORD_RE, 'bots list')
    .replace(HOME_DOTFILE_PATH_RE, match => {
      const punct = match.match(/[.,;:!?]+$/)?.[0] ?? ''

      return `your Nia data folder${punct}`
    })
}

/** Rewrite leftover product copy, mechanism terms, and home-dotfile paths for paint. */
export function sanitizeUserFacingBrand(raw: string): string {
  // ponytail: ordered regex table; upgrade if a real tokenizer is needed for mixed markdown.
  const withFences = raw.replace(FENCED_CODE_RE, block =>
    fenceContainsInternal(block) ? INTERNAL_FENCE_PLACEHOLDER : block
  )

  return sanitizeUserFacingProse(withFences)
}
