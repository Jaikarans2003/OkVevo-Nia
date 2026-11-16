/**
 * Billing display maps server summary percentages only.
 * Run: npx tsx src/lib/okvevo-billing-listener.selfcheck.ts
 */
import assert from 'node:assert/strict'

import {
  billingViewFromSummary,
  formatOkvevoBillingDescription,
  formatPctLabel
} from './okvevo-billing-listener.ts'

assert.equal(formatPctLabel(87.5), '87.5%')
assert.equal(formatPctLabel(50), '50%')

const view = billingViewFromSummary({
  planName: 'Pro',
  status: 'active',
  remainingPct: 50,
  additionalPct: 50,
  periodEnd: '2030-01-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  entitled: true,
  canPurchase: true
})

assert.equal(view.remainingPct, 50)
assert.equal(view.additionalPct, 50)
assert.doesNotMatch(formatOkvevoBillingDescription(view), /30000|credits/)

const ended = billingViewFromSummary({ status: 'ended', entitled: false, remainingPct: 0 })
assert.equal(ended.planStatus, 'ended')
assert.equal(ended.entitled, false)

console.log('okvevo-billing-listener.selfcheck: ok')
