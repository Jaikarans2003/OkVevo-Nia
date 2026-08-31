/** Shared budget for any renderer await that rides out a primary backend
 * cold boot (initial getConnection(), the registry restore's descriptor
 * wait). Matches the main-process spawn budget
 * (DEFAULT_BACKEND_READY_TIMEOUT_MS in electron/backend-health.ts): a
 * healthy cold boot publishes well within this; anything longer means the
 * backend is not coming and the caller should fail instead of hanging.
 * Reconnect-class awaits against an already-spawned backend use the shorter
 * RECONNECT_ATTEMPT_TIMEOUT_MS below instead. */
export const BACKEND_BOOT_WAIT_TIMEOUT_MS = 45_000

// desktop.getConnection() / getConnectionFor() / revalidateConnection() /
// resolveGatewayWsUrl() are IPC round-trips into the main process with no
// timeout of their own (#93454). A wedged main-process round-trip (e.g. a
// stuck revalidation after a liveness-probe trip) otherwise hangs an awaiting
// caller forever. Every caller of these bounds them with this shared budget.
export const RECONNECT_ATTEMPT_TIMEOUT_MS = 20_000

/** Rejection raised by withTimeout. The bounded work is NOT cancelled — the
 * caller decides what a straggler that settles later means. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError
}

/** True while first-run bootstrap blocks backend reachability — renderer boot
 * must not burn BACKEND_BOOT_WAIT_TIMEOUT_MS during these phases. */
export function shouldSuspendBackendBootWait(snapshot: {
  bootstrapActive?: boolean
  bootstrapSetupChoice?: unknown | null
  bootPhase?: null | string
}): boolean {
  return (
    snapshot.bootstrapSetupChoice != null ||
    snapshot.bootstrapActive === true ||
    snapshot.bootPhase === 'bootstrap.choice'
  )
}

/** Like withTimeout, but the deadline only advances while `isSuspended()` is
 * false. Used for initial getConnection() while main is in first-run setup. */
export function withSuspendableTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  options: { isSuspended: () => boolean; pollMs?: number }
): Promise<T> {
  const pollMs = options.pollMs ?? 200

  return new Promise<T>((resolve, reject) => {
    let elapsed = 0
    let lastTick = Date.now()
    let settled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const finish = (fn: (value: T | TimeoutError) => void, value: T | TimeoutError) => {
      if (settled) {
        return
      }

      settled = true

      if (timer) {
        clearInterval(timer)
      }

      fn(value)
    }

    const tick = () => {
      if (settled) {
        return
      }

      const now = Date.now()

      if (!options.isSuspended()) {
        elapsed += now - lastTick

        if (elapsed >= ms) {
          finish(reject, new TimeoutError(message))

          return
        }
      }

      lastTick = now
    }

    timer = setInterval(tick, pollMs)
    lastTick = Date.now()

    Promise.resolve(promise).then(
      value => finish(resolve, value),
      err => finish(reject, err)
    )
  })
}

/** Settle with `promise`, or reject with a TimeoutError after `ms`.
 * `onTimeout` runs synchronously before the rejection is published so callers
 * can revoke ownership of work that would otherwise keep running unowned. If
 * that callback throws, its error becomes this promise's rejection. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout?: (error: TimeoutError) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new TimeoutError(message)

      try {
        onTimeout?.(error)
      } catch (onTimeoutError) {
        reject(onTimeoutError)

        return
      }

      reject(error)
    }, ms)

    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
