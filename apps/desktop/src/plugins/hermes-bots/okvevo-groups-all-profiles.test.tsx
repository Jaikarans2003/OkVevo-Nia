import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $canonicalGroupBindings } from './canonical-group-registry'
import { translateBots } from './i18n-test-helper'
import { OkvevoCanonicalGroupList } from './okvevo-groups-all-profiles'

// Workaround groups_all_profiles: "CMO, CFO, CEO" is hosted on the cfo profile's
// state.db while default is in front after a restart (2026-10-30 evidence).
const { request, profileRoutes } = vi.hoisted(() => ({ request: vi.fn(), profileRoutes: vi.fn() }))
vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { en } = await import('@/i18n/en')

  return {
    ...sdk,
    host: {
      ...sdk.host,
      requestProfile: request,
      profileRoutes,
      state: {
        ...sdk.host.state,
        connectionId: sdk.atom<string | null>('local'),
        profile: sdk.atom('default'),
        gateway: sdk.atom('open')
      }
    },
    useI18n: () => ({ locale: 'en', t: en }),
    usePluginI18n: () => translateBots
  }
})

const hosted: Record<string, Array<{ room_id: string; name: string; members: [] }>> = {
  default: [],
  cfo: [{ room_id: 'd2e61ed5-daa0-464d-a1ca-d251193bc38a', name: 'CMO, CFO, CEO', members: [] }],
  cmo: [{ room_id: 'c1753c33-b0d7-4005-ad64-2a986daf33fc', name: 'CMO, CEO', members: [] }],
  ceo: []
}

beforeEach(() => {
  $canonicalGroupBindings.set({})
  request.mockReset()
  profileRoutes.mockReset().mockResolvedValue(
    Object.keys(hosted).map(profile => ({ connectionId: 'local', mode: 'local', profile, targetProfile: profile }))
  )
  request.mockImplementation(async (route: { profile: string }, method: string) => {
    if (method === 'groups.capabilities') {return { driver: true }}

    if (method === 'groups.list') {return { rooms: hosted[route.profile] ?? [], next_offset: null }}

    throw new Error(`unexpected ${method}`)
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('toggle on: rooms hosted on other local profiles are listed and open on their own profile', async () => {
  const onOpen = vi.fn()
  render(<OkvevoCanonicalGroupList enabled onOpen={onOpen} />)

  fireEvent.click(await screen.findByRole('button', { name: 'CMO, CFO, CEO' }))
  expect(screen.getByRole('button', { name: 'CMO, CEO' })).toBeTruthy()
  const [key] = onOpen.mock.calls[0]
  expect($canonicalGroupBindings.get()[key]).toMatchObject({ profile: 'cfo', roomName: 'CMO, CFO, CEO' })
})

it('toggle off: Hermes lists only the foreground profile (flip = upstream fixed it, remove the workaround)', async () => {
  render(<OkvevoCanonicalGroupList enabled={false} onOpen={vi.fn()} />)

  await vi.waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ profile: 'default' }), 'groups.list', expect.anything()))
  expect(screen.queryByRole('button', { name: 'CMO, CFO, CEO' })).toBeNull()
  expect(request.mock.calls.every(([route]) => route.profile === 'default')).toBe(true)
})
