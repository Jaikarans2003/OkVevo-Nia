#!/usr/bin/env node
/**
 * No-trace check: a packed PUBLIC OkVevo app must contain no marker of the
 * E2E sign-in hook. Public builds strip the okvevo-e2e-auth source regions
 * (resolve-e2e-auth.mjs); this script greps the shipped main/preload bundles
 * so a strip regression fails the pack job before any upload.
 *
 * dist/** is asar-unpacked (electron-builder.config.cjs), so both bundles are
 * plain text under <resources>/app.asar.unpacked/dist/. Missing files fail —
 * a pack layout change must surface here, not silently skip the check.
 *
 * Usage: node scripts/check-no-e2e-auth.mjs --resources <Resources dir>
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { isMain } from '../../../scripts/build/frontend-common.mjs'

export const E2E_AUTH_MARKERS = Object.freeze([
  'okvevo-auth:e2e-complete',
  'e2eCompleteOkvevoSignIn',
  'OKVEVO_E2E_AUTH',
  'okvevo-e2e-auth:begin',
  'okvevo-e2e-auth:end'
])

const BUNDLES = ['electron-main.mjs', 'electron-preload.js']

export function assertNoE2eAuthMarkers(resourcesDir, { readFile = readFileSync } = {}) {
  const distDir = join(resolve(resourcesDir), 'app.asar.unpacked', 'dist')
  for (const bundle of BUNDLES) {
    const file = join(distDir, bundle)
    let text
    try {
      text = readFile(file, 'utf8')
    } catch {
      throw new Error(`packed bundle missing: ${file} (pack layout changed — update this check)`)
    }
    for (const marker of E2E_AUTH_MARKERS) {
      if (text.includes(marker)) {
        throw new Error(
          `public pack contains E2E sign-in hook marker ${JSON.stringify(marker)} in ${bundle}. ` +
            'The okvevo-e2e-auth strip ran only when OKVEVO_E2E_AUTH is unset — never pack a customer build with it set.'
        )
      }
    }
  }
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { resources: { type: 'string' } } })
  if (!values.resources) {
    console.error('usage: check-no-e2e-auth.mjs --resources <Resources dir>')
    process.exit(2)
  }
  try {
    assertNoE2eAuthMarkers(values.resources)
    console.log('[check-no-e2e-auth] public pack clean: no E2E sign-in hook markers')
  } catch (error) {
    console.error(`[check-no-e2e-auth] ${error.message}`)
    process.exit(1)
  }
}
