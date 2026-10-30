import assert from 'node:assert/strict'
import inspector from 'node:inspector'
import { test } from 'vitest'

import { okvevoWorkaroundEnabled } from './okvevo-config-migration'
import { formatBlockStack, redactStackText, startOkvevoBlockStackWatchdog } from './okvevo-block-stack'

function okvevoDeliberateBlock(ms: number): void {
  const end = Date.now() + ms

  while (Date.now() < end) {
    // Busy loop: the main thread never yields.
  }
}

test('a 6s main-thread block is logged with the stack captured during it; no inspector port', async () => {
  const lines: string[] = []
  const dog = startOkvevoBlockStackWatchdog({ enabled: true, log: line => lines.push(line) })

  try {
    await new Promise(resolve => setTimeout(resolve, 500))
    okvevoDeliberateBlock(6_000)

    for (let i = 0; i < 100 && lines.length === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    const log = lines.join('\n')
    assert.match(log, /main-process blocked ≥5000ms; JS stack during the block/)
    assert.match(log, /okvevoDeliberateBlock/)
    assert.equal(inspector.url(), undefined, 'no inspector listener may be open')
  } finally {
    dog?.stop()
  }
}, 20_000)

test('toggle off starts nothing (upstream duration-only log stays)', () => {
  assert.equal(startOkvevoBlockStackWatchdog({ enabled: false, log: () => undefined }), null)
  assert.equal(okvevoWorkaroundEnabled({ okvevo: { workarounds: { event_loop_block_stack: false } } }, 'event_loop_block_stack'), false)
  assert.equal(okvevoWorkaroundEnabled({}, 'event_loop_block_stack'), true)
})

test('stack text drops query strings and secret-shaped values', () => {
  const text = redactStackText(
    'at f (file:///app/main.js?token=abc:1:2)\nOKVEVO_API_KEY=sk-live-123 Bearer abcdefghijklmnop eyJhbGciOiJub25l.eyJzdWIiOiIxMjM0.c2lnbmF0dXJlMTI'
  )
  assert.doesNotMatch(text, /token=abc|sk-live-123|abcdefghijklmnop|eyJhbGciOiJub25l/)
  assert.match(formatBlockStack({ type: 'native', blockedMs: 6000 }, 5000), /outside JavaScript/)
})
