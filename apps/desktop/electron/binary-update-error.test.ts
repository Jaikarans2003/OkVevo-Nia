import assert from 'node:assert/strict'

import { test } from 'vitest'

import { mapBinaryUpdateError } from './binary-update-error'

/** Exact Windows overlay dump from 2026-09-21 (electron-updater JSON.stringify of Get-AuthenticodeSignature). */
const WINDOWS_SCREENSHOT_SIGNATURE_ERROR = String.raw`New version 0.17.14 is not signed by the application owner: publisherNames: OkVevo, raw info: {
  "SignerCertificate": null,
  "TimeStamperCertificate": null,
  "Status": 2,
  "StatusMessage": "The file C:\\Users\\karan\\AppData\\Local\\hermes-updater\\pending\\temp-Nia-0.17.14-win-x64.exe is not digitally signed. You cannot run this script on the current system. For more information about running scripts and setting execution policy, see about_Execution_Policies at https://go.microsoft.com/fwlink/?LinkID=135170",
  "Path": "C:\\Users\\karan\\AppData\\Local\\hermes-updater\\pending\\temp-Nia-0.17.14-win-x64.exe"
}`

test('screenshot signature dump maps to UPD-SIGNATURE', () => {
  assert.equal(mapBinaryUpdateError({ message: WINDOWS_SCREENSHOT_SIGNATURE_ERROR }), 'UPD-SIGNATURE')
  assert.equal(mapBinaryUpdateError(WINDOWS_SCREENSHOT_SIGNATURE_ERROR), 'UPD-SIGNATURE')
  assert.equal(
    mapBinaryUpdateError(Object.assign(new Error(WINDOWS_SCREENSHOT_SIGNATURE_ERROR), { code: 'ERR_UPDATER_INVALID_SIGNATURE' })),
    'UPD-SIGNATURE'
  )
})

test('download and unknown classes', () => {
  assert.equal(
    mapBinaryUpdateError({ code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', message: 'latest.yml missing' }),
    'UPD-DOWNLOAD'
  )
  assert.equal(mapBinaryUpdateError(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })), 'UPD-DOWNLOAD')
  assert.equal(mapBinaryUpdateError({ code: 'UPD-INSTALL-TIMEOUT' }), 'UPD-INSTALL-TIMEOUT')
  assert.equal(mapBinaryUpdateError(new Error('Squirrel.Mac failed for a mysterious reason')), 'UPD-UNKNOWN')
})
