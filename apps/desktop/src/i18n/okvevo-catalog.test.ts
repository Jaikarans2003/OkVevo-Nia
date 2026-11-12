import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { TRANSLATIONS } from './catalog'

const ATTRIBUTION = 'Built on Hermes Agent by Nous Research'

/** Never defined in Hermes v0.22.4 either (docs/okvevo/UPSTREAM-KNOWN-ISSUES.md). Drop on the sync that adds them. */
const UPSTREAM_MISSING_KEYS = new Set(['settings.mcp.catalogInstallTimeout', 'settings.localModels.updateToast'])

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

  // The brand overlay rewrites Hermes in VALUES; renaming a KEY to OkVevo makes the
  // UI paint the raw key (Restart / Update buttons, boot step, restart toasts).
  it('every literal translateNow key resolves in the English catalog', () => {
    const srcRoot = path.resolve(import.meta.dirname, '..')
    const missing: string[] = []
    const walkFiles = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name)

        if (entry.isDirectory()) {return walkFiles(full)}

        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
      })

    for (const file of walkFiles(srcRoot)) {
      for (const [, key] of readFileSync(file, 'utf8').matchAll(/translateNow\(\s*'([\w.]+)'/g)) {
        const value = key.split('.').reduce<unknown>(
          (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
          TRANSLATIONS.en
        )

        if (value === undefined && !UPSTREAM_MISSING_KEYS.has(key)) {missing.push(`${path.relative(srcRoot, file)}: ${key}`)}
      }
    }

    expect(missing).toEqual([])
  })
})
