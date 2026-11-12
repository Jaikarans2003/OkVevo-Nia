import type * as HermesSdk from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $canonicalGroupBindings, bindGatewayGroupRoom, parseCanonicalGroupKey } from './canonical-group-registry'
import { useOkvevoGatewayGroupRooms } from './okvevo-groups-all-profiles'

// Workaround groups_all_profiles: "CMO, CFO, CEO" is hosted on the cfo profile's
// state.db while default is in front after a restart (2026-10-30 evidence).
const { request, profileRoutes } = vi.hoisted(() => ({ request: vi.fn(), profileRoutes: vi.fn() }))
vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

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
    }
  }
})

const hosted: Record<string, Array<{ room_id: string; name: string; members: [] }>> = {
  default: [],
  cfo: [{ room_id: 'd2e61ed5-daa0-464d-a1ca-d251193bc38a', name: 'CMO, CFO, CEO', members: [] }],
  cmo: [{ room_id: 'c1753c33-b0d7-4005-ad64-2a986daf33fc', name: 'CMO, CEO', members: [] }],
  ceo: []
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

beforeEach(() => {
  $canonicalGroupBindings.set({})
  request.mockReset()
  profileRoutes.mockReset().mockResolvedValue(
    Object.keys(hosted).map(profile => ({ connectionId: 'local', mode: 'local', profile, targetProfile: profile }))
  )
  request.mockImplementation(async (route: { profile: string }, method: string) => {
    if (method === 'groups.list') {return { rooms: hosted[route.profile] ?? [], next_offset: null }}

    throw new Error(`unexpected ${method}`)
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('toggle on: rooms hosted on other local profiles are listed and open on their own profile', async () => {
  const { result } = renderHook(() => useOkvevoGatewayGroupRooms(true), { wrapper })

  await vi.waitFor(() => expect(result.current.map(room => room.name).sort()).toEqual(['CMO, CEO', 'CMO, CFO, CEO']))
  const cfoRoom = result.current.find(room => room.name === 'CMO, CFO, CEO')!
  // The key format must stay the one upstream parses, or the row would open nowhere.
  expect(parseCanonicalGroupKey(cfoRoom.key)).toEqual({ connectionId: 'local', profile: 'cfo', roomId: cfoRoom.room.room_id })
  const key = bindGatewayGroupRoom(cfoRoom)
  expect(key).toBe(cfoRoom.key)
  expect($canonicalGroupBindings.get()[key]).toMatchObject({ profile: 'cfo', roomName: 'CMO, CFO, CEO' })
})

it('toggle off: Hermes lists only the foreground profile (flip = upstream fixed it, remove the workaround)', async () => {
  const { result } = renderHook(() => useOkvevoGatewayGroupRooms(false), { wrapper })

  await vi.waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ profile: 'default' }), 'groups.list', expect.anything()))
  expect(result.current.map(room => room.name)).not.toContain('CMO, CFO, CEO')
  expect(request.mock.calls.every(([route]) => route.profile === 'default')).toBe(true)
})
