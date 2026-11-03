import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { expect, test } from 'vitest'

import { assertNoE2eAuthMarkers } from './check-no-e2e-auth.mjs'
import { resolveE2eAuth, stripE2eAuthRegions } from './resolve-e2e-auth.mjs'

// The packed-app E2E sign-in hook (hermes:okvevo-auth:e2e-complete) must never
// ship in a customer pack. Public builds strip the okvevo-e2e-auth source
// regions via the bundler plugin, so no marker survives. These tests pin the
// flag, the stripper, and the markers in the real main/preload source.

const desktop = resolve(import.meta.dirname, '..')

test('resolveE2eAuth is off unless OKVEVO_E2E_AUTH is exactly 1/true', () => {
  expect(resolveE2eAuth({ env: {} })).toBe(false)
  expect(resolveE2eAuth({ env: { OKVEVO_E2E_AUTH: '0' } })).toBe(false)
  expect(resolveE2eAuth({ env: { OKVEVO_E2E_AUTH: 'yes' } })).toBe(false)
  expect(resolveE2eAuth({ env: { OKVEVO_E2E_AUTH: '1' } })).toBe(true)
  expect(resolveE2eAuth({ env: { OKVEVO_E2E_AUTH: 'true' } })).toBe(true)
})

test('stripE2eAuthRegions removes the hook and leaves the rest', () => {
  const src = [
    'const keep = 1',
    '// okvevo-e2e-auth:begin',
    'const secret = "hermes:okvevo-auth:e2e-complete"',
    '// okvevo-e2e-auth:end',
    'const alsoKeep = 2'
  ].join('\n')
  const out = stripE2eAuthRegions(src, 'fixture.ts')
  expect(out).not.toContain('e2e-complete')
  expect(out).not.toContain('okvevo-e2e-auth')
  expect(out).toContain('const keep = 1')
  expect(out).toContain('const alsoKeep = 2')
})

test('stripE2eAuthRegions throws on unbalanced markers', () => {
  expect(() => stripE2eAuthRegions('// okvevo-e2e-auth:begin\nconst x = 1', 'a.ts')).toThrow(/unclosed/)
  expect(() => stripE2eAuthRegions('// okvevo-e2e-auth:end', 'b.ts')).toThrow(/without begin/)
})

test('main.ts e2e-auth region strips cleanly (public pack keeps no marker)', () => {
  const src = readFileSync(join(desktop, 'electron', 'main.ts'), 'utf8')
  expect(src).toContain('okvevo-auth:e2e-complete') // hook present in source
  const stripped = stripE2eAuthRegions(src, 'main.ts')
  expect(stripped).not.toContain('okvevo-auth:e2e-complete')
  expect(stripped).not.toContain('okvevo-e2e-auth:begin')
})

test('preload.ts e2e-auth region strips cleanly (public pack keeps no bridge)', () => {
  const src = readFileSync(join(desktop, 'electron', 'preload.ts'), 'utf8')
  expect(src).toContain('e2eCompleteOkvevoSignIn') // bridge present in source
  const stripped = stripE2eAuthRegions(src, 'preload.ts')
  expect(stripped).not.toContain('e2eCompleteOkvevoSignIn')
  expect(stripped).not.toContain('okvevo-auth:e2e-complete')
  expect(stripped).not.toContain('okvevo-e2e-auth:begin')
})

function fixturePack(files) {
  const root = mkdtempSync(join(tmpdir(), 'okvevo-no-e2e-auth-'))
  const dist = join(root, 'app.asar.unpacked', 'dist')
  mkdirSync(dist, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dist, name), text)
  }
  return { resources: root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const CLEAN = { 'electron-main.mjs': 'main bundle', 'electron-preload.js': 'preload bundle' }

test('assertNoE2eAuthMarkers passes a clean pack layout', () => {
  const pack = fixturePack(CLEAN)
  try {
    expect(() => assertNoE2eAuthMarkers(pack.resources)).not.toThrow()
  } finally {
    pack.cleanup()
  }
})

test('assertNoE2eAuthMarkers fails when any marker survives in either bundle', () => {
  for (const marker of ['okvevo-auth:e2e-complete', 'e2eCompleteOkvevoSignIn', 'OKVEVO_E2E_AUTH', 'okvevo-e2e-auth:begin']) {
    for (const bundle of ['electron-main.mjs', 'electron-preload.js']) {
      const pack = fixturePack({ ...CLEAN, [bundle]: `leaked ${marker}` })
      try {
        expect(() => assertNoE2eAuthMarkers(pack.resources), `${marker} in ${bundle}`).toThrow(/E2E sign-in hook marker/)
      } finally {
        pack.cleanup()
      }
    }
  }
})

test('assertNoE2eAuthMarkers fails loudly when the pack layout changed', () => {
  const root = mkdtempSync(join(tmpdir(), 'okvevo-no-e2e-auth-empty-'))
  try {
    expect(() => assertNoE2eAuthMarkers(root)).toThrow(/pack layout changed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
