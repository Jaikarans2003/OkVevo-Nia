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
import { fileURLToPath } from 'node:url'

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

/** Providers a fresh or leftover install must not keep. Desired values live in the defaults file. */
const REPLACE_PROVIDERS = new Set(['', 'auto', 'openrouter', 'nous', 'tavily'])

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

type DefaultsTree = Record<string, unknown>

export function defaultOkvevoDefaultsPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, '../../okvevo/config/okvevo-defaults.yaml'),
    path.resolve(here, '../../../okvevo/config/okvevo-defaults.yaml')
  ]
  let dir = here

  for (let depth = 0; depth < 6; depth += 1) {
    candidates.push(path.join(dir, 'okvevo', 'config', 'okvevo-defaults.yaml'))
    const parent = path.dirname(dir)

    if (parent === dir) {
      break
    }

    dir = parent
  }

  const found = candidates.find(candidate => fs.existsSync(candidate))

  if (!found) {
    throw new Error(`okvevo defaults not found from ${here}`)
  }

  return found
}

export function loadOkvevoDefaults(filePath = defaultOkvevoDefaultsPath()): DefaultsTree {
  const parsed = parseYaml(fs.readFileSync(filePath, 'utf8'))

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`okvevo defaults must be a mapping: ${filePath}`)
  }

  return parsed as DefaultsTree
}

export function readFirstText(
  candidates: readonly string[],
  io: Pick<MigrationFs, 'existsSync' | 'readFileSync'> = fs
): string {
  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    try {
      if (!io.existsSync(candidate)) {
        continue
      }

      const text = io.readFileSync(candidate, 'utf8')

      if (text.trim()) {
        return text
      }
    } catch {
      continue
    }
  }

  return ''
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function forceMerge(
  target: Record<string, unknown>,
  defaults: Record<string, unknown>,
  pathName: string,
  changes: string[],
  stringPolicy: 'force' | 'replace'
): void {
  for (const [key, value] of Object.entries(defaults)) {
    const childPath = `${pathName}.${key}`

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const child = asRecord(target[key])
      forceMerge(child, value as Record<string, unknown>, childPath, changes, stringPolicy)
      target[key] = child
      continue
    }

    if (typeof value === 'string' && stringPolicy === 'replace') {
      const current = String(target[key] ?? '').trim().toLowerCase()

      if (!REPLACE_PROVIDERS.has(current) || current === value.trim().toLowerCase()) {
        continue
      }

      target[key] = value
      changes.push(`${childPath}=${current || 'unset'}→${value}`)
      continue
    }

    if (sameValue(target[key], value)) {
      continue
    }

    const from = target[key] === undefined ? 'unset' : JSON.stringify(target[key])
    target[key] = value
    changes.push(`${childPath}=${from}→${JSON.stringify(value)}`)
  }
}

function applyModel(next: Record<string, unknown>, defaults: DefaultsTree, changes: string[]): void {
  const wantedProvider = String(defaults.provider ?? '').trim()
  const wantedDefault = String(defaults.default ?? '').trim()
  const model = asRecord(next.model)
  const provider = String(model.provider ?? '').trim().toLowerCase()

  if (REPLACE_PROVIDERS.has(provider)) {
    model.provider = wantedProvider
    changes.push(
      provider === '' ? `model.provider=${wantedProvider} (was unset)` : `model.provider ${provider}→${wantedProvider}`
    )
  }

  const id = String(model.default ?? model.model ?? model.name ?? '').trim()
  const providerNow = String(model.provider ?? '').trim().toLowerCase()

  if (!id && wantedDefault && providerNow === wantedProvider.toLowerCase()) {
    model.default = wantedDefault
    changes.push(`model.default=${wantedDefault} (was unset)`)
  }

  next.model = model
}

function applyAuxiliary(next: Record<string, unknown>, defaults: DefaultsTree, changes: string[]): void {
  const auxiliary = asRecord(next.auxiliary)

  for (const [task, spec] of Object.entries(defaults)) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      continue
    }

    const wanted = String((spec as Record<string, unknown>).provider ?? '').trim()

    if (!wanted) {
      continue
    }

    const block = asRecord(auxiliary[task])
    const current = String(block.provider ?? '').trim().toLowerCase()

    if (!REPLACE_PROVIDERS.has(current) || current === wanted.toLowerCase()) {
      continue
    }

    block.provider = wanted
    auxiliary[task] = block
    changes.push(`auxiliary.${task}.provider=${current || 'unset'}→${wanted}`)
  }

  next.auxiliary = auxiliary
}

function applyPlugins(next: Record<string, unknown>, defaults: DefaultsTree, changes: string[]): void {
  const plugins = asRecord(next.plugins)
  const enabled = asStringList(plugins.enabled)
  const cleaned = enabled.filter(name => name !== 'nia-public-guard')

  if (cleaned.length !== enabled.length) {
    changes.push('plugins.enabled removed nia-public-guard')
  }

  for (const name of asStringList(defaults.enabled)) {
    if (!cleaned.includes(name)) {
      cleaned.push(name)
      changes.push(`plugins.enabled added ${name}`)
    }
  }

  plugins.enabled = cleaned
  next.plugins = plugins
}

function applyForced(next: Record<string, unknown>, defaults: DefaultsTree, changes: string[]): void {
  if (defaults.web && typeof defaults.web === 'object') {
    const web = asRecord(next.web)
    forceMerge(web, asRecord(defaults.web), 'web', changes, 'replace')
    next.web = web
  }

  for (const key of ['image_gen', 'video_gen', 'telemetry', 'nous', 'model_catalog', 'cron', 'tools']) {
    const spec = defaults[key]

    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      continue
    }

    const block = asRecord(next[key])
    forceMerge(block, spec as Record<string, unknown>, key, changes, 'force')
    next[key] = block
  }
}

export function planConfigChanges(
  raw: unknown,
  opts: { defaults?: DefaultsTree; defaultsPath?: string; skillsDir?: string | null } = {}
): { next: Record<string, unknown>; changes: string[] } {
  const defaults = opts.defaults ?? loadOkvevoDefaults(opts.defaultsPath)
  const next = structuredClone(asRecord(raw))
  const changes: string[] = []

  applyModel(next, asRecord(defaults.model), changes)
  applyAuxiliary(next, asRecord(defaults.auxiliary), changes)
  applyPlugins(next, asRecord(defaults.plugins), changes)
  applyForced(next, defaults, changes)

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
  defaults?: DefaultsTree
  defaultsPath?: string
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

function migrateConfig(
  home: string,
  skillsDir: string | null | undefined,
  io: MigrationFs,
  log: (m: string) => void,
  defaults: DefaultsTree
): void {
  const configPath = path.join(home, 'config.yaml')
  const rawText = io.existsSync(configPath) ? io.readFileSync(configPath, 'utf8') : ''
  let parsed: unknown = {}

  if (rawText.trim()) {
    parsed = parseYaml(rawText) ?? {}
  }

  const { next, changes } = planConfigChanges(parsed, { skillsDir, defaults })

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
  const defaults = args.defaults ?? loadOkvevoDefaults(args.defaultsPath)
  let generated = ''

  if (args.upstreamSoul.trim()) {
    try {
      generated = makeOkvevoSoul(args.upstreamSoul)
    } catch (error) {
      log(`[okvevo-migrate] SOUL skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  io.mkdirSync(args.hermesHome, { recursive: true })

  for (const home of profileHomes(args.hermesHome, io)) {
    if (generated) {
      migrateSoul(home, generated, args.upstreamSoul, io, log)
    }

    migrateConfig(home, args.skillsDir, io, log, defaults)
  }
}

/** Same config migration, for a profile created after launch. */
export function provisionOkvevoProfile(
  hermesHome: string,
  profileName: string,
  opts: { defaultsPath?: string; fsImpl?: MigrationFs; log?: (message: string) => void; skillsDir?: string | null } = {}
): void {
  if (!PROFILE_NAME.test(profileName) || profileName.includes('..')) {
    throw new Error('refusing profile name')
  }

  const io = opts.fsImpl ?? defaultFs()
  const home = path.join(hermesHome, 'profiles', profileName)
  io.mkdirSync(home, { recursive: true })
  migrateConfig(
    home,
    opts.skillsDir,
    io,
    opts.log ?? ((message: string) => console.log(message)),
    loadOkvevoDefaults(opts.defaultsPath)
  )
}
