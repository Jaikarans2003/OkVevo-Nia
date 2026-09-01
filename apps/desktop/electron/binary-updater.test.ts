import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

import {
  BINARY_UPDATE_FEED_URL,
  BINARY_UPDATE_PUBLISHER_NAME,
  checkBinaryUpdate,
  configureBinaryUpdater,
  mapBinaryCheckResult,
  setBinaryUpdaterForTests
} from './binary-updater'

const require = createRequire(import.meta.url)
const desktopPkg = require(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'))

test('feed URL is the releases subdomain, not www.okvevo.com', () => {
  assert.equal(BINARY_UPDATE_FEED_URL, 'https://releases.okvevo.com')
  assert.equal(desktopPkg.build.publish.provider, 'generic')
  assert.equal(desktopPkg.build.publish.url, BINARY_UPDATE_FEED_URL)
  assert.deepEqual(desktopPkg.build.win.publisherName, [BINARY_UPDATE_PUBLISHER_NAME])
  assert.doesNotMatch(BINARY_UPDATE_FEED_URL, /www\.okvevo\.com/)
})

test('mapBinaryCheckResult uses updateAvailable + null behind, not a fake commit count', () => {
  const available = mapBinaryCheckResult({
    currentVersion: '0.20.6',
    isUpdateAvailable: true,
    version: '0.21.0'
  })

  assert.equal(available.updateAvailable, true)
  assert.equal(available.behind, null)
  assert.equal(available.targetSha, 'v0.21.0')
  assert.equal(available.currentVersion, '0.20.6')

  const current = mapBinaryCheckResult({
    currentVersion: '0.21.0',
    isUpdateAvailable: false,
    version: '0.21.0'
  })

  assert.equal(current.updateAvailable, false)
  assert.equal(current.behind, 0)
  assert.equal(current.targetSha, undefined)
})

test('configureBinaryUpdater points at the generic feed and disables silent download', () => {
  const calls: unknown[] = []
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    setFeedURL: (opts: { provider: string; url: string }) => calls.push(opts),
    checkForUpdates: async () => null,
    downloadUpdate: async () => {},
    quitAndInstall: () => {},
    on: () => {}
  }

  configureBinaryUpdater(updater)
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.deepEqual(calls, [{ provider: 'generic', url: BINARY_UPDATE_FEED_URL }])
})

test('checkBinaryUpdate maps a mocked updater and never throws', async () => {
  setBinaryUpdaterForTests({
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowDowngrade: false,
    setFeedURL: () => {},
    checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.21.0' } }),
    downloadUpdate: async () => {},
    quitAndInstall: () => {},
    on: () => {}
  })

  try {
    const status = await checkBinaryUpdate({ currentVersion: '0.20.6' })
    assert.equal(status.updateAvailable, true)
    assert.equal(status.targetSha, 'v0.21.0')
  } finally {
    setBinaryUpdaterForTests(null)
  }
})
