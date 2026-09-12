import assert from 'node:assert/strict'

import {
  additionalRemainingPct,
  billingViewFromUserData,
  formatOkvevoBillingDescription,
  formatRemainingPct,
  periodRemainingDisplay,
  remainingPct
} from './okvevo-billing-listener.ts'

assert.equal(remainingPct(20000, 10000), 50)
assert.equal(remainingPct(0, 100), 0)
assert.equal(remainingPct(20000, 19931), 99)
assert.equal(formatRemainingPct(20000, 19931), '99%')
assert.equal(periodRemainingDisplay(60000, 60000), '100%')
assert.equal(additionalRemainingPct(5000, 10000), 50)

const period = periodRemainingDisplay(20000, 12345)
assert.match(period, /%$/)
assert.doesNotMatch(period, /12345/)

const view = billingViewFromUserData({
  planName: 'Pro',
  planStatus: 'active',
  creditsIncluded: 60000,
  allocationBalance: 30000,
  topUpBalance: 5000,
  cancelAtPeriodEnd: false
})

assert.equal(view.remainingPct, 50)
assert.equal(view.additionalPct, 100)
assert.doesNotMatch(String(view.remainingPct), /30000/)
assert.doesNotMatch(String(view.additionalPct), /5000/)

const line = formatOkvevoBillingDescription(view)
assert.match(line, /remaining 50%/)
assert.match(line, /additional 100%/)
assert.doesNotMatch(line, /30000/)
assert.doesNotMatch(line, /5000/)
assert.doesNotMatch(line, /credits/)

const purchased = billingViewFromUserData({
  planName: 'Pro',
  planStatus: 'active',
  creditsIncluded: 60000,
  allocationBalance: 30000,
  topUpBalance: 5000,
  topUpPurchasedTotal: 10000,
  cancelAtPeriodEnd: false
})

assert.equal(purchased.additionalPct, 50)
assert.doesNotMatch(String(purchased.additionalPct), /5000/)
assert.doesNotMatch(String(purchased.additionalPct), /10000/)

console.log('okvevo-billing-listener.selfcheck: ok')
