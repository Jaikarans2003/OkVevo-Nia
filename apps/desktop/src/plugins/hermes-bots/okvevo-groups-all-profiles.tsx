/**
 * Workaround: groups_all_profiles (docs/okvevo/WORKAROUNDS.md)
 *
 * Description: the Bots roster lists gateway rooms with `groups.list` on the
 *   foreground profile only, and the gateway answers from that profile's own
 *   state.db, so a room hosted on another local profile ("CMO, CFO, CEO" on
 *   cfo) vanishes after a restart with a different profile in front. This adds
 *   the rooms of every other local profile on the same connection; each row
 *   keeps the binding of the profile that hosts it, so it opens there.
 * Bug: none filed yet (draft in docs/okvevo/WORKAROUNDS.md). Related, different:
 *   https://github.com/NousResearch/hermes-agent/issues/139002
 * Forwarded: no
 * Applied-Upstream: no
 * Last-Update: 2026-11-09
 *
 * Toggle off (okvevo.workarounds.groups_all_profiles: false) returns upstream's
 * useGatewayGroupRooms() unchanged.
 */

import { host, useQuery, useValue } from '@hermes/plugin-sdk'
import { useEffect, useMemo } from 'react'

import { $canonicalGroupBindings, type GatewayGroupRoom, useGatewayGroupRooms } from './canonical-group-registry'
import { type CanonicalGroupRoute, listCanonicalRooms } from './canonical-groups'
import { ID } from './shared'

declare const __OKVEVO_WORKAROUNDS__: Record<string, boolean> | undefined

export function groupsAllProfilesEnabled(): boolean {
  return typeof __OKVEVO_WORKAROUNDS__ === 'undefined' || __OKVEVO_WORKAROUNDS__.groups_all_profiles !== false
}

// Must match canonicalGroupKey() in canonical-group-registry.tsx (pinned by the test via parseCanonicalGroupKey).
function roomKey(route: CanonicalGroupRoute, roomId: string): string {
  return `canonical:${encodeURIComponent(route.connectionId)}:${encodeURIComponent(route.profile)}:${roomId}`
}

/** Rooms hosted on every other local profile of the foreground connection. A profile that fails to answer is skipped. */
export async function listOtherProfileRooms(foreground: CanonicalGroupRoute): Promise<GatewayGroupRoom[]> {
  const routes = (await host.profileRoutes())
    .filter(r => r.connectionId === foreground.connectionId && r.profile !== foreground.profile)
    .map(r => ({ connectionId: r.connectionId, profile: r.profile }))

  const results = await Promise.allSettled(routes.map(route => listCanonicalRooms(route)))

  return results.flatMap((result, index) =>
    result.status === 'fulfilled'
      ? result.value.map(room => ({
          binding: { ...routes[index], roomId: room.room_id, roomName: room.name },
          key: roomKey(routes[index], room.room_id),
          members: room.members ?? [],
          name: room.name,
          room,
          updatedAt: (room.updated_at ?? 0) * 1000
        }))
      : []
  )
}

export function useOkvevoGatewayGroupRooms(enabled = groupsAllProfilesEnabled()): GatewayGroupRoom[] {
  const foreground = useGatewayGroupRooms()
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)
  const gateway = useValue(host.state.gateway)
  const bindings = useValue($canonicalGroupBindings)
  const active = enabled && Boolean(connectionId && profile) && gateway === 'open'

  const { data, refetch } = useQuery({
    queryKey: [ID, 'okvevo-other-profile-group-rooms', connectionId, profile],
    enabled: active,
    queryFn: () => listOtherProfileRooms({ connectionId: connectionId!, profile }),
    refetchInterval: 10_000,
    retry: false,
    staleTime: 0
  })

  // A disband rewrites the bindings (forgetCanonicalGroup); re-read so a room disbanded on another profile drops now.
  // refetch() ignores `enabled`, hence the guard.
  useEffect(() => {
    if (active) {void refetch()}
  }, [active, bindings, refetch])

  return useMemo(() => {
    if (!enabled || !data?.length) {return foreground}
    const seen = new Set(foreground.map(room => room.room.room_id))

    return [...foreground, ...data.filter(room => !seen.has(room.room.room_id) && seen.add(room.room.room_id))]
  }, [data, enabled, foreground])
}
