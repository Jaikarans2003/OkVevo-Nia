import { describe, expect, it } from 'vitest'

import { displayInstallPath, displayPath, displayWakePhrase, normalizeDisplayPath, pathLeaf, sanitizeUserFacingBrand } from './display-path'

describe('displayPath', () => {
  it('collapses a macOS home prefix to ~', () => {
    expect(displayPath('/Users/brooklyn/www/hermes-agent')).toBe('~/www/hermes-agent')
    expect(displayPath('/Users/brooklyn')).toBe('~')
  })

  it('collapses a Linux home prefix to ~', () => {
    expect(displayPath('/home/alice/src/app')).toBe('~/src/app')
  })

  it('collapses a Windows user profile to ~', () => {
    expect(displayPath('C:\\Users\\brooklyn\\src')).toBe('~/src')
    expect(displayPath('C:/Users/brooklyn')).toBe('~')
  })

  it('honours an explicit home override', () => {
    expect(displayPath('/opt/work/repo', { home: '/opt/work' })).toBe('~/repo')
    expect(displayPath('/elsewhere/repo', { home: '/opt/work' })).toBe('/elsewhere/repo')
  })

  it('leaves non-home absolute paths alone', () => {
    expect(displayPath('/var/log/system.log')).toBe('/var/log/system.log')
    expect(displayPath('/Users')).toBe('/Users')
  })

  it('normalizes separators and trailing slashes', () => {
    expect(normalizeDisplayPath('C:\\Users\\me\\src\\')).toBe('C:/Users/me/src')
    expect(displayPath('/Users/me/src/')).toBe('~/src')
  })

  it('keeps an already-tildified path', () => {
    expect(displayPath('~/www/app')).toBe('~/www/app')
    expect(displayPath('~')).toBe('~')
  })
})

describe('pathLeaf', () => {
  it('returns the last segment', () => {
    expect(pathLeaf('/Users/me/www/hermes-agent')).toBe('hermes-agent')
    expect(pathLeaf('~/www/hermes-agent')).toBe('hermes-agent')
    expect(pathLeaf('/')).toBe('/')
  })
})

describe('displayInstallPath', () => {
  it('nicknames the Hermes install root for display', () => {
    expect(displayInstallPath('/Users/karan/.hermes/hermes-agent')).toBe('/Users/karan/.nia/nia-agent')
    expect(displayInstallPath('~/.hermes/plugins/')).toBe('~/.nia/plugins/')
    expect(displayInstallPath('~/.hermes/config.yaml')).toBe('~/.nia/config.yaml')
  })

  it('leaves non-path strings and real commands alone', () => {
    expect(displayInstallPath('Hermes is ready')).toBe('Hermes is ready')
    expect(displayInstallPath('hermes desktop --force-build')).toBe('hermes desktop --force-build')
  })
})

describe('displayWakePhrase', () => {
  it('maps leftover hey hermes / hey nia / empty to ok nia', () => {
    expect(displayWakePhrase('hey hermes')).toBe('ok nia')
    expect(displayWakePhrase('hey nia')).toBe('ok nia')
    expect(displayWakePhrase('')).toBe('ok nia')
    expect(displayWakePhrase(undefined)).toBe('ok nia')
    expect(displayWakePhrase('  Hey Hermes  ')).toBe('ok nia')
  })

  it('keeps a custom phrase', () => {
    expect(displayWakePhrase('ok computer')).toBe('ok computer')
    expect(displayWakePhrase('ok nia')).toBe('ok nia')
  })
})

describe('sanitizeUserFacingBrand', () => {
  it('rewrites install paths and leftover product phrases', () => {
    expect(sanitizeUserFacingBrand('~/.hermes/profiles/default')).toBe('~/.nia/profiles/default')
    expect(sanitizeUserFacingBrand('The Hermes desktop app lives here')).toBe('The Nia desktop app lives here')
    expect(sanitizeUserFacingBrand('Hermes Agent can help')).toBe('Nia can help')
    expect(sanitizeUserFacingBrand('Say hey hermes to wake')).toBe('Say ok nia to wake')
    expect(sanitizeUserFacingBrand('Say hey nia to wake')).toBe('Say ok nia to wake')
    expect(sanitizeUserFacingBrand('Ask @hermes later')).toBe('Ask @nia later')
  })

  it('leaves protocol and SDK identifiers', () => {
    expect(sanitizeUserFacingBrand('open hermes://settings')).toBe('open hermes://settings')
    expect(sanitizeUserFacingBrand('import from @hermes/plugin-sdk')).toBe('import from @hermes/plugin-sdk')
  })
})
