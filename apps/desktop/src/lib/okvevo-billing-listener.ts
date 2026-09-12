/**
 * Live OkVevo billing snapshot for desktop Settings → Billing.
 * Period remaining is always a percentage — never raw allocationBalance.
 */
import { signInWithCustomToken, signOut } from 'firebase/auth'
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'

import { getOkvevoFirebase, okvevoFirebaseConfigured } from './okvevo-firebase'

export type OkvevoBillingView = {
  planName: string | null
  planStatus: string | null
  remainingPct: number
  additionalPct: number
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export type OkvevoBillingData = OkvevoBillingView

/** Floored 0–100. Never round — 19931/20000 is 99%, not 100%. */
export function remainingPct(creditsIncluded: number, allocationBalance: number): number {
  if (!Number.isInteger(creditsIncluded) || creditsIncluded <= 0) return 0
  const alloc =
    typeof allocationBalance === 'number' && Number.isInteger(allocationBalance) && allocationBalance >= 0
      ? allocationBalance
      : 0
  return Math.max(0, Math.min(100, Math.floor((alloc / creditsIncluded) * 100)))
}

export function additionalRemainingPct(topUpBalance: number, topUpPurchasedTotal: number): number {
  const leftover =
    typeof topUpBalance === 'number' && Number.isInteger(topUpBalance) && topUpBalance >= 0 ? topUpBalance : 0
  const purchased =
    typeof topUpPurchasedTotal === 'number' && Number.isInteger(topUpPurchasedTotal) && topUpPurchasedTotal >= 0
      ? topUpPurchasedTotal
      : 0
  return remainingPct(Math.max(purchased, leftover), leftover)
}

export function formatRemainingPct(creditsIncluded: number, allocationBalance: number): string {
  return `${remainingPct(creditsIncluded, allocationBalance)}%`
}

/** Period figure is percent-only — never embed raw allocationBalance. */
export function periodRemainingDisplay(creditsIncluded: number, allocationBalance: number): string {
  const label = formatRemainingPct(creditsIncluded, allocationBalance)

  if (creditsIncluded > 0 && allocationBalance > 0 && label.includes(String(allocationBalance))) {
    throw new Error('periodRemainingDisplay must not expose raw allocation balance')
  }

  return label
}

export function formatOkvevoBillingDescription(data: OkvevoBillingView): string {
  const plan = data.planName || 'None'

  return `${plan} · remaining ${data.remainingPct}% · additional ${data.additionalPct}%`
}

function readInt(n: unknown): number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0
}

function toDate(v: unknown): Date | null {
  if (!v) return null
  if (v instanceof Date) return v
  if (
    typeof v === 'object' &&
    v !== null &&
    'toDate' in v &&
    typeof (v as { toDate: () => Date }).toDate === 'function'
  ) {
    return (v as { toDate: () => Date }).toDate()
  }
  return null
}

export function billingViewFromUserData(data: Record<string, unknown> | undefined): OkvevoBillingView {
  if (!data) {
    return {
      planName: null,
      planStatus: null,
      remainingPct: 0,
      additionalPct: 0,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false
    }
  }
  const creditsIncluded = readInt(data.creditsIncluded)
  const allocationBalance = readInt(data.allocationBalance)
  let topUpBalance = readInt(data.topUpBalance)
  const legacy = readInt(data.creditBalance)
  if (allocationBalance === 0 && topUpBalance === 0 && legacy > 0 && data.topUpBalance === undefined) {
    topUpBalance = legacy
  }
  return {
    planName: typeof data.planName === 'string' ? data.planName : null,
    planStatus: typeof data.planStatus === 'string' ? data.planStatus : null,
    remainingPct: remainingPct(creditsIncluded, allocationBalance),
    additionalPct: additionalRemainingPct(topUpBalance, readInt(data.topUpPurchasedTotal)),
    currentPeriodEnd: toDate(data.currentPeriodEnd),
    cancelAtPeriodEnd: data.cancelAtPeriodEnd === true
  }
}

export async function subscribeOkvevoUserBilling(
  uid: string,
  customToken: string,
  onData: (view: OkvevoBillingView) => void,
  onError?: (err: Error) => void
): Promise<Unsubscribe> {
  if (!uid || !customToken || !okvevoFirebaseConfigured()) {
    onData(billingViewFromUserData(undefined))
    return () => {}
  }
  const fb = getOkvevoFirebase()
  if (!fb) {
    onData(billingViewFromUserData(undefined))
    return () => {}
  }

  await signInWithCustomToken(fb.auth, customToken)
  const unsub = onSnapshot(
    doc(fb.db, 'users', uid),
    snap => {
      onData(billingViewFromUserData(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined))
    },
    err => {
      console.error('okvevo billing snapshot', err)
      onError?.(err)
    }
  )

  return () => {
    unsub()
    void signOut(fb.auth).catch(() => {})
  }
}
