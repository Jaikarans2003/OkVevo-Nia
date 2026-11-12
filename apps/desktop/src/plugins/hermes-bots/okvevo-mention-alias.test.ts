import { describe, expect, it } from 'vitest'

import { OKVEVO_DEFAULT_MENTION_HANDLES, okvevoDefaultMentionClaim } from './okvevo-mention-alias'

describe('okvevoDefaultMentionClaim', () => {
  it('always returns the @okvevo row with gateway twin handles', () => {
    expect(okvevoDefaultMentionClaim('')).toEqual({
      insert: '@okvevo',
      display: '@okvevo',
      meta: 'OkVevo agent',
      handles: [...OKVEVO_DEFAULT_MENTION_HANDLES]
    })
  })

  it('matches okvevo / default / hermes / nia prefixes', () => {
    for (const q of ['o', 'ok', 'def', 'her', 'ni']) {
      expect(okvevoDefaultMentionClaim(q)?.insert).toBe('@okvevo')
    }
  })

  it('returns null for unrelated prefixes', () => {
    expect(okvevoDefaultMentionClaim('zzz')).toBeNull()
  })
})
