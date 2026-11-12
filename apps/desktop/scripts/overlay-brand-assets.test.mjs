import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { overlayBrandAssets } from './overlay-brand-assets.mjs'
import { brandLegacyMacIcns, repoRootFromDesktopScripts } from './okvevo-brand-paths.mjs'

const repoRoot = repoRootFromDesktopScripts()

it('overlays brand icon.icns onto apps/desktop/assets', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'okvevo-overlay-'))
  try {
    const brandIcns = path.join(root, 'brand/assets/apps/desktop/assets/icon.icns')
    const dest = path.join(root, 'apps/desktop/assets/icon.icns')
    mkdirSync(path.dirname(brandIcns), { recursive: true })
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(brandIcns, 'okvevo-icns')
    writeFileSync(dest, 'hermes-icns')
    writeFileSync(
      path.join(root, 'brand/nia.json'),
      JSON.stringify({ assetOverlay: { root: 'brand/assets' } })
    )
    const result = overlayBrandAssets(root)
    expect(result.copied).toContain('apps/desktop/assets/icon.icns')
    expect(readFileSync(dest, 'utf8')).toBe('okvevo-icns')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('brand legacy mac icns resolves under brand/assets', () => {
  const icns = brandLegacyMacIcns(repoRoot)
  expect(icns.replaceAll('\\', '/')).toMatch(/brand\/assets\/apps\/desktop\/assets\/icon\.icns$/)
  // Real tree: bytes differ from the committed Hermes apps/desktop/assets copy.
  const brand = readFileSync(icns)
  const hermes = readFileSync(path.join(repoRoot, 'apps/desktop/assets/icon.icns'))
  expect(brand.equals(hermes)).toBe(false)
  expect(brand.subarray(0, 4).toString('latin1')).toBe('icns')
})

it('CLI root walks to hermes-agent (not apps/desktop)', () => {
  // Guard against the old `../..` slip that overlaid into the wrong tree.
  expect(path.basename(repoRoot)).toBe('hermes-agent')
})
