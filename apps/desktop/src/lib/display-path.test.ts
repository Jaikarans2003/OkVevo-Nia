import { describe, expect, it } from 'vitest'

import { displayInstallPath, displayPath, normalizeDisplayPath, pathLeaf } from './display-path'

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
