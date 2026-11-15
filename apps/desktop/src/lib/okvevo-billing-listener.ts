/**
 * OkVevo billing display helpers for Settings → Billing.
 * Percentages come from GET /api/billing/summary (main process IPC) — never raw balances.
 */

export type OkvevoBillingView = {
  planName: string | null
  planStatus: string | null
  remainingPct: number
  additionalPct: number
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  entitled: boolean
  additionalNextExpiry: Date | null
  canPurchase: boolean
  fundedBy: string | null
}

export type OkvevoBillingData = OkvevoBillingView

/** Trim trailing zeros: 87.5%, 99.86%, 50%, 100%. */
export function formatPctLabel(pct: number): string {
  if (!Number.isFinite(pct)) {
    return '0%'
  }

  const hundredths = Math.round(Math.min(100, Math.max(0, pct)) * 100)
  const whole = Math.floor(hundredths / 100)
  const frac = hundredths % 100

  if (frac === 0) {
    return `${whole}%`
  }

  if (frac % 10 === 0) {
    return `${whole}.${frac / 10}%`
  }

  return `${whole}.${String(frac).padStart(2, '0')}%`
}

export function formatOkvevoBillingDescription(data: OkvevoBillingView): string {
  const plan = data.planName || 'None'

  return `${plan} · remaining ${formatPctLabel(data.remainingPct)} · additional ${formatPctLabel(data.additionalPct)}`
}

function toDate(v: unknown): Date | null {
  if (!v) {
    return null
  }

  if (v instanceof Date) {
    return v
  }

  if (typeof v === 'string') {
    const d = new Date(v)

    return Number.isNaN(d.getTime()) ? null : d
  }

  return null
}

function readPct(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
}

/** Map server billing summary JSON → view model. */
export function billingViewFromSummary(data: Record<string, unknown> | undefined): OkvevoBillingView {
  if (!data) {
    return {
      planName: null,
      planStatus: null,
      remainingPct: 0,
      additionalPct: 0,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      entitled: false,
      additionalNextExpiry: null,
      canPurchase: true,
      fundedBy: null
    }
  }

  return {
    planName: typeof data.planName === 'string' ? data.planName : null,
    planStatus: typeof data.status === 'string' ? data.status : typeof data.planStatus === 'string' ? data.planStatus : null,
    remainingPct: readPct(data.remainingPct),
    additionalPct: readPct(data.additionalPct),
    currentPeriodEnd: toDate(data.periodEnd ?? data.currentPeriodEnd),
    cancelAtPeriodEnd: data.cancelAtPeriodEnd === true,
    entitled: data.entitled === true,
    additionalNextExpiry: toDate(data.additionalNextExpiry),
    canPurchase: data.canPurchase !== false,
    fundedBy: typeof data.fundedBy === 'string' ? data.fundedBy : null
  }
}
