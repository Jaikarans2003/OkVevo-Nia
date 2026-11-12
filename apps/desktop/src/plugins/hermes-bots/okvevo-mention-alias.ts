/**
 * Display-only default-agent @ claim. Gateway still emits @default / @hermes;
 * twin handles retire those rows in mergeCompletionEntries. Wire handles stay
 * unchanged — do not patch tui_gateway/methods_complete.py.
 */

export const OKVEVO_DEFAULT_MENTION_HANDLES = ['@default', '@hermes', '@nia'] as const

export interface OkvevoMentionClaim {
  insert: '@okvevo'
  display: '@okvevo'
  meta: 'OkVevo agent'
  handles: string[]
}

/** Always emit when the typed prefix could match the default agent (incl. cold / self-focused). */
export function okvevoDefaultMentionClaim(query = ''): OkvevoMentionClaim | null {
  const q = (query || '').toLowerCase()

  if (
    q &&
    !'okvevo'.startsWith(q) &&
    !'default'.startsWith(q) &&
    !'hermes'.startsWith(q) &&
    !'nia'.startsWith(q)
  ) {
    return null
  }

  return {
    insert: '@okvevo',
    display: '@okvevo',
    meta: 'OkVevo agent',
    handles: [...OKVEVO_DEFAULT_MENTION_HANDLES]
  }
}
