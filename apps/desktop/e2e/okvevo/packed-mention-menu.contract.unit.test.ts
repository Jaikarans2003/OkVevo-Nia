import { describe, expect, it } from 'vitest'

import { assertSettledOkvevoMentionText } from './packed-mention-menu.contract'

describe('assertSettledOkvevoMentionText', () => {
  const good = '@okvevo\nOkVevo agent\n@scout\nScout'

  it('accepts a settled menu with one @okvevo default-agent row', () => {
    expect(() => assertSettledOkvevoMentionText(good, 'ok')).not.toThrow()
  })

  it('fails while Looking up… (must wait in E2E before asserting)', () => {
    expect(() => assertSettledOkvevoMentionText('Looking up…', 'loading')).toThrow(/Looking up/)
  })

  it('fails when the @okvevo claim hook is disabled', () => {
    expect(() => assertSettledOkvevoMentionText('@hermes\nagent profile (primary)', 'hook-off')).toThrow(
      /missing @okvevo/
    )
  })

  it('fails when gateway @hermes/@default leak', () => {
    expect(() => assertSettledOkvevoMentionText('@okvevo\nOkVevo agent\n@hermes', 'hermes')).toThrow(/@hermes/)
    expect(() => assertSettledOkvevoMentionText('@okvevo\nOkVevo agent\n@default', 'default')).toThrow(/@default/)
  })
})
