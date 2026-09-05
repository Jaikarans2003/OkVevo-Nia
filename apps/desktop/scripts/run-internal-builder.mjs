#!/usr/bin/env node
// Internal pack identity. Args are an array so ${version} is electron-builder's
// template, not a shell expansion. Always --publish never — never the public feed.
//
// Filesystem names must be one token (NiaInternal). package.json mac.extendInfo
// hardcodes CFBundleExecutable/Name to "Nia"; leaving those while productName
// is "Nia Internal" makes Electron Helper.app names miss the main binary and
// abort at ElectronMain (SIGTRAP, ~50ms). Override the three plist keys here.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMain } from './utils.mjs'

export const INTERNAL_ELECTRON_BUILDER_ARGS = [
  '--publish',
  'never',
  '-c.appId=com.okvevo.nia.internal',
  '-c.productName=NiaInternal',
  '-c.executableName=NiaInternal',
  '-c.artifactName=NiaInternal-${version}-${os}-${arch}.${ext}',
  '-c.mac.extendInfo.CFBundleExecutable=NiaInternal',
  '-c.mac.extendInfo.CFBundleName=NiaInternal',
  '-c.mac.extendInfo.CFBundleDisplayName=Nia Internal'
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
