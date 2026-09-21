/**
 * Packaged-app updates via electron-updater against a generic HTTPS feed.
 *
 * Unpackaged `npm run dev` keeps the git/`hermes update` path in main.ts.
 * This module is the only updater the shipped Nia.app / Nia.exe should call.
 */

import { formatRawUpdateError, mapBinaryUpdateError } from './binary-update-error'

export const BINARY_UPDATE_FEED_URL = 'https://releases.okvevo.com'
export const BINARY_UPDATE_PUBLISHER_NAME = 'OkVevo'
export const BINARY_UPDATE_QUIT_TIMEOUT_MS = 60_000

export type BinaryUpdateCheckInput = {
  currentVersion: string
  isUpdateAvailable?: boolean
  version?: string
}

export type BinaryUpdateStatus = {
  supported: true
  updateAvailable: boolean
  behind: number | null
  currentVersion: string
  targetSha?: string
  fetchedAt: number
  error?: string
  message?: string
}

export type BinaryUpdateQuitEvent = 'before-quit-for-update' | 'before-quit'

export type BinaryUpdateQuitSignals = {
  on: (event: BinaryUpdateQuitEvent, listener: () => void) => void
}

type UpdaterLike = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowDowngrade: boolean
  logger?: null | { error: (...args: unknown[]) => void }
  setFeedURL: (opts: { provider: string; url: string; channel?: string }) => void
  checkForUpdates: () => Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version: string } } | null>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
  on: (event: string, listener: (...args: unknown[]) => void) => void
}

type ProgressEmitter = (payload: { stage: string; message: string; percent: number | null; error?: string | null }) => void

export type ApplyBinaryUpdateOpts = {
  emitProgress: ProgressEmitter
  logRaw?: (line: string) => void
  onQuitForHandoff?: () => void
  quitSignals?: BinaryUpdateQuitSignals
  quitTimeoutMs?: number
}

export type ApplyBinaryUpdateResult = { ok: boolean; handedOff?: boolean; error?: string }

let injectedUpdater: null | UpdaterLike = null
let configured = false

/** Test seam — production never calls this. */
export function setBinaryUpdaterForTests(updater: null | UpdaterLike) {
  injectedUpdater = updater
  configured = false
}

export function mapBinaryCheckResult(input: BinaryUpdateCheckInput): BinaryUpdateStatus {
  const latest = input.version?.trim()
  const current = input.currentVersion.trim()
  const available = Boolean(input.isUpdateAvailable ?? (latest && latest !== current))

  return {
    supported: true,
    updateAvailable: available,
    behind: available ? null : 0,
    currentVersion: current,
    targetSha: available && latest ? `v${latest}` : undefined,
    fetchedAt: Date.now()
  }
}

export function resolveUpdateFeedUrl(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = (env.NIA_UPDATE_FEED_URL || '').trim().replace(/\/+$/, '')

  return fromEnv || BINARY_UPDATE_FEED_URL
}

/** Runtime channel. Default `latest`. Team machines set NIA_UPDATE_CHANNEL=internal. Never bake internal into the binary. */
export function resolveUpdateChannel(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = (env.NIA_UPDATE_CHANNEL || '').trim()

  return fromEnv || 'latest'
}

export function configureBinaryUpdater(
  updater: UpdaterLike,
  opts: { url?: string; channel?: string; env?: NodeJS.ProcessEnv } = {}
) {
  const env = opts.env || process.env
  const feedUrl = (opts.url || resolveUpdateFeedUrl(env)).replace(/\/+$/, '')
  const channel = opts.channel || resolveUpdateChannel(env)

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = false
  updater.setFeedURL({ provider: 'generic', url: feedUrl, channel })

  configured = true
}

async function loadUpdater(): Promise<UpdaterLike> {
  if (injectedUpdater) {
    return injectedUpdater
  }

  const [{ autoUpdater }, logMod] = await Promise.all([import('electron-updater'), import('electron-log/main')])
  const log = 'transports' in logMod && logMod.transports ? logMod : logMod.default

  // Mac: ~/Library/Logs/Nia/main.log  Windows: %USERPROFILE%\AppData\Roaming\Nia\logs\main.log
  // ShipIt (Mac install): ~/Library/Caches/com.okvevo.nia.ShipIt/ShipIt_stderr.log
  log.transports.file.level = 'debug'
  autoUpdater.logger = log

  return autoUpdater as UpdaterLike
}

export async function checkBinaryUpdate(opts: { currentVersion: string }): Promise<BinaryUpdateStatus> {
  const updater = await loadUpdater()

  if (!configured) {
    configureBinaryUpdater(updater)
  }

  try {
    const result = await updater.checkForUpdates()

    return mapBinaryCheckResult({
      currentVersion: opts.currentVersion,
      isUpdateAvailable: result?.isUpdateAvailable,
      version: result?.updateInfo?.version
    })
  } catch (error) {
    return {
      supported: true,
      updateAvailable: false,
      behind: 0,
      currentVersion: opts.currentVersion,
      error: 'fetch-failed',
      message: error instanceof Error ? error.message : String(error),
      fetchedAt: Date.now()
    }
  }
}

function logRawUpdateFailure(updater: UpdaterLike, logRaw: ((line: string) => void) | undefined, error: unknown) {
  const raw = formatRawUpdateError(error)

  logRaw?.(raw)
  updater.logger?.error(raw)
}

function failApply(
  updater: UpdaterLike,
  opts: ApplyBinaryUpdateOpts,
  error: unknown
): ApplyBinaryUpdateResult {
  logRawUpdateFailure(updater, opts.logRaw, error)
  const code = mapBinaryUpdateError(error)

  opts.emitProgress({ stage: 'error', message: '', percent: null, error: code })

  return { ok: false, error: code }
}

export async function applyBinaryUpdate(opts: ApplyBinaryUpdateOpts): Promise<ApplyBinaryUpdateResult> {
  const updater = await loadUpdater()

  if (!configured) {
    configureBinaryUpdater(updater)
  }

  const onProgress = (progress: { percent?: number }) => {
    opts.emitProgress({
      stage: 'fetch',
      message: 'Downloading…',
      percent: typeof progress.percent === 'number' ? progress.percent : null
    })
  }

  updater.on('download-progress', onProgress)

  const nextError = new Promise<unknown>(resolve => {
    updater.on('error', error => resolve(error))
  })

  try {
    opts.emitProgress({ stage: 'fetch', message: 'Downloading…', percent: 0 })

    const downloaded = new Promise<void>(resolve => {
      updater.on('update-downloaded', () => resolve())
    })

    const download = updater.downloadUpdate().then(() => downloaded)

    const early = await Promise.race([download.then(() => null), nextError])

    if (early != null) {
      return failApply(updater, opts, early)
    }
  } catch (error) {
    return failApply(updater, opts, error)
  }

  opts.emitProgress({ stage: 'update', message: 'Verifying…', percent: 90 })
  opts.emitProgress({
    stage: 'restart',
    message: 'Restarting Nia…',
    percent: 100
  })

  // Lifecycle only — skips quit blockers. Not proof that Electron started quitting.
  opts.onQuitForHandoff?.()

  const timeoutMs = opts.quitTimeoutMs ?? BINARY_UPDATE_QUIT_TIMEOUT_MS

  const quitSeen = new Promise<'quit'>(resolve => {
    const onQuit = () => resolve('quit')

    opts.quitSignals?.on('before-quit-for-update', onQuit)
    opts.quitSignals?.on('before-quit', onQuit)
  })

  const timedOut = new Promise<'timeout'>(resolve => {
    setTimeout(() => resolve('timeout'), timeoutMs)
  })

  updater.quitAndInstall(false, true)

  const outcome = await Promise.race([quitSeen, nextError.then(error => ({ error })), timedOut])

  if (outcome === 'quit') {
    return { ok: true, handedOff: true }
  }

  if (outcome === 'timeout') {
    logRawUpdateFailure(updater, opts.logRaw, new Error('UPD-INSTALL-TIMEOUT'))
    opts.emitProgress({ stage: 'error', message: '', percent: null, error: 'UPD-INSTALL-TIMEOUT' })

    return { ok: false, error: 'UPD-INSTALL-TIMEOUT' }
  }

  return failApply(updater, opts, outcome.error)
}
