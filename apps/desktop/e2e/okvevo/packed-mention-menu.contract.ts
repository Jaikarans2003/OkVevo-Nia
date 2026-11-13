/**
 * Settled `@` menu text contract for packed E2E.
 * Call only after Playwright has waited out "Looking up…".
 * Test-the-test: assertSettledOkvevoMentionText without @okvevo must throw
 * (simulates the mention claim hook disabled).
 */
export function assertSettledOkvevoMentionText(text: string, label: string): void {
  if (/Looking up/i.test(text)) {
    throw new Error(`${label}: listbox still loading (Looking up…)`)
  }

  if (!/@okvevo/.test(text)) {
    throw new Error(`${label}: missing @okvevo`)
  }

  if (!/OkVevo agent/.test(text)) {
    throw new Error(`${label}: missing OkVevo agent`)
  }

  if (/@hermes\b/.test(text)) {
    throw new Error(`${label}: gateway @hermes leaked`)
  }

  if (/@default\b/.test(text)) {
    throw new Error(`${label}: gateway @default leaked`)
  }

  if (/agent profile \(primary\)/.test(text)) {
    throw new Error(`${label}: agent profile (primary) leaked`)
  }

  const matches = text.match(/@okvevo/g) ?? []

  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly one @okvevo, got ${matches.length}`)
  }
}
