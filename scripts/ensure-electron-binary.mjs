#!/usr/bin/env node
/**
 * Electron 42+ no longer downloads its binary in a postinstall script.
 * Run this after `npm ci` / `npm install` so apps/desktop's electron/dist exists
 * (CI caches, electron-rebuild, and `electron .` all expect it).
 *
 * install.js is a no-op when the matching binary is already present.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopPkg = path.join(root, 'apps', 'desktop', 'package.json')
const require = createRequire(desktopPkg)
let installJs
try {
  installJs = require.resolve('electron/install.js')
} catch (err) {
  console.error(
    '[ensure-electron-binary] electron is not installed under apps/desktop. ' +
      'Run `npm ci` (or `npm install --workspace apps/desktop`) first.'
  )
  console.error(err)
  process.exit(1)
}

const result = spawnSync(process.execPath, [installJs], {
  stdio: 'inherit',
  cwd: path.dirname(desktopPkg),
})
process.exit(result.status == null ? 1 : result.status)
