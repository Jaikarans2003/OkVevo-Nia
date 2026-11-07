/**
 * Public GET smoke for the electron-updater feed: each yml's version, and every
 * listed installer answers HTTP 200 with the yml's sha512 and size.
 *
 * Resolves yml `files[].url` against the feed origin root (binaries live at
 * bucket root even when the yml was read from versions/{ver}/).
 */
import { feedFileUrl, publicFeedOrigin, verifyYmlsOverHttp } from './publish-release-feed.mjs'

export { feedFileUrl }

export async function smokeReleaseFeed({
  origin,
  ymlKeys = ['latest.yml', 'latest-mac.yml'],
  expectVersion = '',
  fetchImpl = globalThis.fetch
} = {}) {
  const feedOrigin = (origin || publicFeedOrigin()).replace(/\/+$/, '')
  const ymlTexts = []
  for (const key of ymlKeys) {
    const res = await fetchImpl(feedFileUrl(feedOrigin, key), { method: 'GET' })
    if (!res || res.status !== 200) throw new Error(`GET ${feedFileUrl(feedOrigin, key)} failed`)
    ymlTexts.push(await res.text())
  }
  const parsed = await verifyYmlsOverHttp({ origin: feedOrigin, ymlTexts, fetchImpl })
  const versions = parsed.map(p => p.version)
  if (new Set(versions).size > 1) throw new Error(`feed versions differ: ${versions.join(' != ')}`)
  if (expectVersion && versions[0] !== expectVersion) {
    throw new Error(`feed version ${versions[0]} != expected ${expectVersion}`)
  }
  return { origin: feedOrigin, versions }
}

function flagAll(name, argv) {
  const out = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1])
  }
  return out
}

function flag(name, argv) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : ''
}

const isMain = process.argv[1] && process.argv[1].endsWith('smoke-release-feed.mjs')

if (isMain) {
  const ymlKeys = flagAll('--yml', process.argv)
  smokeReleaseFeed({
    origin: flag('--origin', process.argv) || publicFeedOrigin(),
    ymlKeys: ymlKeys.length ? ymlKeys : ['latest.yml', 'latest-mac.yml'],
    expectVersion: flag('--version', process.argv)
  })
    .then(result => {
      console.log(JSON.stringify(result))
    })
    .catch(err => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
