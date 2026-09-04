import { type AppendMessage, ExportedMessageRepository } from '@assistant-ui/react'
import { AssistantRuntimeProvider, type ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useIncrementalExternalStoreRuntime } from '@/lib/incremental-external-store-runtime'

import { assistantMessage, stubThreadEnvironment, stubThreadViewportSize, userMessage } from '../test-utils'

import { Thread } from '.'

vi.mock('@/hooks/use-resize-observer', () => ({
  useResizeObserver(onResize: (entries: readonly ResizeObserverEntry[]) => void, ...refs: readonly { current: Element | null }[]) {
    useLayoutEffect(() => {
      for (const ref of refs) {
        const element = ref.current

        if (!element) {
          continue
        }

        onResize([
          {
            target: element,
            contentRect: {
              width: 400,
              height: 220,
              top: 0,
              left: 0,
              bottom: 220,
              right: 400,
              x: 0,
              y: 0,
              toJSON: () => ({})
            },
            borderBoxSize: [{ blockSize: 220, inlineSize: 400 }],
            contentBoxSize: [{ blockSize: 220, inlineSize: 400 }],
            devicePixelContentBoxSize: [{ blockSize: 220, inlineSize: 400 }]
          } as ResizeObserverEntry
        ])
      }
    }, [onResize, ...refs])
  }
}))

stubThreadEnvironment()
stubThreadViewportSize()

afterEach(() => {
  cleanup()
})

function LongMessageHarness({ onEdit }: { onEdit: (message: AppendMessage) => Promise<void> }) {
  const longPrompt = Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join('\n')
  const repository = ExportedMessageRepository.fromArray([userMessage('user-long', longPrompt), assistantMessage()])

  const runtime = useIncrementalExternalStoreRuntime<ThreadMessage>({
    messageRepository: repository,
    isRunning: false,
    setMessages: () => {},
    onNew: async () => {},
    onEdit,
    onCancel: async () => {},
    onReload: async () => {}
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  )
}

describe('long user message clamp', () => {
  it('shows See more for an overflowing prompt without opening edit', async () => {
    const { container } = render(<LongMessageHarness onEdit={async () => {}} />)

    const seeMore = await waitFor(() => screen.getByRole('button', { name: 'See more' }))

    fireEvent.click(seeMore)

    expect(container.querySelector('[data-slot="aui_edit-composer-root"]')).toBeFalsy()
    expect(screen.getByRole('button', { name: 'See less' })).toBeTruthy()
  })
})
