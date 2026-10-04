import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { overlayBrandAssets } from './overlay-brand-assets.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ICON_PATHS = [
  'apps/bootstrap-installer/src-tauri/icons/128x128.png',
  'apps/bootstrap-installer/src-tauri/icons/128x128@2x.png',
  'apps/bootstrap-installer/src-tauri/icons/32x32.png',
  'apps/bootstrap-installer/src-tauri/icons/icon.icns',
  'apps/bootstrap-installer/src-tauri/icons/icon.ico',
  'apps/desktop/assets/icon.icns',
  'apps/desktop/assets/icon.ico',
  'apps/desktop/assets/icon.png',
]

function git(args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

test('overlay copies brand bytes and applies removals', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nia-brand-'))
  mkdirSync(path.join(root, 'brand', 'assets', 'apps', 'desktop', 'assets'), { recursive: true })
  writeFileSync(path.join(root, 'brand', 'nia.json'), JSON.stringify({
    assetOverlay: {
      root: 'brand/assets',
      remove: ['apps/desktop/public/apple-touch-icon.png'],
    },
  }))
  writeFileSync(path.join(root, 'brand', 'assets', 'apps', 'desktop', 'assets', 'icon.png'), 'nia-bytes')
  mkdirSync(path.join(root, 'apps', 'desktop', 'assets'), { recursive: true })
  mkdirSync(path.join(root, 'apps', 'desktop', 'public'), { recursive: true })
  writeFileSync(path.join(root, 'apps', 'desktop', 'assets', 'icon.png'), 'upstream-bytes')
  writeFileSync(path.join(root, 'apps', 'desktop', 'public', 'apple-touch-icon.png'), 'upstream-touch')

  const result = overlayBrandAssets(root)
  assert.deepEqual(result.copied, ['apps/desktop/assets/icon.png'])
  assert.deepEqual(result.removed, ['apps/desktop/public/apple-touch-icon.png'])
  assert.equal(readFileSync(path.join(root, 'apps', 'desktop', 'assets', 'icon.png'), 'utf8'), 'nia-bytes')
  assert.equal(existsSync(path.join(root, 'apps', 'desktop', 'public', 'apple-touch-icon.png')), false)
})

test('committed icon paths match upstream; brand/assets keeps the Nia bytes', () => {
  for (const rel of ICON_PATHS) {
    assert.equal(git(['hash-object', `brand/assets/${rel}`]), git(['rev-parse', `okvevo/staging:${rel}`]), rel)
    assert.equal(git(['rev-parse', `:${rel}`]), git(['rev-parse', `origin/main:${rel}`]), rel)
  }
  const spec = JSON.parse(readFileSync(path.join(repo, 'brand', 'nia.json'), 'utf8'))
  assert.deepEqual(spec.assetOverlay.remove, ['apps/desktop/public/apple-touch-icon.png'])
  assert.equal(git(['rev-parse', ':apps/desktop/public/apple-touch-icon.png']), git(['rev-parse', 'origin/main:apps/desktop/public/apple-touch-icon.png']))
  assert.throws(() => git(['rev-parse', 'okvevo/staging:apps/desktop/public/apple-touch-icon.png']))
})
