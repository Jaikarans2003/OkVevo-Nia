import assert from 'node:assert/strict'
import { test } from 'vitest'

import { sha512Base64 } from './publish-release-feed.mjs'
import { feedFileUrl, smokeReleaseFeed } from './smoke-release-feed.mjs'

function mockFetch(map) {
  return async url => {
    const entry = map[url]
    if (!entry) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
    return {
      ok: (entry.status ?? 200) === 200,
      status: entry.status ?? 200,
      arrayBuffer: async () => {
        const buf = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(String(entry.body))
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      }
    }
  }
}

test('feedFileUrl resolves filenames against origin root', () => {
  assert.equal(
    feedFileUrl('https://releases.okvevo.com', 'Nia-0.17.15-mac-arm64.zip'),
    'https://releases.okvevo.com/Nia-0.17.15-mac-arm64.zip'
  )
  assert.equal(
    feedFileUrl('https://releases.okvevo.com/', 'https://releases.okvevo.com/Nia.exe'),
    'https://releases.okvevo.com/Nia.exe'
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
    '  - url: Nia-0.17.15-mac-arm64.zip',
    `    sha512: ${zipHash}`,
    `    size: ${zip.length}`,
    'path: Nia-0.17.15-mac-arm64.zip'
  ].join('\n')
  const winYml = [
    'version: 0.17.15',
    'files:',
    '  - url: Nia-0.17.15-win-x64.exe',
    `    sha512: ${exeHash}`,
    `    size: ${exe.length}`,
    'path: Nia-0.17.15-win-x64.exe'
  ].join('\n')
  const map = {
    [`${origin}/latest-mac.yml`]: { body: macYml },
    [`${origin}/latest.yml`]: { body: winYml },
    [`${origin}/Nia-0.17.15-mac-arm64.zip`]: { body: zip },
    [`${origin}/Nia-0.17.15-mac-arm64.zip.blockmap`]: { body: 'bm' },
    [`${origin}/Nia-0.17.15-win-x64.exe`]: { body: exe },
    [`${origin}/Nia-0.17.15-win-x64.exe.blockmap`]: { body: 'bm' }
  }
  const result = await smokeReleaseFeed({ origin, fetchImpl: mockFetch(map) })
  assert.deepEqual(result.versions, ['0.17.15', '0.17.15'])
})

test('smokeReleaseFeed fails on sha512 mismatch', async () => {
  const origin = 'https://releases.okvevo.com'
  const zip = Buffer.from('zip-bytes')
  const macYml = [
    'version: 0.17.15',
    'files:',
    '  - url: Nia-0.17.15-mac-arm64.zip',
    '    sha512: not-the-hash',
    'path: Nia-0.17.15-mac-arm64.zip'
  ].join('\n')
  const map = {
    [`${origin}/latest-mac.yml`]: { body: macYml },
    [`${origin}/latest.yml`]: { body: 'version: 0.17.15\nfiles:\n  - url: Nia-0.17.15-win-x64.exe\n    sha512: x\npath: Nia-0.17.15-win-x64.exe' },
    [`${origin}/Nia-0.17.15-mac-arm64.zip`]: { body: zip },
    [`${origin}/Nia-0.17.15-mac-arm64.zip.blockmap`]: { body: 'bm' },
    [`${origin}/Nia-0.17.15-win-x64.exe`]: { body: 'e' },
    [`${origin}/Nia-0.17.15-win-x64.exe.blockmap`]: { body: 'bm' }
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
    '  - url: Nia-0.17.15-mac-arm64.zip',
    `    sha512: ${zipHash}`,
    'path: Nia-0.17.15-mac-arm64.zip'
  ].join('\n')
  const exe = Buffer.from('exe')
  const map = {
    [`${origin}/latest-mac.yml`]: { body: macYml },
    [`${origin}/latest.yml`]: {
      body: `version: 0.17.15\nfiles:\n  - url: Nia-0.17.15-win-x64.exe\n    sha512: ${sha512Base64(exe)}\npath: Nia-0.17.15-win-x64.exe`
    },
    [`${origin}/Nia-0.17.15-mac-arm64.zip`]: { body: zip },
    [`${origin}/Nia-0.17.15-win-x64.exe`]: { body: exe },
    [`${origin}/Nia-0.17.15-win-x64.exe.blockmap`]: { body: 'bm' }
  }
  await assert.rejects(() => smokeReleaseFeed({ origin, fetchImpl: mockFetch(map) }), /missing blockmap/)
})
