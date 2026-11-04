import { describe, expect, it } from 'vitest'

import { displayName } from './labels'
import { defaultAgentLabelEnabled, scrubDefaultProfileIdName } from './okvevo-default-agent-label'

// Workaround default_agent_label (docs/okvevo/WORKAROUNDS.md): upstream's
// profiles.list synthesizes display_name: "default" for the default profile
// and that beat the "OkVevo agent" fallback. The vitest define carries the
// shipped defaults (toggle ON), so displayName assertions exercise the real
// hook; the OFF state is pinned through the guard's flags parameter.

const OFF = { default_agent_label: false }

describe('default_agent_label workaround', () => {
  it('toggle on: a default row named only by its profile id reads "OkVevo agent"', () => {
    expect(displayName({ name: 'default', display_name: 'default' })).toBe('OkVevo agent')
    expect(displayName({ name: 'default', display_name: 'DEFAULT' })).toBe('OkVevo agent')
    expect(displayName({ name: 'default', title: 'default' })).toBe('OkVevo agent')
  })

  it('toggle on: a real display name on the default profile still wins', () => {
    expect(displayName({ name: 'default', display_name: 'Chief of Staff' })).toBe('Chief of Staff')
  })

  it('toggle on: named profiles keep upstream labeling (id-derived display_name)', () => {
    expect(displayName({ name: 'ceo-testing', display_name: 'ceo-testing' })).toBe('ceo-testing')
  })

  it('toggle off: pure Hermes behavior — the guard is a no-op and the display_name rung renders', () => {
    expect(defaultAgentLabelEnabled(OFF)).toBe(false)

    const row = { name: 'default', display_name: 'default' }
    // Off = upstream's input reaches upstream's ladder untouched…
    expect(scrubDefaultProfileIdName(row, OFF)).toEqual(row)
    // …and the display_name rung renders any value the guard leaves in place
    // (here a non-matching value the armed guard has no opinion on).
    expect(displayName({ name: 'default', display_name: 'defaultx' })).toBe('defaultx')
  })

  it('enabled by default and when the flag is absent', () => {
    expect(defaultAgentLabelEnabled({})).toBe(true)
    expect(defaultAgentLabelEnabled({ default_agent_label: true })).toBe(true)
  })
})
