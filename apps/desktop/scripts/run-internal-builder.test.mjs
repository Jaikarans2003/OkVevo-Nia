import assert from 'node:assert/strict'
import { test } from 'vitest'

import { INTERNAL_ELECTRON_BUILDER_ARGS } from './run-internal-builder.mjs'

test('internal pack overrides macOS plist identity so helpers match the binary', () => {
  assert.ok(INTERNAL_ELECTRON_BUILDER_ARGS.includes('-c.productName=NiaInternal'))
  assert.ok(INTERNAL_ELECTRON_BUILDER_ARGS.includes('-c.executableName=NiaInternal'))
  assert.ok(INTERNAL_ELECTRON_BUILDER_ARGS.includes('-c.mac.extendInfo.CFBundleExecutable=NiaInternal'))
  assert.ok(INTERNAL_ELECTRON_BUILDER_ARGS.includes('-c.mac.extendInfo.CFBundleName=NiaInternal'))
  assert.equal(
    INTERNAL_ELECTRON_BUILDER_ARGS.includes('-c.productName=Nia Internal'),
    false,
    'spaces in productName desync Electron Helper.app from MacOS/Nia'
  )
})
