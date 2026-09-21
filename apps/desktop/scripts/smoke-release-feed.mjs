/**
 * Public GET smoke for the production electron-updater feed.
 *
 * Resolves yml `files[].url` against the feed origin root (binaries live at
 * bucket root even when the yml was read from versions/{ver}/).
 */
import {
  assertYmlArtifacts,
  parseElectronBuilderYml,
  publicFeedOrigin,
  siblingBlockmapName
} from './publish-release-feed.mjs'

export function feedFileUrl(origin, fileUrl) {
  const name = String(fileUrl || '')
  if (/^https?:\/\//i.test(name)) return name
  return `${String(origin).replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`
}

export async function smokeReleaseFeed({
  origin,
  ymlKeys = ['latest.yml', 'latest-mac.yml'],
  fetchImpl = globalThis.fetch
} = {}) {
  const feedOrigin = (origin || publicFeedOrigin()).replace(/\/+$/, '')
  const cache = new Map()

  async function get(rel) {
    const url = feedFileUrl(feedOrigin, rel)
    if (cache.has(url)) return cache.get(url)
    const res = await fetchImpl(url, { method: 'GET' })
    if (!res || !res.ok) {
      cache.set(url, null)
      return null
    }
    const body = Buffer.from(await res.arrayBuffer())
    cache.set(url, body)
    return body
  }

  const parsed = []
  for (const key of ymlKeys) {
    const ymlBuf = await get(key)
    if (ymlBuf == null) throw new Error(`GET ${feedFileUrl(feedOrigin, key)} failed`)
    const ymlText = ymlBuf.toString('utf8')
    const listed = parseElectronBuilderYml(ymlText)
    const names = new Set(listed.urls)
    for (const file of listed.files) names.add(file.url)
    if (listed.path) names.add(listed.path)
    for (const name of names) {
      await get(name)
      const blockmap = siblingBlockmapName(name)
      if (blockmap) await get(blockmap)
    }
    parsed.push(
      assertYmlArtifacts(ymlText, fileName => cache.get(feedFileUrl(feedOrigin, fileName)) ?? null)
    )
  }
  if (parsed.length === 2 && parsed[0].version !== parsed[1].version) {
    throw new Error(`mac version ${parsed[1].version} != win version ${parsed[0].version}`)
  }
  return { origin: feedOrigin, versions: parsed.map(p => p.version) }
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
  const origin = flag('--origin', process.argv) || publicFeedOrigin()
  const ymlKeys = flagAll('--yml', process.argv)
  smokeReleaseFeed({ origin, ymlKeys: ymlKeys.length ? ymlKeys : ['latest.yml', 'latest-mac.yml'] })
    .then(result => {
      console.log(JSON.stringify(result))
    })
    .catch(err => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
