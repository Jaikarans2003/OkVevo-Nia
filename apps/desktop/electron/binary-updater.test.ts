import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

import {
  applyBinaryUpdate,
  BINARY_UPDATE_FEED_URL,
  BINARY_UPDATE_PUBLISHER_NAME,
  checkBinaryUpdate,
  configureBinaryUpdater,
  mapBinaryCheckResult,
  setBinaryUpdaterForTests
} from './binary-updater'

const WINDOWS_SCREENSHOT_SIGNATURE_ERROR = String.raw`New version 0.17.14 is not signed by the application owner: publisherNames: OkVevo, raw info: {
  "SignerCertificate": null,
  "TimeStamperCertificate": null,
  "Status": 2,
  "StatusMessage": "The file C:\\Users\\karan\\AppData\\Local\\hermes-updater\\pending\\temp-Nia-0.17.14-win-x64.exe is not digitally signed. You cannot run this script on the current system. For more information about running scripts and setting execution policy, see about_Execution_Policies at https://go.microsoft.com/fwlink/?LinkID=135170",
  "Path": "C:\\Users\\karan\\AppData\\Local\\hermes-updater\\pending\\temp-Nia-0.17.14-win-x64.exe"
}`

const require = createRequire(import.meta.url)
const desktopPkg = require(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'))

test('feed URL is the releases subdomain, not www.okvevo.com', () => {
  assert.equal(BINARY_UPDATE_FEED_URL, 'https://releases.okvevo.com')
  assert.equal(desktopPkg.build.publish.provider, 'generic')
  assert.equal(desktopPkg.build.publish.url, BINARY_UPDATE_FEED_URL)
  assert.equal(desktopPkg.build.publish.channel, 'latest')
  assert.equal(desktopPkg.build.detectUpdateChannel, false)
  assert.deepEqual(desktopPkg.build.win.signtoolOptions.publisherName, [BINARY_UPDATE_PUBLISHER_NAME])
  assert.deepEqual(desktopPkg.build.mac.target, ['dmg', 'zip'])
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

test('configureBinaryUpdater points at the generic feed, channel latest, and disables silent download', () => {
  const calls: unknown[] = []
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    setFeedURL: (opts: { provider: string; url: string; channel?: string }) => calls.push(opts),
    checkForUpdates: async () => null,
    downloadUpdate: async () => {},
    quitAndInstall: () => {},
    on: () => {}
  }

  configureBinaryUpdater(updater, { env: {} })
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal((updater as { verifyUpdateCodeSignature?: boolean }).verifyUpdateCodeSignature, undefined)
  assert.deepEqual(calls, [{ provider: 'generic', url: BINARY_UPDATE_FEED_URL, channel: 'latest' }])
})

test('configureBinaryUpdater honors NIA_UPDATE_FEED_URL and NIA_UPDATE_CHANNEL', () => {
  const calls: unknown[] = []
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowDowngrade: false,
    setFeedURL: (opts: { provider: string; url: string; channel?: string }) => calls.push(opts),
    checkForUpdates: async () => null,
    downloadUpdate: async () => {},
    quitAndInstall: () => {},
    on: () => {}
  }

  configureBinaryUpdater(updater, {
    env: {
      NIA_UPDATE_FEED_URL: 'https://releases.okvevo.com/staging/',
      NIA_UPDATE_CHANNEL: 'internal'
    }
  })
  assert.deepEqual(calls, [
    { provider: 'generic', url: 'https://releases.okvevo.com/staging', channel: 'internal' }
  ])
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

function mockApplyUpdater(over: {
  downloadUpdate?: () => Promise<unknown>
  quitAndInstall?: () => void
  emitter?: EventEmitter
}) {
  const emitter = over.emitter ?? new EventEmitter()

  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowDowngrade: false,
    setFeedURL: () => {},
    checkForUpdates: async () => null,
    downloadUpdate:
      over.downloadUpdate ??
      (async () => {
        emitter.emit('update-downloaded')
      }),
    quitAndInstall: over.quitAndInstall ?? (() => {}),
    on: (event: string, listener: (...args: unknown[]) => void) => {
      emitter.on(event, listener)
    },
    emitter
  }
}

test('no-op quitAndInstall times out: onQuitForHandoff is not treated as handoff', async () => {
  const updater = mockApplyUpdater({})
  const quitSignals = new EventEmitter()
  const onQuitForHandoff = () => {}
  let handedOffFlagWouldBeTrue = false

  setBinaryUpdaterForTests(updater)

  try {
    const result = await applyBinaryUpdate({
      emitProgress: () => {},
      onQuitForHandoff: () => {
        handedOffFlagWouldBeTrue = true
        onQuitForHandoff()
      },
      quitSignals: {
        on: (event, listener) => {
          quitSignals.on(event, listener)
        }
      },
      quitTimeoutMs: 20
    })

    assert.equal(handedOffFlagWouldBeTrue, true)
    assert.notEqual(result.handedOff, true)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'UPD-INSTALL-TIMEOUT')
    assert.equal('message' in result, false)
  } finally {
    setBinaryUpdaterForTests(null)
  }
})

test('synchronous before-quit-for-update inside quitAndInstall is handoff, not a false timeout', async () => {
  const quitSignals = new EventEmitter()
  const updater = mockApplyUpdater({
    quitAndInstall: () => {
      quitSignals.emit('before-quit-for-update')
    }
  })

  setBinaryUpdaterForTests(updater)

  try {
    const result = await applyBinaryUpdate({
      emitProgress: () => {},
      onQuitForHandoff: () => {},
      quitSignals: {
        on: (event, listener) => {
          quitSignals.on(event, listener)
        }
      },
      quitTimeoutMs: 20
    })

    assert.deepEqual(result, { ok: true, handedOff: true })
  } finally {
    setBinaryUpdaterForTests(null)
  }
})

test('error event after download maps to UPD-SIGNATURE with no raw message on the result', async () => {
  const emitter = new EventEmitter()
  const updater = mockApplyUpdater({
    emitter,
    quitAndInstall: () => {
      emitter.emit(
        'error',
        Object.assign(new Error(WINDOWS_SCREENSHOT_SIGNATURE_ERROR), { code: 'ERR_UPDATER_INVALID_SIGNATURE' })
      )
    }
  })
  const rawLines: string[] = []

  setBinaryUpdaterForTests(updater)

  try {
    const result = await applyBinaryUpdate({
      emitProgress: () => {},
      logRaw: line => {
        rawLines.push(line)
      },
      onQuitForHandoff: () => {},
      quitSignals: {
        on: () => {}
      },
      quitTimeoutMs: 50
    })

    assert.equal(result.ok, false)
    assert.equal(result.error, 'UPD-SIGNATURE')
    assert.equal(result.handedOff, undefined)
    assert.equal('message' in result, false)
    assert.doesNotMatch(JSON.stringify(result), /hermes-updater|publisherNames|Execution_Policies|karan/)
    assert.ok(rawLines.some(line => line.includes('publisherNames') || line.includes('ERR_UPDATER_INVALID_SIGNATURE')))
  } finally {
    setBinaryUpdaterForTests(null)
  }
})
