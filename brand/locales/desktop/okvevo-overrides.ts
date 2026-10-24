const ATTRIBUTION = 'Built on Hermes Agent by Nous Research'

export function rewriteOkvevoCopy(text: string): string {
  if (!text.includes('Hermes')) return text
  return text
    .split(ATTRIBUTION)
    .map(part => part.replaceAll('Hermes', 'OkVevo').replaceAll('a OkVevo', 'an OkVevo').replaceAll('A OkVevo', 'An OkVevo'))
    .join(ATTRIBUTION)
}

function rewriteNode(value: unknown): unknown {
  if (typeof value === 'string') {
    const next = rewriteOkvevoCopy(value)
    return next === value ? undefined : next
  }
  if (typeof value === 'function') {
    const source = Function.prototype.toString.call(value)
    if (!source.includes('Hermes')) return undefined
    return (...args: unknown[]) => {
      const out = (value as (...inner: unknown[]) => unknown)(...args)
      return typeof out === 'string' ? rewriteOkvevoCopy(out) : out
    }
  }
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map(item => {
      if (typeof item !== 'string') return item
      const rewritten = rewriteOkvevoCopy(item)
      if (rewritten !== item) changed = true
      return rewritten
    })
    return changed ? next : undefined
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    let changed = false
    for (const [key, child] of Object.entries(value)) {
      const next = rewriteNode(child)
      if (next !== undefined) {
        out[key] = next
        changed = true
      }
    }
    return changed ? out : undefined
  }
  return undefined
}

/** Keys whose English text contains Hermes, rewritten to OkVevo. */
export function okvevoOverrides(english: object): Record<string, unknown> {
  const next = rewriteNode(english)
  return next && typeof next === 'object' && !Array.isArray(next) ? (next as Record<string, unknown>) : {}
}

/** Rewrite Hermes left in a locale after the English override is merged. */
export function rewriteRemainingHermes<T>(value: T): T {
  if (typeof value === 'string') return rewriteOkvevoCopy(value) as T
  if (typeof value === 'function') {
    const source = Function.prototype.toString.call(value)
    if (!source.includes('Hermes')) return value
    return ((...args: unknown[]) => {
      const out = (value as (...inner: unknown[]) => unknown)(...args)
      return typeof out === 'string' ? rewriteOkvevoCopy(out) : out
    }) as T
  }
  if (Array.isArray(value)) return value.map(item => rewriteRemainingHermes(item)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) out[key] = rewriteRemainingHermes(child)
    return out as T
  }
  return value
}
