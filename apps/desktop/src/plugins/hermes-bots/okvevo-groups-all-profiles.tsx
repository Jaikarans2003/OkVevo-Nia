/**
 * Workaround: groups_all_profiles (docs/okvevo/WORKAROUNDS.md)
 *
 * Description: the Bots group list asks `groups.list` on the foreground
 *   profile only, so a room hosted on another local profile ("CMO, CFO, CEO"
 *   on cfo) vanishes after a restart with a different profile in front. This
 *   lists rooms from every local profile on the same connection once the
 *   gateway is open; each row opens on the profile that hosts it.
 * Bug: none filed yet (draft in docs/okvevo/WORKAROUNDS.md). Related, different:
 *   https://github.com/NousResearch/hermes-agent/issues/139002
 * Forwarded: no
 * Applied-Upstream: no
 * Last-Update: 2026-10-30
 *
 * Toggle off (okvevo.workarounds.groups_all_profiles: false) renders upstream's
 * CanonicalGroupList unchanged.
 */

import { Button, host, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import { useCanonicalGroupLabels } from './canonical-group-labels'
import { CanonicalGroupList, type CanonicalGroupOrigin, registerCanonicalGroup } from './canonical-group-registry'
import { captureCanonicalGroupRoute, discoverCanonicalGroups } from './canonical-groups'
import type { CanonicalGroupRoute, CanonicalRoom } from './canonical-groups'

declare const __OKVEVO_WORKAROUNDS__: Record<string, boolean> | undefined

export function groupsAllProfilesEnabled(): boolean {
  return typeof __OKVEVO_WORKAROUNDS__ === 'undefined' || __OKVEVO_WORKAROUNDS__.groups_all_profiles !== false
}

/** Foreground rooms first, then every other profile on the same connection; first room_id wins. */
export async function discoverGroupsAllProfiles(
  route: CanonicalGroupRoute
): Promise<Array<{ room: CanonicalRoom; route: CanonicalGroupRoute }>> {
  const routes: CanonicalGroupRoute[] = [route]

  try {
    for (const candidate of await host.profileRoutes()) {
      if (candidate.connectionId === route.connectionId && !routes.some(r => r.profile === candidate.profile)) {
        routes.push({ connectionId: candidate.connectionId, profile: candidate.profile })
      }
    }
  } catch {
    // No route inventory: the foreground list alone, as upstream.
  }

  const results = await Promise.allSettled(routes.map(r => discoverCanonicalGroups(r)))

  if (results[0].status === 'rejected') {
    throw results[0].reason
  }

  const seen = new Set<string>()
  const rooms: Array<{ room: CanonicalRoom; route: CanonicalGroupRoute }> = []

  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') {
      return
    }

    for (const room of result.value.rooms) {
      if (!seen.has(room.room_id)) {
        seen.add(room.room_id)
        rooms.push({ room, route: routes[index] })
      }
    }
  })

  return rooms
}

function AllProfilesGroupList({ onOpen }: { onOpen: (key: string, origin: CanonicalGroupOrigin) => void }) {
  const labels = useCanonicalGroupLabels()
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)
  const gateway = useValue(host.state.gateway)
  const [rooms, setRooms] = useState<Array<{ key: string; name: string }>>([])
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    setRooms([])
    setError('')

    if (gateway !== 'open') {
      return
    }

    void (async () => {
      const found = await discoverGroupsAllProfiles(captureCanonicalGroupRoute())

      if (!cancelled) {
        setRooms(found.map(({ room, route }) => ({ key: registerCanonicalGroup(route, room), name: room.name })))
      }
    })().catch(e => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })

    return () => {
      cancelled = true
    }
  }, [connectionId, profile, gateway, refresh])

  return (
    <div className="grid gap-1 px-2">
      <Button onClick={() => setRefresh(value => value + 1)} variant="ghost">
        {labels.refreshGroups}
      </Button>
      {error && <p role="alert">{error}</p>}
      {rooms.map(room => (
        <Button key={room.key} onClick={() => onOpen(room.key, 'key')} variant="ghost">
          {room.name}
        </Button>
      ))}
    </div>
  )
}

export function OkvevoCanonicalGroupList({
  enabled = groupsAllProfilesEnabled(),
  onOpen
}: {
  enabled?: boolean
  onOpen: (key: string, origin: CanonicalGroupOrigin) => void
}) {
  return enabled ? <AllProfilesGroupList onOpen={onOpen} /> : <CanonicalGroupList onOpen={onOpen} />
}
