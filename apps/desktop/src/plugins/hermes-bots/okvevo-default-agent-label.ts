/**
 * Workaround: default_agent_label (docs/okvevo/WORKAROUNDS.md)
 *
 * Description: the default bot shows as "default" instead of "OkVevo agent".
 *   Upstream's profiles.list (`gateway/session_group_controls.py`
 *   `discovered()`) synthesizes `display_name: <profile id>` for rows whose
 *   profile.yaml sets no display name, and labels.ts lets that beat the
 *   "OkVevo agent" fallback. This guard treats a display_name/title that is
 *   just the default profile's id as no name, so the fallback wins again.
 * Bug: none filed yet (upstream's own fallback is "Hermes agent"-branded, so
 *   the rung order is only wrong for white-label forks; draft in
 *   docs/okvevo/WORKAROUNDS.md).
 * Forwarded: no
 * Applied-Upstream: no
 * Last-Update: 2026-11-03
 *
 * Toggle off (okvevo.workarounds.default_agent_label: false) renders upstream's
 * labels unchanged.
 */

import type { RosterRow } from './types'

declare const __OKVEVO_WORKAROUNDS__: Record<string, boolean> | undefined

export function defaultAgentLabelEnabled(workarounds?: Record<string, boolean>): boolean {
  const flags =
    workarounds ?? (typeof __OKVEVO_WORKAROUNDS__ === 'undefined' ? undefined : __OKVEVO_WORKAROUNDS__)

  return flags?.default_agent_label !== false
}

/** A default-profile row whose "name" is only the profile id carries no name.
 *  Scrub those two fields so the displayName fallback ("OkVevo agent") runs.
 *  Named profiles keep upstream behavior: their id-derived display_name is how
 *  upstream labels a bot its user never named. */
export function scrubDefaultProfileIdName<T extends Partial<RosterRow>>(bot: T, workarounds?: Record<string, boolean>): T {
  if (!bot || !defaultAgentLabelEnabled(workarounds)) {
    return bot
  }

  const id = (bot.name || '').trim().toLowerCase()
  if (id !== 'default') {
    return bot
  }

  const scrubbed = { ...bot }
  if ((scrubbed.display_name || '').trim().toLowerCase() === id) {
    scrubbed.display_name = ''
  }
  if (typeof scrubbed.title === 'string' && scrubbed.title.trim().toLowerCase() === id) {
    scrubbed.title = ''
  }

  return scrubbed
}
