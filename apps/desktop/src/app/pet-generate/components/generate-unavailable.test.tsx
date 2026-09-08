import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GenerateUnavailable } from './generate-unavailable'

const isByokChromeVisible = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/lib/build-channel', () => ({
  isByokChromeVisible
}))

describe('GenerateUnavailable BYOK chrome', () => {
  beforeEach(() => {
    isByokChromeVisible.mockReturnValue(true)
  })

  it('shows setup and OpenRouter links on the internal channel', () => {
    render(<GenerateUnavailable onSetup={() => undefined} />)

    expect(screen.getByRole('button', { name: 'Set up image generation' })).toBeTruthy()
    expect(screen.getByText('OpenRouter')).toBeTruthy()
    expect(screen.getByText('Nous Portal')).toBeTruthy()
  })

  it('hides setup and OpenRouter links on the public channel', () => {
    isByokChromeVisible.mockReturnValue(false)

    render(<GenerateUnavailable onSetup={() => undefined} />)

    expect(screen.queryByRole('button', { name: 'Set up image generation' })).toBeNull()
    expect(screen.queryByText('OpenRouter')).toBeNull()
    expect(screen.queryByText('Nous Portal')).toBeNull()
    expect(screen.getByText('Add an image backend to generate')).toBeTruthy()
  })
})
