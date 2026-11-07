import assert from 'node:assert/strict'
import { test } from 'vitest'

import { sha512Base64 } from './publish-release-feed.mjs'
import { feedFileUrl, smokeReleaseFeed } from './smoke-release-feed.mjs'

function mockFetch(map) {
  return async url => {
    const entry = map[url]
    if (!entry) return { ok: false, status: 404, body: [], text: async () => '' }
    const buf = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(String(entry.body))
    const status = entry.status ?? 200
    return { ok: status === 200, status, body: [buf], text: async () => buf.toString('utf8') }
  }
}

test('feedFileUrl resolves filenames against origin root', () => {
  assert.equal(
    feedFileUrl('https://releases.okvevo.com', 'OkVevo-0.17.15-mac-arm64.zip'),
    'https://releases.okvevo.com/OkVevo-0.17.15-mac-arm64.zip'
  )
  assert.equal(
    feedFileUrl('https://releases.okvevo.com/', 'https://releases.okvevo.com/OkVevo.exe'),
    'https://releases.okvevo.com/OkVevo.exe'
  )
})

test('smokeReleaseFeed checks latest yml, files sha512, and sibling blockmaps', async () => {
  const origin = 'https://releases.okvevo.com'
  const zip = Buffer.from('zip-bytes')
  const exe = Buffer.from('exe-bytes')
  const zipHash = sha512Base64(zip)
  const exeHash = sha512Base64(exe)
  const macYml = [
    'version: 0.17.15',
    'files:',
    '  - url: OkVevo-0.17.15-mac-arm64.zip',
    `    sha512: ${zipHash}`,
    `    size: ${zip.length}`,
    'path: OkVevo-0.17.15-mac-arm64.zip'
  ].join('\n')
  const winYml = [
    'version: 0.17.15',
    'files:',
    '  - url: OkVevo-0.17.15-win-x64.exe',
    `    sha512: ${exeHash}`,
    `    size: ${exe.length}`,
    'path: OkVevo-0.17.15-win-x64.exe'
  ].join('\n')
  const map = {
    [`${origin}/latest-mac.yml`]: { body: macYml },
    [`${origin}/latest.yml`]: { body: winYml },
    [`${origin}/OkVevo-0.17.15-mac-arm64.zip`]: { body: zip },
    [`${origin}/OkVevo-0.17.15-mac-arm64.zip.blockmap`]: { body: 'bm' },
    [`${origin}/OkVevo-0.17.15-win-x64.exe`]: { body: exe },
    [`${origin}/OkVevo-0.17.15-win-x64.exe.blockmap`]: { body: 'bm' }
  }
  const result = await smokeReleaseFeed({ origin, fetchImpl: mockFetch(map) })
  assert.deepEqual(result.versions, ['0.17.15', '0.17.15'])
  await smokeReleaseFeed({ origin, expectVersion: '0.17.15', fetchImpl: mockFetch(map) })
  await assert.rejects(
    () => smokeReleaseFeed({ origin, expectVersion: '0.17.16', fetchImpl: mockFetch(map) }),
    /feed version 0\.17\.15 != expected 0\.17\.16/
  )

  const truncated = { ...map, [`${origin}/OkVevo-0.17.15-win-x64.exe`]: { body: exe.subarray(1) } }
  await assert.rejects(() => smokeReleaseFeed({ origin, fetchImpl: mockFetch(truncated) }), /sha512 mismatch/)

  const wrongSize = { ...map, [`${origin}/latest.yml`]: { body: winYml.replace(`size: ${exe.length}`, 'size: 1') } }
  await assert.rejects(() => smokeReleaseFeed({ origin, fetchImpl: mockFetch(wrongSize) }), /size mismatch/)

  const wrongVersion = { ...map, [`${origin}/latest.yml`]: { body: winYml.replace('version: 0.17.15', 'version: 0.17.16') } }
  await assert.rejects(() => smokeReleaseFeed({ origin, fetchImpl: mockFetch(wrongVersion) }), /version mismatch/)

  const notLive = { ...map, [`${origin}/OkVevo-0.17.15-win-x64.exe`]: { body: exe, status: 403 } }
  await assert.rejects(() => smokeReleaseFeed({ origin, fetchImpl: mockFetch(notLive) }), /missing OkVevo-0\.17\.15-win-x64\.exe/)
})

test('smokeReleaseFeed fails on sha512 mismatch', async () => {
  const origin = 'https://releases.okvevo.com'
  const zip = Buffer.from('zip-bytes')
  const macYml = [
    'version: 0.17.15',
    'files:',
    '  - url: OkVevo-0.17.15-mac-arm64.zip',
    '    sha512: not-the-hash',
    'path: OkVevo-0.17.15-mac-arm64.zip'
  ].join('\n')
  const map = {
    [`${origin}/latest-mac.yml`]: { body: macYml },
    [`${origin}/latest.yml`]: { body: 'version: 0.17.15\nfiles:\n  - url: OkVevo-0.17.15-win-x64.exe\n    sha512: x\npath: OkVevo-0.17.15-win-x64.exe' },
    [`${origin}/OkVevo-0.17.15-mac-arm64.zip`]: { body: zip },
    [`${origin}/OkVevo-0.17.15-mac-arm64.zip.blockmap`]: { body: 'bm' },
    [`${origin}/OkVevo-0.17.15-win-x64.exe`]: { body: 'e' },
    [`${origin}/OkVevo-0.17.15-win-x64.exe.blockmap`]: { body: 'bm' }
  }
  await assert.rejects(() => smokeReleaseFeed({ origin, fetchImpl: mockFetch(map) }), /sha512 mismatch/)
})

test('smokeReleaseFeed fails when a sibling blockmap is missing', async () => {
  const origin = 'https://releases.okvevo.com'
  const zip = Buffer.from('zip-bytes')
  const zipHash = sha512Base64(zip)
  const macYml = [
    'version: 0.17.15',
    'files:',
    '  - url: OkVevo-0.17.15-mac-arm64.zip',
    `    sha512: ${zipHash}`,
    'path: OkVevo-0.17.15-mac-arm64.zip'
  ].join('\n')
  const exe = Buffer.from('exe')
  const map = {
    [`${origin}/latest-mac.yml`]: { body: macYml },
    [`${origin}/latest.yml`]: {
      body: `version: 0.17.15\nfiles:\n  - url: OkVevo-0.17.15-win-x64.exe\n    sha512: ${sha512Base64(exe)}\npath: OkVevo-0.17.15-win-x64.exe`
    },
    [`${origin}/OkVevo-0.17.15-mac-arm64.zip`]: { body: zip },
    [`${origin}/OkVevo-0.17.15-win-x64.exe`]: { body: exe },
    [`${origin}/OkVevo-0.17.15-win-x64.exe.blockmap`]: { body: 'bm' }
  }
  await assert.rejects(() => smokeReleaseFeed({ origin, fetchImpl: mockFetch(map) }), /missing blockmap/)
})
