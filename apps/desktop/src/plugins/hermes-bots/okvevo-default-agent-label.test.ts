import { describe, expect, it } from 'vitest'

import { displayName } from './labels'
import { defaultAgentLabelEnabled } from './okvevo-default-agent-label'

// Workaround default_agent_label, removal check (docs/okvevo/WORKAROUNDS.md): the
// vitest define carries the shipped defaults, now toggle OFF. Hermes v0.23.0's
// profiles.list (`gateway/session_group_controls.py` `discovered()`) returns
// display_name '' for a profile.yaml without one (v0.22.4 returned the profile id),
// so upstream's own ladder must read "OkVevo agent" with no guard in the way.

describe('default_agent_label toggle off (pure Hermes v0.23.0 labeling)', () => {
  it('ships off', () => {
    expect(defaultAgentLabelEnabled()).toBe(false)
  })

  it('the default row as v0.23.0 lists it reads "OkVevo agent"', () => {
    expect(displayName({ name: 'default', display_name: '' })).toBe('OkVevo agent')
    expect(displayName({ name: 'default' })).toBe('OkVevo agent')
  })

  it('a real display name on the default profile still wins', () => {
    expect(displayName({ name: 'default', display_name: 'Chief of Staff' })).toBe('Chief of Staff')
  })
})
