import { describe, expect, it } from 'vitest'

import { INSTALLER_URL, RELEASE_NOTES_URL, resolveAboutStatusKind } from './about-settings'

describe('About installer links', () => {
  it('sends users to okvevo.com, never GitHub', () => {
    expect(INSTALLER_URL).toBe('https://www.okvevo.com')
    expect(RELEASE_NOTES_URL).toBe('https://www.okvevo.com')
    expect(INSTALLER_URL).not.toMatch(/github\.com/i)
    expect(RELEASE_NOTES_URL).not.toMatch(/github\.com/i)
  })
})

const current = {
  applying: false,
  error: undefined as string | undefined,
  hasStatus: true,
  supported: true,
  updateAvailable: false
}

describe('resolveAboutStatusKind', () => {
  it('does not claim latest when the packaged shell is stale', () => {
    expect(resolveAboutStatusKind({ ...current, bundleOutOfSync: true })).toBe('bundleOutOfSync')
  })

  it('still prefers a real update over the skew banner', () => {
    expect(resolveAboutStatusKind({ ...current, bundleOutOfSync: true, updateAvailable: true })).toBe('available')
  })

  it('says latest only when the check succeeded and the shell is in sync', () => {
    expect(resolveAboutStatusKind({ ...current, bundleOutOfSync: false })).toBe('onLatest')
  })
})
