import assert from 'node:assert/strict'

import { test } from 'vitest'

import type { OkvevoAuthSession } from './okvevo-auth'
import { loadOkvevoAuthPending, loadOkvevoAuthSession, type OkvevoAuthStoreIo, persistOkvevoAuthPending, persistOkvevoAuthSession } from './okvevo-auth-store'

function fakeIo(initial: string | null = null): { io: OkvevoAuthStoreIo; text: () => string | null } {
  let text = initial

  const io: OkvevoAuthStoreIo = {
    encrypt: plaintext => ({ encoding: 'plain', value: plaintext }),
    decrypt: secret => (secret && typeof secret === 'object' && 'value' in secret ? String((secret as { value: string }).value) : ''),
    readStoreText: () => {
      if (text === null) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }

      return text
    },
    writeStoreText: next => {
      text = next
    }
  }

  return { io, text: () => text }
}

const SESSION: OkvevoAuthSession = {
  refreshToken: 'rt',
  idToken: 'idt',
  expiresAt: 9,
  uid: 'u1',
  email: 'a@b.c'
}

test('session survives persist then a fresh load', () => {
  const disk = fakeIo()

  persistOkvevoAuthSession(SESSION, disk.io)

  const restart = fakeIo(disk.text())

  assert.deepEqual(loadOkvevoAuthSession(restart.io), SESSION)
})

test('pending state round-trips and expires', () => {
  const disk = fakeIo()

  persistOkvevoAuthPending({ state: 'st', exp: 2_000 }, disk.io)
  assert.deepEqual(loadOkvevoAuthPending(disk.io, 1_000), { state: 'st', exp: 2_000 })
  assert.equal(loadOkvevoAuthPending(disk.io, 3_000), null)
})

test('persisting a session clears pending', () => {
  const disk = fakeIo()

  persistOkvevoAuthPending({ state: 'st', exp: 9_999 }, disk.io)
  persistOkvevoAuthSession(SESSION, disk.io)
  assert.equal(loadOkvevoAuthPending(disk.io, 0), null)
})

test('null session drops the secret', () => {
  const disk = fakeIo()

  persistOkvevoAuthSession(SESSION, disk.io)
  persistOkvevoAuthSession(null, disk.io)
  assert.equal(loadOkvevoAuthSession(disk.io), null)
})

test('persistSession throws when the store write fails', () => {
  const disk = fakeIo()

  disk.io.writeStoreText = () => {
    throw new Error('ENOSPC')
  }

  assert.throws(() => persistOkvevoAuthSession(SESSION, disk.io), /ENOSPC/)
  assert.equal(loadOkvevoAuthSession(disk.io), null)
})
