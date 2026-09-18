/**
 * Same dotenv cascade Python uses, for Electron (stdlib parseEnv — no dotenv npm).
 * Shell / existing process.env wins. Unpackaged repo .env is fill-in only.
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'

function fillEnvFromFile(filePath: string, env: NodeJS.ProcessEnv): boolean {
  let text: string

  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch {
    return false
  }

  const parsed = parseEnv(text)

  for (const [key, value] of Object.entries(parsed)) {
    if (!key || value === undefined) {
      continue
    }

    if (env[key]) {
      continue
    }

    env[key] = value
  }

  return true
}

export function loadHermesDotenvIntoProcess({
  hermesHome,
  unpackagedRepoEnv,
  env = process.env
}: {
  hermesHome: string
  unpackagedRepoEnv?: string | null
  env?: NodeJS.ProcessEnv
}): string[] {
  const loaded: string[] = []
  const userEnv = path.join(hermesHome, '.env')

  if (fillEnvFromFile(userEnv, env)) {
    loaded.push(userEnv)
  }

  if (unpackagedRepoEnv && fillEnvFromFile(unpackagedRepoEnv, env)) {
    loaded.push(unpackagedRepoEnv)
  }

  return loaded
}

export type PackEnvFile = {
  OKVEVO_WEB_ORIGIN?: string
  NIA_UPDATE_FEED_URL?: string
  NIA_UPDATE_CHANNEL?: string
  [key: string]: string | undefined
}

export function loadPackEnvFile(filePath: string | null | undefined): PackEnvFile | null {
  if (!filePath) {
    return null
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackEnvFile
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

/** Non-empty pack values overwrite env (home `.env` / shell / whitespace). Empty pack values skip. */
export function applyPackEnv(packEnv: PackEnvFile | null | undefined, env: NodeJS.ProcessEnv = process.env): string[] {
  const applied: string[] = []

  if (packEnv) {
    for (const [key, value] of Object.entries(packEnv)) {
      if (!key || value === undefined) {
        continue
      }

      const trimmed = String(value).trim()
      if (!trimmed) {
        continue
      }

      env[key] = trimmed
      applied.push(key)
    }
  }

  if (!(env.OKVEVO_WEB_ORIGIN || '').trim()) {
    console.error(
      '[hermes] packaged OKVEVO_WEB_ORIGIN is empty (local unsigned pack or missing Resources/okvevo-pack-env.json)'
    )
  }

  return applied
}
