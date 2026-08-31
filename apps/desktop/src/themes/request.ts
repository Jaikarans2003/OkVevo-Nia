/**
 * Imperative theme switching used to drain `$pendingSkinApply` into
 * `setTheme`. Nia ships one fixed look, so this is a no-op.
 */

/**
 * Ask for a theme switch from outside React. Always refused — there is no
 * picker and no drain.
 */
export function requestTheme(_name: string): boolean {
  return false
}
