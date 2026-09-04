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
