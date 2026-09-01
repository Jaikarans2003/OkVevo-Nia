/**
 * Packaged-app updates via electron-updater against a generic HTTPS feed.
 *
 * Unpackaged `npm run dev` keeps the git/`hermes update` path in main.ts.
 * This module is the only updater the shipped Nia.app / Nia.exe should call.
 */

export const BINARY_UPDATE_FEED_URL = 'https://releases.okvevo.com'
export const BINARY_UPDATE_PUBLISHER_NAME = 'OkVevo'

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

type UpdaterLike = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowDowngrade: boolean
  verifyUpdateCodeSignature?: boolean
  setFeedURL: (opts: { provider: string; url: string }) => void
  checkForUpdates: () => Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version: string } } | null>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
  on: (event: string, listener: (...args: unknown[]) => void) => void
}

type ProgressEmitter = (payload: { stage: string; message: string; percent: number | null; error?: string | null }) => void

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

export function configureBinaryUpdater(updater: UpdaterLike, feedUrl = BINARY_UPDATE_FEED_URL) {
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = false
  updater.setFeedURL({ provider: 'generic', url: feedUrl.replace(/\/+$/, '') })

  if (process.platform === 'darwin') {
    updater.verifyUpdateCodeSignature = true
  }

  configured = true
}

async function loadUpdater(): Promise<UpdaterLike> {
  if (injectedUpdater) {
    return injectedUpdater
  }

  const mod = await import('electron-updater')

  return mod.autoUpdater as UpdaterLike
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

export async function applyBinaryUpdate(opts: {
  emitProgress: ProgressEmitter
}): Promise<{ ok: boolean; handedOff?: boolean; error?: string; message?: string }> {
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

  try {
    opts.emitProgress({ stage: 'fetch', message: 'Downloading…', percent: 0 })
    await updater.downloadUpdate()
    opts.emitProgress({ stage: 'update', message: 'Verifying…', percent: 90 })
    opts.emitProgress({
      stage: 'restart',
      message: 'Restarting Nia…',
      percent: 100
    })
    updater.quitAndInstall(false, true)

    return { ok: true, handedOff: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    opts.emitProgress({ stage: 'error', message, percent: null, error: 'apply-failed' })

    return { ok: false, error: 'apply-failed', message }
  }
}
