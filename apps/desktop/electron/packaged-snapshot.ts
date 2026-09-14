/**
 * Packaged Python snapshot: extraResources archive + stamp-gated extract.
 * No GitHub. Re-extract when the desktop install stamp changes so UI and
 * agent cannot drift after electron-updater.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PACK_STAMP_FILENAME = '.nia-pack-stamp'
export const SNAPSHOT_ARCHIVE_NAME = 'agent-snapshot.tar.gz'

export type PackStamp = {
  commit: string
  extractedAt?: string
}

export type SnapshotLayout = {
  archive: string
  installScript: string
}

export function packagedSnapshotLayout(
  resourcesPath: string | null | undefined,
  platform = process.platform
): SnapshotLayout | null {
  if (!resourcesPath) {
    return null
  }

  const archive = path.join(resourcesPath, SNAPSHOT_ARCHIVE_NAME)
  const installScript = path.join(resourcesPath, platform === 'win32' ? 'install.ps1' : 'install.sh')

  try {
    fs.accessSync(archive, fs.constants.R_OK)
    fs.accessSync(installScript, fs.constants.R_OK)
  } catch {
    return null
  }

  return { archive, installScript }
}

export function packStampPath(activeRoot: string): string {
  return path.join(activeRoot, PACK_STAMP_FILENAME)
}

export function readPackStamp(activeRoot: string | null | undefined): PackStamp | null {
  if (!activeRoot) {
    return null
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packStampPath(activeRoot), 'utf8')) as PackStamp
    if (parsed && typeof parsed.commit === 'string' && parsed.commit.length >= 7) {
      return parsed
    }
  } catch {
    return null
  }

  return null
}

export function writePackStamp(activeRoot: string, stamp: PackStamp): void {
  fs.mkdirSync(activeRoot, { recursive: true })
  fs.writeFileSync(
    packStampPath(activeRoot),
    JSON.stringify({ ...stamp, extractedAt: stamp.extractedAt || new Date().toISOString() }, null, 2) + '\n',
    'utf8'
  )
}

export function shouldRebootstrapFromPackagedSnapshot(opts: {
  isPackaged: boolean
  snapshotPresent: boolean
  installStampCommit?: string | null
  extractedStampCommit?: string | null
}): boolean {
  if (!opts.isPackaged || !opts.snapshotPresent) {
    return false
  }

  const pin = typeof opts.installStampCommit === 'string' ? opts.installStampCommit.trim() : ''
  if (pin.length < 7) {
    return false
  }

  return pin !== (opts.extractedStampCommit || '')
}

function runTarExtract(archive: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  const tar = process.platform === 'win32' ? 'tar.exe' : 'tar'
  const result = spawnSync(tar, ['-xzf', archive, '-C', dest], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })

  if (result.status !== 0) {
    throw new Error(`Failed to extract agent snapshot: ${result.stderr || result.stdout || result.status}`)
  }
}

/**
 * Extract archive into activeRoot. Preserves an existing venv/.venv so
 * python-deps can be incremental. Replaces everything else, including .git.
 */
export function extractPackagedSnapshot(opts: {
  archive: string
  activeRoot: string
  commit: string
  emit?: (ev: { type: string; line: string }) => void
}): void {
  const dest = path.resolve(opts.activeRoot)
  const parent = path.dirname(dest)
  fs.mkdirSync(parent, { recursive: true })

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-snapshot-'))
  const unpacked = path.join(staging, 'tree')
  opts.emit?.({ type: 'log', line: `[bootstrap] extracting packaged agent snapshot into ${dest}` })
  runTarExtract(opts.archive, unpacked)

  const keepVenv =
    ['venv', '.venv'].map(name => path.join(dest, name)).find(p => {
      try {
        return fs.statSync(p).isDirectory()
      } catch {
        return false
      }
    }) || null

  if (keepVenv) {
    const venvName = path.basename(keepVenv)
    const venvDest = path.join(unpacked, venvName)
    fs.rmSync(venvDest, { recursive: true, force: true })
    fs.renameSync(keepVenv, venvDest)
  }

  const backup = `${dest}.prev`
  fs.rmSync(backup, { recursive: true, force: true })
  if (fs.existsSync(dest)) {
    fs.renameSync(dest, backup)
  }

  try {
    fs.renameSync(unpacked, dest)
  } catch (err) {
    if (fs.existsSync(backup) && !fs.existsSync(dest)) {
      fs.renameSync(backup, dest)
    }
    throw err
  }

  fs.rmSync(backup, { recursive: true, force: true })
  fs.rmSync(path.join(dest, '.git'), { recursive: true, force: true })
  writePackStamp(dest, { commit: opts.commit })
  fs.rmSync(staging, { recursive: true, force: true })
  opts.emit?.({ type: 'log', line: `[bootstrap] snapshot extracted (stamp ${opts.commit.slice(0, 12)})` })
}
