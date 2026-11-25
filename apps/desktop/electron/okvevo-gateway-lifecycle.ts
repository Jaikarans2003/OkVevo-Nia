/**
 * OkVevo product rule: quitting or updating the desktop app must not leave
 * the detached gateway (osascript wrapper + python child) running. Upstream
 * Hermes intentionally keeps it for attach-mode messaging/cron; OkVevo is
 * local-desktop-only and that leftover causes the next launch to exit 75
 * ("already owns this host… not published yet").
 *
 * Never stop or replace a gateway the user started from the CLI.
 */

import type * as childProcess from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

export const OKVEVO_DESKTOP_GATEWAY_MARKER = 'okvevo-desktop-gateway.json'
export const OKVEVO_GATEWAY_STOP_GRACE_MS = 4_000
export const OKVEVO_GATEWAY_SOCKET_PROBE_MS = 750

export type GatewayLockRecord = {
  argv?: string[]
  hermes_home?: string
  kind?: string
  pid: number
}

export type DesktopGatewayMarker = {
  pid: number
  wrapperPid?: number | null
  writtenAt: string
}

export type OkvevoGatewayLifecycleDeps = {
  clearTimeoutFn?: typeof clearTimeout
  connectSocket?: (sockPath: string, timeoutMs: number) => Promise<boolean>
  existsSync?: (p: string) => boolean
  isPidAlive?: (pid: number) => boolean
  kill?: (pid: number, signal: NodeJS.Signals) => void
  now?: () => number
  parentPid?: (pid: number) => number | null
  processCmdline?: (pid: number) => string
  readFileSync?: (p: string, encoding: BufferEncoding) => string
  /** Best-effort `hermes gateway stop` (graceful). Never throws. */
  runGatewayStop?: () => Promise<void>
  setTimeoutFn?: typeof setTimeout
  sleep?: (ms: number) => Promise<void>
  writeFileSync?: (p: string, data: string) => void
  rmSync?: (p: string) => void
}

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

function defaultKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    /* already gone */
  }
}

function defaultConnectSocket(sockPath: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection(sockPath)
    let settled = false

    const finish = (ok: boolean) => {
      if (settled) {
        return
      }

      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function defaultParentPid(pid: number): number | null {
  try {
     
    const { execFileSync } = require('node:child_process') as typeof childProcess

    const out = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 2_000
    }).trim()

    const ppid = Number.parseInt(out, 10)

    return Number.isInteger(ppid) && ppid > 1 ? ppid : null
  } catch {
    return null
  }
}

function defaultProcessCmdline(pid: number): string {
  try {
     
    const { execFileSync } = require('node:child_process') as typeof childProcess

    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 2_000
    }).trim()
  } catch {
    return ''
  }
}

export function desktopGatewayMarkerPath(hermesHome: string): string {
  return path.join(hermesHome, OKVEVO_DESKTOP_GATEWAY_MARKER)
}

export function gatewayLockPath(hermesHome: string): string {
  return path.join(hermesHome, 'gateway.lock')
}

export function gatewaySockPath(hermesHome: string): string {
  return path.join(hermesHome, 'gateway.sock')
}

export function parseGatewayLock(raw: string): GatewayLockRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<GatewayLockRecord>

    if (!Number.isInteger(parsed.pid) || (parsed.pid as number) <= 0) {
      return null
    }

    return {
      pid: parsed.pid as number,
      kind: typeof parsed.kind === 'string' ? parsed.kind : undefined,
      argv: Array.isArray(parsed.argv) ? parsed.argv.map(String) : undefined,
      hermes_home: typeof parsed.hermes_home === 'string' ? parsed.hermes_home : undefined
    }
  } catch {
    return null
  }
}

export function readGatewayLock(
  hermesHome: string,
  deps: Pick<OkvevoGatewayLifecycleDeps, 'existsSync' | 'readFileSync'> = {}
): GatewayLockRecord | null {
  const existsSync = deps.existsSync ?? fs.existsSync
  const readFileSync = deps.readFileSync ?? fs.readFileSync
  const lockPath = gatewayLockPath(hermesHome)

  if (!existsSync(lockPath)) {
    return null
  }

  try {
    return parseGatewayLock(readFileSync(lockPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * True when the lock argv is clearly the packaged OkVevo desktop payload —
 * never a user CLI `hermes gateway run` from PATH or a git checkout.
 */
export function isOkvevoPackagedGateway(record: GatewayLockRecord | null | undefined): boolean {
  if (!record?.argv?.length) {
    return false
  }

  const joined = record.argv.join('\0')

  return (
    /OkVevo\.app[/\\]/i.test(joined) ||
    /[/\\]OkVevo[/\\].*agent-payload/i.test(joined) ||
    /OkVevo\.exe/i.test(joined) ||
    /[/\\]agent-payload[/\\].*hermes_cli[/\\]main\.py/i.test(joined)
  )
}

export function readDesktopGatewayMarker(
  hermesHome: string,
  deps: Pick<OkvevoGatewayLifecycleDeps, 'existsSync' | 'readFileSync'> = {}
): DesktopGatewayMarker | null {
  const existsSync = deps.existsSync ?? fs.existsSync
  const readFileSync = deps.readFileSync ?? fs.readFileSync
  const markerPath = desktopGatewayMarkerPath(hermesHome)

  if (!existsSync(markerPath)) {
    return null
  }

  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8')) as Partial<DesktopGatewayMarker>

    if (!Number.isInteger(parsed.pid) || (parsed.pid as number) <= 0) {
      return null
    }

    return {
      pid: parsed.pid as number,
      wrapperPid: Number.isInteger(parsed.wrapperPid) ? (parsed.wrapperPid as number) : null,
      writtenAt: typeof parsed.writtenAt === 'string' ? parsed.writtenAt : ''
    }
  } catch {
    return null
  }
}

export function writeDesktopGatewayMarker(
  hermesHome: string,
  pid: number,
  deps: OkvevoGatewayLifecycleDeps = {}
): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return
  }

  const writeFileSync = deps.writeFileSync ?? fs.writeFileSync
  const parentPid = deps.parentPid ?? defaultParentPid
  const processCmdline = deps.processCmdline ?? defaultProcessCmdline
  const wrapperPid = parentPid(pid)
  const wrapperCmd = wrapperPid ? processCmdline(wrapperPid) : ''
  const keepWrapper = wrapperPid && /osascript/i.test(wrapperCmd) ? wrapperPid : null

  const marker: DesktopGatewayMarker = {
    pid,
    wrapperPid: keepWrapper,
    writtenAt: new Date().toISOString()
  }

  writeFileSync(desktopGatewayMarkerPath(hermesHome), `${JSON.stringify(marker)}\n`)
}

export function clearDesktopGatewayMarker(
  hermesHome: string,
  deps: Pick<OkvevoGatewayLifecycleDeps, 'existsSync' | 'rmSync'> = {}
): void {
  const existsSync = deps.existsSync ?? fs.existsSync
  const rmSync = deps.rmSync ?? ((p: string) => fs.rmSync(p, { force: true }))
  const markerPath = desktopGatewayMarkerPath(hermesHome)

  if (existsSync(markerPath)) {
    try {
      rmSync(markerPath)
    } catch {
      /* best-effort */
    }
  }
}

/** Record the live lock PID after a successful Desktop ensure. */
export function recordDesktopGatewayAfterEnsure(
  hermesHome: string,
  deps: OkvevoGatewayLifecycleDeps = {}
): void {
  const lock = readGatewayLock(hermesHome, deps)

  if (!lock || !isOkvevoPackagedGateway(lock)) {
    return
  }

  writeDesktopGatewayMarker(hermesHome, lock.pid, deps)
}

/**
 * Lock owner is a prior OkVevo Desktop launch (marker and/or packaged argv)
 * whose control socket does not answer — same situation as needing --replace.
 * Never true for a CLI-started gateway.
 */
export async function shouldTakeOverStaleDesktopGateway(
  hermesHome: string,
  deps: OkvevoGatewayLifecycleDeps = {}
): Promise<boolean> {
  const lock = readGatewayLock(hermesHome, deps)

  if (!lock) {
    return false
  }

  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive
  const marker = readDesktopGatewayMarker(hermesHome, deps)
  const ours = (marker && marker.pid === lock.pid) || isOkvevoPackagedGateway(lock)

  if (!ours || !isPidAlive(lock.pid)) {
    return false
  }

  const existsSync = deps.existsSync ?? fs.existsSync
  const sock = gatewaySockPath(hermesHome)

  if (!existsSync(sock)) {
    return true
  }

  const connectSocket = deps.connectSocket ?? defaultConnectSocket
  const answers = await connectSocket(sock, OKVEVO_GATEWAY_SOCKET_PROBE_MS)

  return !answers
}

function pidsToSignal(hermesHome: string, deps: OkvevoGatewayLifecycleDeps): number[] {
  const lock = readGatewayLock(hermesHome, deps)
  const marker = readDesktopGatewayMarker(hermesHome, deps)
  const pids = new Set<number>()

  if (lock && ((marker && marker.pid === lock.pid) || isOkvevoPackagedGateway(lock))) {
    pids.add(lock.pid)
  } else if (marker) {
    pids.add(marker.pid)
  }

  if (marker?.wrapperPid) {
    pids.add(marker.wrapperPid)
  } else if (lock && isOkvevoPackagedGateway(lock)) {
    const parentPid = deps.parentPid ?? defaultParentPid
    const processCmdline = deps.processCmdline ?? defaultProcessCmdline
    const ppid = parentPid(lock.pid)

    if (ppid && /osascript/i.test(processCmdline(ppid))) {
      pids.add(ppid)
    }
  }

  return [...pids]
}

async function waitUntilDead(
  pids: number[],
  graceMs: number,
  deps: OkvevoGatewayLifecycleDeps
): Promise<boolean> {
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive
  const sleep = deps.sleep ?? defaultSleep
  const now = deps.now ?? Date.now
  const deadline = now() + graceMs

  while (now() < deadline) {
    if (pids.every(pid => !isPidAlive(pid))) {
      return true
    }

    await sleep(100)
  }

  return pids.every(pid => !isPidAlive(pid))
}

/**
 * Graceful `hermes gateway stop` when the owner is ours, then SIGTERM → SIGKILL
 * on the gateway PID and its osascript wrapper after the grace window.
 */
export async function stopOkvevoDesktopGateway(
  hermesHome: string,
  deps: OkvevoGatewayLifecycleDeps = {}
): Promise<{ stopped: boolean; reason: string }> {
  const lock = readGatewayLock(hermesHome, deps)
  const marker = readDesktopGatewayMarker(hermesHome, deps)

  const ours =
    (marker && lock && marker.pid === lock.pid) ||
    isOkvevoPackagedGateway(lock) ||
    (marker && (deps.isPidAlive ?? defaultIsPidAlive)(marker.pid))

  if (!ours) {
    return { stopped: false, reason: 'not_desktop_owned' }
  }

  if (deps.runGatewayStop) {
    try {
      await deps.runGatewayStop()
    } catch {
      /* best-effort */
    }
  }

  const pids = pidsToSignal(hermesHome, deps)

  if (!pids.length) {
    clearDesktopGatewayMarker(hermesHome, deps)

    return { stopped: true, reason: 'no_pids' }
  }

  const kill = deps.kill ?? defaultKill
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive

  for (const pid of pids) {
    kill(pid, 'SIGTERM')
  }

  const dead = await waitUntilDead(pids, OKVEVO_GATEWAY_STOP_GRACE_MS, deps)

  if (!dead) {
    for (const pid of pids) {
      if (isPidAlive(pid)) {
        kill(pid, 'SIGKILL')
      }
    }

    await waitUntilDead(pids, 1_000, deps)
  }

  clearDesktopGatewayMarker(hermesHome, deps)

  return { stopped: true, reason: dead ? 'graceful' : 'forced' }
}

/** On start: if our prior gateway holds the lock but its socket is dead, stop it so ensure can bind. */
export async function reclaimStaleOkvevoDesktopGateway(
  hermesHome: string,
  deps: OkvevoGatewayLifecycleDeps = {}
): Promise<{ replaced: boolean; reason: string }> {
  if (!(await shouldTakeOverStaleDesktopGateway(hermesHome, deps))) {
    return { replaced: false, reason: 'not_stale_desktop' }
  }

  const result = await stopOkvevoDesktopGateway(hermesHome, deps)

  return { replaced: result.stopped, reason: result.reason }
}
