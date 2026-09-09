// Bug #2: the Branch-in-new-chat button used to render unconditionally even
// when its handler was a no-op (session-tile.tsx passed `() => undefined`
// for branched/tiled chats, where nested branching isn't supported). That
// left a visibly clickable button that silently did nothing. The fix makes
// AssistantMessage's action bar hide the button entirely when no handler is
// supplied, matching how onDismissError/onRestoreToMessage already behave.
import { AssistantRuntimeProvider, type ThreadMessage, useExternalStoreRuntime } from '@assistant-ui/react'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $displayTimestamps } from '@/store/display-timestamps'

import { stubThreadEnvironment } from '../test-utils'

import { formatTimelineRange, formatTimelineTimestamp } from './timestamp'

import { Thread } from '.'

const isByokChromeVisible = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/lib/build-channel', () => ({
  isByokChromeVisible
}))

// Timeline timestamps render only when `display.timestamps` is enabled.
$displayTimestamps.set(true)

const createdAt = new Date('2026-05-01T00:00:00.000Z')
const completedAt = createdAt.getTime() / 1000 + 1.25
stubThreadEnvironment()

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  isByokChromeVisible.mockReturnValue(true)
  window.hermesDesktop = {
    ...window.hermesDesktop,
    logsRoot: async () => '/tmp/logs'
  } as Window['hermesDesktop']
})

function userMessage(): ThreadMessage {
  return {
    id: 'user-1',
    role: 'user',
    content: [{ type: 'text', text: 'question one' }],
    attachments: [],
    createdAt,
    metadata: { custom: { timelineTimestamp: createdAt.getTime() / 1000 } }
  } as unknown as ThreadMessage
}

function assistantMessage(): ThreadMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: [
      {
        type: 'reasoning',
        text: 'checked carefully',
        timestamp: createdAt.getTime() / 1000 + 0.05,
        completedAt: createdAt.getTime() / 1000 + 0.1
      },
      {
        type: 'text',
        text: 'done',
        timestamp: createdAt.getTime() / 1000 + 0.125,
        completedAt: createdAt.getTime() / 1000 + 0.5
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { timelineCompletedAt: completedAt, timelineTimestamp: createdAt.getTime() / 1000 }
    }
  } as unknown as ThreadMessage
}

function assistantErrorMessage(): ThreadMessage {
  return {
    id: 'assistant-error-1',
    role: 'assistant',
    content: [],
    status: { type: 'incomplete', reason: 'error', error: 'Provider rejected the request.' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        errorSurface: { layer: 'provider', retryable: true }
      }
    }
  } as unknown as ThreadMessage
}

function Harness({
  assistant = assistantMessage(),
  onBranchInNewChat
}: {
  assistant?: ThreadMessage
  onBranchInNewChat?: (messageId: string) => void
}) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages: [userMessage(), assistant],
    isRunning: false,
    onNew: async () => {}
  })

  return (
    <MemoryRouter>
      <AssistantRuntimeProvider runtime={runtime}>
        <Thread onBranchInNewChat={onBranchInNewChat} />
      </AssistantRuntimeProvider>
    </MemoryRouter>
  )
}

describe('AssistantMessage branch button visibility (bug #2 fix)', () => {
  it('shows the Branch in new chat button when a handler is provided (open chat)', async () => {
    render(<Harness onBranchInNewChat={() => undefined} />)

    expect(await screen.findByRole('button', { name: 'Branch in new chat' })).toBeTruthy()
  })

  it('hides the Branch in new chat button when no handler is provided (session-tile / branched chat)', async () => {
    render(<Harness />)

    // Wait for the assistant message to actually mount before asserting
    // absence, so a missing button isn't just a false negative from an
    // unrendered message.
    await screen.findByText('done')

    expect(screen.queryByRole('button', { name: 'Branch in new chat' })).toBeNull()
  })
})

describe('ErrorRecoveryActions channel chrome', () => {
  it('keeps Switch provider / Open logs / Copy error details on internal', async () => {
    render(<Harness assistant={assistantErrorMessage()} />)

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Switch provider' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open logs' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy error details' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send diagnostics' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /help@okvevo\.com/i })).toBeNull()
  })

  it('shows help email only on public (hides Switch provider / Open logs / Copy)', async () => {
    isByokChromeVisible.mockReturnValue(false)
    render(<Harness assistant={assistantErrorMessage()} />)

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Switch provider' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open logs' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy error details' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send diagnostics' })).toBeNull()

    const help = screen.getByRole('link', { name: /help@okvevo\.com/i })
    expect(help.getAttribute('href')).toBe('mailto:help@okvevo.com')
  })
})

describe('message timeline timestamps', () => {
  it('always renders precise user and assistant lifecycle times', async () => {
    const { container } = render(<Harness />)

    await screen.findByText('done')

    const stamps = Array.from(container.querySelectorAll('[data-slot="timeline-timestamp"]')).map(node =>
      node.textContent?.trim()
    )

    const startedAt = createdAt.getTime() / 1000

    expect(stamps).toContain(formatTimelineTimestamp(startedAt))
    expect(stamps).toContain(formatTimelineRange(startedAt, completedAt))
    expect(stamps).toContain(formatTimelineRange(startedAt + 0.05, startedAt + 0.1))
    expect(stamps).toContain(formatTimelineRange(startedAt + 0.125, startedAt + 0.5))
  })

  it('suppresses an aggregate assistant stamp that exactly duplicates its sole part', async () => {
    const startedAt = createdAt.getTime() / 1000

    const assistant = {
      ...assistantMessage(),
      content: [{ completedAt, text: 'done', timestamp: startedAt, type: 'text' }]
    } as unknown as ThreadMessage

    const { container } = render(<Harness assistant={assistant} />)

    await screen.findByText('done')

    const stamps = Array.from(container.querySelectorAll('[data-slot="timeline-timestamp"]')).map(node =>
      node.textContent?.trim()
    )

    expect(stamps.filter(stamp => stamp === formatTimelineRange(startedAt, completedAt))).toHaveLength(1)
  })
})
