/**
 * Empty bot chat Wordmark follows displayName — untitled default reads Nia.
 */

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { $botMeta, $lastRoster, hostMock, useValueMock } = vi.hoisted(() => ({
  $botMeta: { id: 'bot-meta' },
  $lastRoster: { id: 'last-roster' },
  hostMock: { state: { focusedStoredSessionId: { get: () => 's1' } } },
  useValueMock: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', () => ({
  host: hostMock,
  useValue: useValueMock,
  Wordmark: ({ text }: { text: string }) => <span data-testid="wordmark">{text}</span>
}))

vi.mock('./avatar', () => ({
  avatarColor: () => '#000',
  botAppearance: () => ({ color: null, image: null, shape: 'circle' }),
  BotFace: () => null
}))

vi.mock('./avatar-image', () => ({ isBackfilledFacePng: () => false }))

vi.mock('./data', () => ({
  $botMeta,
  $lastRoster
}))

vi.mock('./i18n', () => ({
  useBots: () => ({ bot: { chatEmpty: 'Say something to get started.' } })
}))

vi.mock('./routing', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>

  return {
    ...actual,
    botRosterMeta: () => null
  }
})

import { BotChatEmpty } from './chat-empty'
import { displayName } from './labels'

describe('BotChatEmpty wordmark', () => {
  it('paints untitled default as Nia, not Hermes', () => {
    expect(displayName({ name: 'default' }, null)).toBe('Nia')

    useValueMock.mockImplementation(store => {
      if (store === $lastRoster) {
        return [{ canonical_session: { id: 's1' }, name: 'default' }]
      }

      if (store === $botMeta) {
        return {}
      }

      return 's1'
    })

    const { getByTestId, getByText } = render(<BotChatEmpty sessionId="s1" />)

    expect(getByTestId('wordmark').textContent).toBe('Nia')
    expect(getByText('Say something to get started.')).toBeTruthy()
  })
})
