/**
 * Build-machine channel for BYOK chrome. Call only from vite.config /
 * bundle-electron-main — the result is baked as __NIA_BUILD_CHANNEL__.
 * Fail closed: anything other than exact `internal` is `public`.
 * `--dev` / vite serve default internal when the env is unset.
 *
 * @param {{ env?: Record<string, string | undefined>, isDev?: boolean }} [opts]
 * @returns {'internal' | 'public'}
 */
export function resolveBuildChannel({ env = process.env, isDev = false } = {}) {
  const raw = env.NIA_BUILD_CHANNEL
  if (raw === 'internal') return 'internal'
  if (raw == null || raw === '') return isDev ? 'internal' : 'public'
  return 'public'
}
