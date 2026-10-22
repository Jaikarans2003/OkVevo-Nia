/**
 * Tester/first-run migration for ~/.hermes (root + every profiles/*).
 *
 * Backup → mutate → log. Idempotent. Never overwrites a custom SOUL.md.
 *
 * ponytail: YAML dump drops comments on rewrite; the .bak keeps the original.
 * Upgrade path: round-trip via a comment-preserving parser if testers complain.
 */

import fs from 'node:fs'
import path from 'node:path'

import { dump as stringifyYaml, load as parseYaml } from 'js-yaml'

export const DESKTOP_PLATFORM_HINT_APPEND =
  'The product name is OkVevo. You are chatting inside the OkVevo desktop app.'

const SOUL_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['Hermes Agent', 'OkVevo agent'],
  ['Nous Research', 'OkVevo']
]

/** Byte-for-byte the OkVevo default SOUL from pre-upstream-reset. */
export const NIA_DEFAULT_SOUL =
  'You are Nia, built by OkVevo. You are warm, intelligent, curious, and quietly playful. You are confident without being overwhelming, and always feel like a thoughtful creative partner rather than a typical AI assistant. You understand what the user is trying to achieve, simplify the complicated parts, and help turn ideas into something real. You are quick, observant, and occasionally witty, with a calm personality that makes creating feel effortless.\n'

export function makeOkvevoSoul(upstreamText: string): string {
  let out = upstreamText

  for (const [old, next] of SOUL_REPLACEMENTS) {
    if (!out.includes(old)) {
      throw new Error(
        `expected phrase ${JSON.stringify(old)} missing from upstream SOUL — upstream reworded its identity`
      )
    }

    out = out.replaceAll(old, next)
  }

  for (const [old] of SOUL_REPLACEMENTS) {
    if (out.includes(old)) {
      throw new Error(`${JSON.stringify(old)} still present after replacement`)
    }
  }

  return out
}

function normalizeSoul(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '').trim()
}

export function shouldReplaceSoul(current: string, generated: string, upstream: string): boolean {
  const n = normalizeSoul(current)

  if (!n) {
    return true
  }

  if (n === normalizeSoul(generated)) {
    return false
  }

  return n === normalizeSoul(upstream) || n === normalizeSoul(NIA_DEFAULT_SOUL)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)) : []
}

export function planConfigChanges(
  raw: unknown,
  opts: { skillsDir?: string | null } = {}
): { next: Record<string, unknown>; changes: string[] } {
  const next = structuredClone(asRecord(raw))
  const changes: string[] = []

  const model = asRecord(next.model)
  const provider = String(model.provider ?? '').trim().toLowerCase()

  if (provider === 'openrouter' || provider === '') {
    model.provider = 'okvevo'
    next.model = model
    changes.push(provider === '' ? 'model.provider=okvevo (was unset)' : 'model.provider openrouter→okvevo')
  }

  for (const key of ['image_gen', 'video_gen'] as const) {
    const block = asRecord(next[key])
    const current = String(block.provider ?? '').trim().toLowerCase()

    if (current !== 'okvevo') {
      block.provider = 'okvevo'
      next[key] = block
      changes.push(`${key}.provider=${current || 'unset'}→okvevo`)
    }
  }

  const web = asRecord(next.web)

  for (const key of ['backend', 'search_backend', 'extract_backend'] as const) {
    const current = String(web[key] ?? '').trim().toLowerCase()

    if (current === 'tavily' || current === '') {
      web[key] = 'okvevo'
      changes.push(`web.${key}=${current || 'unset'}→okvevo`)
    }
  }

  next.web = web

  const plugins = asRecord(next.plugins)
  const enabled = asStringList(plugins.enabled)
  const cleaned = enabled.filter(name => name !== 'nia-public-guard')

  if (cleaned.length !== enabled.length) {
    changes.push('plugins.enabled removed nia-public-guard')
  }

  if (!cleaned.includes('okvevo')) {
    cleaned.push('okvevo')
    changes.push('plugins.enabled added okvevo')
  }

  plugins.enabled = cleaned
  next.plugins = plugins

  const hints = asRecord(next.platform_hints)
  const desktop = asRecord(hints.desktop)

  if (String(desktop.append ?? '') !== DESKTOP_PLATFORM_HINT_APPEND) {
    desktop.append = DESKTOP_PLATFORM_HINT_APPEND
    hints.desktop = desktop
    next.platform_hints = hints
    changes.push('platform_hints.desktop.append OkVevo wording')
  }

  const skillsDir = opts.skillsDir

  if (skillsDir) {
    const skills = asRecord(next.skills)
    const dirs = asStringList(skills.external_dirs)

    if (!dirs.includes(skillsDir)) {
      dirs.push(skillsDir)
      skills.external_dirs = dirs
      next.skills = skills
      changes.push(`skills.external_dirs += ${skillsDir}`)
    }
  }

  return { next, changes }
}

export interface MigrationFs {
  existsSync: (target: string) => boolean
  readFileSync: (target: string, encoding: 'utf8') => string
  writeFileSync: (target: string, data: string, options?: { encoding: 'utf8'; mode?: number }) => void
  mkdirSync: (target: string, options: { recursive: boolean }) => void
  copyFileSync: (src: string, dest: string) => void
  readdirSync: (target: string) => string[]
}

export interface MigrateHomeArgs {
  hermesHome: string
  upstreamSoul: string
  skillsDir?: string | null
  log?: (message: string) => void
  fsImpl?: MigrationFs
}

function defaultFs(): MigrationFs {
  return {
    existsSync: fs.existsSync,
    readFileSync: (target, encoding) => fs.readFileSync(target, encoding),
    writeFileSync: (target, data, options) => fs.writeFileSync(target, data, options),
    mkdirSync: (target, options) => {
      fs.mkdirSync(target, options)
    },
    copyFileSync: fs.copyFileSync,
    readdirSync: target => fs.readdirSync(target)
  }
}

function profileHomes(hermesHome: string, io: MigrationFs): string[] {
  const homes = [hermesHome]
  const profilesRoot = path.join(hermesHome, 'profiles')

  if (!io.existsSync(profilesRoot)) {
    return homes
  }

  for (const name of io.readdirSync(profilesRoot)) {
    if (name.startsWith('.')) {
      continue
    }

    homes.push(path.join(profilesRoot, name))
  }

  return homes
}

function backup(filePath: string, io: MigrationFs): void {
  io.copyFileSync(filePath, `${filePath}.okvevo-migrate.bak`)
}

function migrateSoul(home: string, generated: string, upstream: string, io: MigrationFs, log: (m: string) => void): void {
  const soulPath = path.join(home, 'SOUL.md')
  const current = io.existsSync(soulPath) ? io.readFileSync(soulPath, 'utf8') : ''

  if (!shouldReplaceSoul(current, generated, upstream)) {
    log(`[okvevo-migrate] ${soulPath}: custom SOUL kept`)
    return
  }

  if (current && normalizeSoul(current) === normalizeSoul(generated)) {
    return
  }

  if (current) {
    backup(soulPath, io)
  }

  io.writeFileSync(soulPath, generated.endsWith('\n') ? generated : `${generated}\n`, { encoding: 'utf8' })
  log(`[okvevo-migrate] ${soulPath}: wrote generated OkVevo SOUL`)
}

function migrateConfig(home: string, skillsDir: string | null | undefined, io: MigrationFs, log: (m: string) => void): void {
  const configPath = path.join(home, 'config.yaml')
  const rawText = io.existsSync(configPath) ? io.readFileSync(configPath, 'utf8') : ''
  let parsed: unknown = {}

  if (rawText.trim()) {
    parsed = parseYaml(rawText) ?? {}
  }

  const { next, changes } = planConfigChanges(parsed, { skillsDir })

  if (changes.length === 0) {
    return
  }

  if (rawText) {
    backup(configPath, io)
  }

  io.writeFileSync(configPath, stringifyYaml(next, { lineWidth: 120, noRefs: true }), { encoding: 'utf8' })
  log(`[okvevo-migrate] ${configPath}: ${changes.join('; ')}`)
}

/** Apply the OkVevo config + SOUL migration to ~/.hermes and every profile. */
export function migrateOkvevoHermesHome(args: MigrateHomeArgs): void {
  const io = args.fsImpl ?? defaultFs()
  const log = args.log ?? ((message: string) => console.log(message))
  const generated = makeOkvevoSoul(args.upstreamSoul)

  io.mkdirSync(args.hermesHome, { recursive: true })

  for (const home of profileHomes(args.hermesHome, io)) {
    migrateSoul(home, generated, args.upstreamSoul, io, log)
    migrateConfig(home, args.skillsDir, io, log)
  }
}
