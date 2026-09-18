/**
 * Filtered Python-agent snapshot for extraResources.
 *
 * Packaged Nia extracts this archive into ~/.hermes/hermes-agent so first
 * install does not clone GitHub (private-repo hard gate) and electron-updater
 * can re-extract when the install stamp changes (pin agent to shell).
 *
 * Not a prebuilt venv — first launch still runs uv / python-deps against PyPI.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

import { isMain } from './utils.mjs'

const DESKTOP_ROOT = resolve(import.meta.dirname, '..')
const REPO_ROOT = resolve(DESKTOP_ROOT, '..', '..')
const OUT_DIR = join(DESKTOP_ROOT, 'build')
export const SNAPSHOT_FILE = join(OUT_DIR, 'agent-snapshot.tar.gz')

/** Directories the running agent imports. Plan names the product set; root .py files are required to import hermes_cli. */
export const SNAPSHOT_DIRS = [
  'acp_adapter',
  'agent',
  'cron',
  'gateway',
  'hermes',
  'hermes_cli',
  'locales',
  'okvevo',
  'optional-mcps',
  'optional-skills',
  'plugins',
  'providers',
  'skills',
  'tools',
  'tui_gateway'
]

export const SNAPSHOT_FILES = [
  'AGENTS.md',
  'LICENSE',
  'README.md',
  'SOUL.md',
  'cli-config.yaml.example',
  'cli.py',
  'constraints-termux.txt',
  'hermes_bootstrap.py',
  'hermes_constants.py',
  'hermes_logging.py',
  'hermes_state.py',
  'hermes_state_common.py',
  'hermes_state_portability.py',
  'hermes_state_schema.py',
  'hermes_state_search.py',
  'hermes_time.py',
  'mcp_serve.py',
  'model_tools.py',
  'pyproject.toml',
  'registration_lifecycle.py',
  'run_agent.py',
  'setup.py',
  'toolset_distributions.py',
  'toolsets.py',
  'trajectory_compressor.py',
  'utils.py',
  'uv.lock',
  'scripts/install.sh',
  'scripts/install.ps1'
]

export const SNAPSHOT_TAR_EXCLUDES = [
  '--exclude=.git',
  '--exclude=node_modules',
  '--exclude=__pycache__',
  '--exclude=*.pyc',
  '--exclude=.venv',
  '--exclude=venv',
  '--exclude=apps',
  '--exclude=website',
  '--exclude=web',
  '--exclude=ui-tui',
  '--exclude=tests',
  '--exclude=tests-js',
  '--exclude=.github'
]

export function existingSnapshotPaths(repoRoot = REPO_ROOT) {
  const paths = []
  for (const rel of [...SNAPSHOT_DIRS, ...SNAPSHOT_FILES]) {
    if (existsSync(join(repoRoot, rel))) {
      paths.push(rel)
    }
  }
  return paths
}

export function assertSnapshotAllowlist(paths) {
  const joined = paths.join('\n')
  if (!paths.includes('hermes_cli') && !paths.some(p => p.startsWith('hermes_cli/'))) {
    throw new Error('agent snapshot is missing hermes_cli')
  }
  if (!paths.includes('pyproject.toml')) {
    throw new Error('agent snapshot is missing pyproject.toml')
  }
  if (paths.some(p => p === 'apps' || p.startsWith('apps/'))) {
    throw new Error('agent snapshot must not include apps/ (desktop shell lives in the DMG)')
  }
  if (/\b(node_modules|\.git)\b/.test(joined)) {
    throw new Error('agent snapshot must not include .git or node_modules')
  }
}

export function packAgentSnapshot({
  repoRoot = REPO_ROOT,
  outFile = SNAPSHOT_FILE,
  exec = spawnSync
} = {}) {
  const members = existingSnapshotPaths(repoRoot)
  assertSnapshotAllowlist(members)
  mkdirSync(dirname(outFile), { recursive: true })
  // Git-for-Windows tar treats a colon in the archive path as host:file
  // (`Cannot connect to C:`). Prefer a cwd-relative dest; --force-local
  // covers leftover absolute Windows paths.
  const rel = relative(process.cwd(), outFile)
  const dest = rel && !rel.startsWith('..') && !rel.startsWith(sep)
    ? rel.split(sep).join('/')
    : outFile
  const args = ['-czf', dest, '-C', repoRoot, ...SNAPSHOT_TAR_EXCLUDES, ...members]
  if (process.platform === 'win32' || String(dest).includes(':')) {
    args.unshift('--force-local')
  }
  const result = exec('tar', args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`tar snapshot failed: ${result.stderr || result.stdout || result.status}`)
  }
  return { outFile, members }
}

export function stageBundledInstallScripts({
  repoRoot = REPO_ROOT,
  outDir = OUT_DIR
} = {}) {
  mkdirSync(outDir, { recursive: true })
  const copied = []
  for (const name of ['install.sh', 'install.ps1']) {
    const from = join(repoRoot, 'scripts', name)
    if (!existsSync(from)) {
      throw new Error(`Missing ${from}`)
    }
    const to = join(outDir, name)
    copyFileSync(from, to)
    copied.push(to)
  }
  return copied
}

if (isMain(import.meta.url)) {
  const { outFile, members } = packAgentSnapshot()
  const scripts = stageBundledInstallScripts()
  writeFileSync(join(OUT_DIR, 'agent-snapshot.manifest.json'), JSON.stringify({ members }, null, 2) + '\n')
  console.log(
    `[pack-agent-snapshot] wrote ${relative(REPO_ROOT, outFile)} (${members.length} members) + ${scripts.length} install scripts`
  )
}
