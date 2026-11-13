#!/usr/bin/env node
/**
 * Assert Windows ffmpeg primary URL is the OkVevo R2 mirror override,
 * not a rewrite of the upstream BTBN.url constant.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const text = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fetch-ffmpeg.mjs'), 'utf8')

assert.match(text, /OKVEVO_WIN_FFMPEG_MIRROR\s*=\s*'https:\/\/releases\.okvevo\.com\/deps\/ffmpeg'/)
assert.match(text, /github\.com\/BtbN\/FFmpeg-Builds\/releases\/download\//)
assert.doesNotMatch(text, /BTBN\.url\s*=\s*'https:\/\/releases\.okvevo\.com/)
assert.match(text, /346fd19f3afe98a8606da4fc2984c8b411297734dba101cd91ec961fa8b2f875/)
assert.match(text, /windowsMirrorBase\(/)
console.log('fetch-ffmpeg-win-mirror.selfcheck: ok')
