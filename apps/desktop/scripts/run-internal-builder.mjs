#!/usr/bin/env node
// Internal pack identity. Args are an array so ${version} is electron-builder's
// template, not a shell expansion. Always --publish never — never the public feed.
//
// Filesystem names must be one token (OkVevoInternal). product-identity.cjs
// displayName is "OkVevo Internal" (space); leaving that as CFBundleExecutable
// makes Electron Helper.app names miss the main binary and abort at
// ElectronMain (SIGTRAP, ~50ms). Override the three plist keys here.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMain } from './utils.mjs'

export const INTERNAL_ELECTRON_BUILDER_ARGS = [
  '--publish',
  'never',
  '-c.appId=com.okvevo.app-internal',
  '-c.productName=OkVevoInternal',
  '-c.executableName=OkVevoInternal',
  '-c.artifactName=OkVevoInternal-${version}-${os}-${arch}.${ext}',
  // Windows: public builds use "OkVevo" shortcuts — without these overrides
  // the internal installer overwrites the public build's shortcut and both
  // show as "OkVevo" in Add/Remove Programs.
  '-c.nsis.shortcutName=OkVevoInternal',
  '-c.nsis.uninstallDisplayName=OkVevo Internal',
  '-c.mac.extendInfo.CFBundleExecutable=OkVevoInternal',
  '-c.mac.extendInfo.CFBundleName=OkVevoInternal',
  '-c.mac.extendInfo.CFBundleDisplayName=OkVevo Internal'
]

const here = dirname(fileURLToPath(import.meta.url))

if (isMain(import.meta.url)) {
  const result = spawnSync(
    process.execPath,
    [resolve(here, 'run-electron-builder.mjs'), ...process.argv.slice(2), ...INTERNAL_ELECTRON_BUILDER_ARGS],
    { stdio: 'inherit' }
  )
  process.exit(result.status == null ? 1 : result.status)
}
