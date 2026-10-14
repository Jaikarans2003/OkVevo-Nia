import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestForOwnedSession } from '@/store/session-states'

import { SubagentControls } from './subagent-controls'

vi.mock('@/store/session-states', () => ({
  requestForOwnedSession: vi.fn()
}))

const request = vi.mocked(requestForOwnedSession)

describe('SubagentControls', () => {
  afterEach(() => {
    cleanup()
    request.mockReset()
  })

  it('queues a steer and clears the field', async () => {
    request.mockResolvedValue({ status: 'queued' })

    render(<SubagentControls sessionId="parent-1" subagentId="sa-1" />)
    fireEvent.change(screen.getByLabelText('Instructions for this subagent'), {
      target: { value: 'check the logs' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Steer' }))

    expect(await screen.findByText('Queued for the next checkpoint')).toBeTruthy()
    expect(request).toHaveBeenCalledWith(
      'parent-1',
      expect.any(Function),
      'subagent.steer',
      { session_id: 'parent-1', subagent_id: 'sa-1', text: 'check the logs' }
    )
    expect(screen.getByLabelText('Instructions for this subagent')).toHaveProperty('value', '')
  })

  it('asks the owner to stop', async () => {
    request.mockResolvedValue({ found: true })

    render(<SubagentControls sessionId="parent-1" subagentId="sa-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByText('Stop requested')).toBeTruthy()
    expect(request).toHaveBeenCalledWith('parent-1', expect.any(Function), 'subagent.interrupt', {
      session_id: 'parent-1',
      subagent_id: 'sa-1'
    })
  })

  it('shows a rejection when the sub-task does not accept the request', async () => {
    request.mockResolvedValue({ status: 'rejected' })

    render(<SubagentControls sessionId="parent-1" subagentId="sa-1" />)
    fireEvent.change(screen.getByLabelText('Instructions for this subagent'), {
      target: { value: 'nope' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Steer' }))

    expect(await screen.findByText('The subagent did not accept the request')).toBeTruthy()
  })
})
