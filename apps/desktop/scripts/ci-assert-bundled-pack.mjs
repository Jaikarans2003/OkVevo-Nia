/**
 * After a pack: stamp is bundled, the agent payload is in Resources, and the
 * baked feed URL is the module URL for this channel. When a prefix was
 * uploaded, that URL is https://releases.okvevo.com/ plus that prefix.
 */
import fs from 'node:fs'
import path from 'node:path'

import { RELEASES_ORIGIN, feedFor } from './okvevo-feed-urls.mjs'

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] || '' : ''
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

const resources = arg('--resources')
const target = arg('--target')
const prefix = arg('--prefix').replace(/^\/+|\/+$/g, '')
if (!resources) fail('missing --resources')

const feed = feedFor(target)
const stampPath = path.join(resources, 'install-stamp.json')
const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'))
if (stamp.payload !== 'bundled') {
  fail(`install-stamp payload is ${JSON.stringify(stamp.payload)}, expected bundled`)
}

const payload = path.join(resources, 'agent-payload')
if (!fs.existsSync(payload) || !fs.statSync(payload).isDirectory()) {
  fail(`missing bundled agent payload at ${payload}`)
}

const pack = JSON.parse(fs.readFileSync(path.join(resources, 'okvevo-pack-env.json'), 'utf8'))
const baked = String(pack.OKVEVO_UPDATE_FEED_URL || '').replace(/\/+$/, '')
if (baked !== feed.url) {
  fail(`baked feed ${baked} != ${feed.url}`)
}
if (prefix) {
  const folder = `${RELEASES_ORIGIN}/${prefix}`
  if (baked !== folder) fail(`baked feed ${baked} != folder ${folder}`)
  if (prefix !== feed.prefix) fail(`upload prefix ${prefix} != module prefix ${feed.prefix}`)
}

console.log(`bundled pack ok ${baked}`)
