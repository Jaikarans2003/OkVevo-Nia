import { describe, expect, it } from 'vitest'

import { TRANSLATIONS } from './catalog'

const ATTRIBUTION = 'Built on Hermes Agent by Nous Research'

function walk(value: unknown, path: string, hits: string[]): void {
  if (typeof value === 'string') {
    if (value.replaceAll(ATTRIBUTION, '').includes('Hermes')) hits.push(`${path}: ${value}`)
    return
  }
  if (typeof value === 'function') {
    const samples: unknown[][] = [[], [1], [1, 2], ['a'], ['a', 'b', 3], [0, 'x', true]]
    for (const args of samples) {
      try {
        const out = (value as (...inner: unknown[]) => unknown)(...args)
        if (typeof out === 'string' && out.replaceAll(ATTRIBUTION, '').includes('Hermes')) {
          hits.push(`${path}(${args.map(String).join(',')})`)
        }
      } catch {
        // Some copy functions reject the probe args. The wrapper still rewrites real calls.
      }
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, hits))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`, hits)
  }
}

describe('merged OkVevo catalogs', () => {
  it('keeps Hermes only inside the attribution sentence', () => {
    const hits: string[] = []
    for (const [locale, catalog] of Object.entries(TRANSLATIONS)) walk(catalog, locale, hits)
    expect(hits).toEqual([])
  })
})
