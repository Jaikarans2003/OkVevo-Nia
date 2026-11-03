/**
 * Build-machine flag for the packed-app E2E sign-in hook. Call only from
 * bundle-electron-main — the result is baked as __OKVEVO_E2E_AUTH__.
 * Fail closed: anything other than exact `1`/`true` is off, so public packs
 * (staging/production) strip the hook.
 *
 * @param {{ env?: Record<string, string | undefined> }} [opts]
 * @returns {boolean}
 */
export function resolveE2eAuth({ env = process.env } = {}) {
  const raw = env.OKVEVO_E2E_AUTH
  return raw === '1' || raw === 'true'
}

// The production electron-main bundle is NOT minified, so esbuild keeps dead
// `if (false)` branches — the E2E hook's IPC channel and bridge name would
// survive as plain strings in a customer pack. Strip the delimited source
// regions entirely for public builds so no marker of the hook ships.

const BEGIN = '// okvevo-e2e-auth:begin'
const END = '// okvevo-e2e-auth:end'

/**
 * Remove every BEGIN…END region from a source file. Public builds only.
 * Throws if markers are unbalanced (a region was edited and left open).
 *
 * @param {string} text
 * @param {string} [file] for error messages
 * @returns {string}
 */
export function stripE2eAuthRegions(text, file = 'source') {
  if (!text.includes(BEGIN)) {
    if (text.includes(END)) throw new Error(`${file}: e2e-auth end marker without begin`)
    return text
  }
  const lines = text.split('\n')
  const out = []
  let depth = 0
  let stripped = 0
  for (const line of lines) {
    if (line.includes(BEGIN)) {
      depth += 1
      stripped += 1
      continue
    }
    if (line.includes(END)) {
      depth -= 1
      if (depth < 0) throw new Error(`${file}: e2e-auth end marker without begin`)
      continue
    }
    if (depth === 0) out.push(line)
  }
  if (depth !== 0) throw new Error(`${file}: unclosed e2e-auth region (begin without end)`)
  if (stripped === 0) throw new Error(`${file}: e2e-auth begin marker found but no region stripped`)
  return out.join('\n')
}

/**
 * esbuild plugin that strips the E2E sign-in hook from every module for
 * public builds. Enabled only when resolveE2eAuth() is false; the e2e pack
 * variant builds without this plugin and keeps the hook.
 *
 * @returns {import('esbuild').Plugin}
 */
export function e2eAuthStripPlugin() {
  return {
    name: 'okvevo-e2e-auth-strip',
    setup(buildApi) {
      buildApi.onLoad({ filter: /\.ts$/ }, async args => {
        const { readFile } = await import('node:fs/promises')
        const text = await readFile(args.path, 'utf8')
        if (!text.includes(BEGIN)) return undefined
        return { contents: stripE2eAuthRegions(text, args.path), loader: 'ts' }
      })
    }
  }
}
