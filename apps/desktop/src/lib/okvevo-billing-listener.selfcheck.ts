import assert from 'node:assert/strict'

import {
  formatRemainingPct,
  periodRemainingDisplay,
  formatOkvevoBillingDescription,
  billingViewFromUserData
} from './okvevo-billing-listener.ts'

assert.equal(formatRemainingPct(20000, 10000), '50%')
assert.equal(formatRemainingPct(0, 100), '0%')
assert.equal(periodRemainingDisplay(60000, 60000), 'remaining 100%')

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
assert.equal(view.remainingPctLabel, '50%')
assert.equal(view.additional, 5000)
assert.doesNotMatch(view.remainingPctLabel, /30000/)

const line = formatOkvevoBillingDescription(view)
assert.match(line, /remaining 50%/)
assert.doesNotMatch(line, /30000/)

console.log('okvevo-billing-listener.selfcheck: ok')
