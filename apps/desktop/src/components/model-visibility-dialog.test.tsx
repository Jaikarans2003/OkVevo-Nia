import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelVisibilityDialog } from './model-visibility-dialog'

const isByokChromeVisible = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/lib/build-channel', () => ({
  isByokChromeVisible
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      common: { close: 'Close' },
      modelVisibility: {
        addProvider: 'Add provider…',
        noAuthenticatedProviders: 'No authenticated providers.',
        search: 'Search models',
        title: 'Models'
      }
    }
  })
}))

vi.mock('@/lib/model-options', () => ({
  modelOptionsQueryKey: () => ['model-options'],
  requestModelOptions: async () => ({ providers: [] })
}))

function wrap(node: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {node}
    </QueryClientProvider>
  )
}

describe('ModelVisibilityDialog Add provider', () => {
  beforeEach(() => {
    isByokChromeVisible.mockReturnValue(true)
  })

  it('shows Add provider on the internal channel', async () => {
    render(wrap(<ModelVisibilityDialog onOpenChange={() => undefined} onOpenProviders={() => undefined} open />))

    expect(await screen.findByRole('button', { name: 'Add provider…' })).toBeTruthy()
  })

  it('omits Add provider on the public channel', async () => {
    isByokChromeVisible.mockReturnValue(false)

    render(wrap(<ModelVisibilityDialog onOpenChange={() => undefined} onOpenProviders={() => undefined} open />))

    expect(await screen.findByText('No authenticated providers.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add provider…' })).toBeNull()
  })
})
