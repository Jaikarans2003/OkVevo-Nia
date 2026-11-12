/**
 * Workaround: event_loop_block_stack (docs/okvevo/WORKAROUNDS.md)
 *
 * Description: the upstream lag watchdog logs a stall only after the main
 *   process resumes, with no stack. This worker sees the missing heartbeat
 *   while the main thread is still blocked and reads its JavaScript stack
 *   through an in-process inspector session (Sentry's Electron ANR approach,
 *   nothing sent anywhere). Local log only.
 * Bug: https://github.com/NousResearch/hermes-agent/issues/139959
 *   https://github.com/NousResearch/hermes-agent/issues/144503
 * Forwarded: no
 * Applied-Upstream: no
 * Last-Update: 2026-10-30
 *
 * Never calls inspector.open(): no --inspect, no debug port, no listener.
 * Toggle off (okvevo.workarounds.event_loop_block_stack) leaves the upstream
 * duration-only log.
 */

import { Worker } from 'node:worker_threads'

export interface BlockStackFrame {
  col: number
  fn: string
  line: number
  url: string
}

type WorkerMessage =
  | { blockedMs: number; frames: BlockStackFrame[]; type: 'stack' }
  | { blockedMs: number; type: 'native' }

// CommonJS: eval workers do not load as ES modules.
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const { Session } = require('node:inspector')

const { thresholdMs, maxPerHour, pauseTimeoutMs } = workerData
const session = new Session()
session.connectToMainThread()

let lastBeat = Date.now()
let blocked = false
let late = false
let sent = []

function finish() {
  session.post('Debugger.resume', () => session.post('Debugger.disable'))
}

session.on('Debugger.paused', message => {
  const frames = (message.params.callFrames || []).slice(0, 40).map(frame => ({
    fn: frame.functionName || '<anonymous>',
    url: frame.url || '',
    line: frame.location.lineNumber + 1,
    col: frame.location.columnNumber + 1
  }))
  finish()
  if (!late) {
    parentPort.postMessage({ type: 'stack', blockedMs: Date.now() - lastBeat, frames })
  }
})

parentPort.on('message', () => {
  lastBeat = Date.now()
  blocked = false
})

setInterval(() => {
  const now = Date.now()
  if (blocked || now - lastBeat < thresholdMs) return
  blocked = true
  sent = sent.filter(at => now - at < 3600000)
  if (sent.length >= maxPerHour) return
  sent.push(now)
  late = false
  session.post('Debugger.enable', () => session.post('Debugger.pause'))
  // Blocked inside native code: V8 only pauses once JavaScript runs again,
  // and that later stack would mislead.
  setTimeout(() => {
    if (blocked) {
      late = true
      parentPort.postMessage({ type: 'native', blockedMs: Date.now() - lastBeat })
    }
  }, pauseTimeoutMs)
}, 100)
`

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted]'],
  [/\b(Bearer|Key)\s+[A-Za-z0-9._-]{12,}/gi, '$1 [redacted]'],
  [/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=\S+/g, '$1=[redacted]']
]

/** Frames carry only name + script URL + position; drop query strings and anything secret-shaped. */
export function redactStackText(text: string): string {
  let out = text.replace(/\?[^\s):]*/g, '')

  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement)
  }

  return out
}

export function formatBlockStack(message: WorkerMessage, thresholdMs: number): string {
  if (message.type === 'native') {
    return `[diagnostics] main-process blocked ≥${thresholdMs}ms outside JavaScript (native call); no JS stack`
  }

  const frames = message.frames.map(frame => `    at ${frame.fn} (${frame.url}:${frame.line}:${frame.col})`)

  return redactStackText(
    `[diagnostics] main-process blocked ≥${thresholdMs}ms; JS stack during the block:\n${frames.join('\n')}`
  )
}

export function startOkvevoBlockStackWatchdog(opts: {
  enabled: boolean
  log: (message: string) => void
  heartbeatMs?: number
  thresholdMs?: number
  maxPerHour?: number
  pauseTimeoutMs?: number
}): { stop: () => void } | null {
  if (!opts.enabled) {
    return null
  }

  const thresholdMs = opts.thresholdMs ?? 5_000
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      thresholdMs,
      maxPerHour: opts.maxPerHour ?? 3,
      pauseTimeoutMs: opts.pauseTimeoutMs ?? 2_000
    }
  })
  const heartbeat = setInterval(() => worker.postMessage(0), opts.heartbeatMs ?? 50)
  heartbeat.unref()
  worker.unref()
  worker.on('message', (message: WorkerMessage) => opts.log(formatBlockStack(message, thresholdMs)))
  worker.on('error', error => opts.log(`[diagnostics] block-stack watchdog stopped: ${error.message}`))

  return {
    stop: () => {
      clearInterval(heartbeat)
      void worker.terminate()
    }
  }
}
