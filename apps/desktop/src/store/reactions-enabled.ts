/**
 * Message reactions (iMessage-style tapbacks) — opt-in.
 *
 * On by default (OkVevo-locked). Presentation-scoped, so the renderer owns it
 * (desktop AGENTS.md: state lives with its authority).
 *
 * Gates the UI only — persisted reactions still render if the data exists
 * (a reaction you set before turning it off shouldn't vanish from history).
 */

import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'
import { mirrorDisplayToggle } from '@/store/display-toggles'

import { recordFeatureToggle } from './desktop-metrics'

const KEY = 'hermes.desktop.reactions.v1'

export const $reactionsEnabled = atom<boolean>(typeof window === 'undefined' ? true : storedString(KEY) !== 'off')

export function setReactionsEnabled(enabled: boolean): void {
  recordFeatureToggle('reactions', $reactionsEnabled.get(), enabled)
  $reactionsEnabled.set(enabled)
}

if (typeof window !== 'undefined') {
  $reactionsEnabled.listen(enabled => persistString(KEY, enabled ? 'on' : 'off'))
}

// The backend gates the agent's react_to_message tool and the model-context
// annotation on display.message_reactions, so this toggle is the one lever.
mirrorDisplayToggle('display.message_reactions', KEY, $reactionsEnabled)
