import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  additionalRemainingPct,
  billingViewFromUserData,
  formatOkvevoBillingDescription,
  formatPctLabel,
  formatRemainingPct,
  periodRemainingDisplay,
  remainingPct
} from './okvevo-billing-listener'

assert.equal(remainingPct(20000, 10000), 50)
assert.equal(remainingPct(0, 100), 0)
assert.equal(remainingPct(20000, 19931), 99.65)
assert.equal(formatRemainingPct(20000, 19931), '99.65%')
assert.equal(periodRemainingDisplay(60000, 60000), '100%')
assert.equal(additionalRemainingPct(5000, 10000), 50)
assert.equal(remainingPct(60000, 70000, 80000), 87.5)
assert.notEqual(remainingPct(60000, 70000, 80000), 50)
assert.notEqual(remainingPct(60000, 70000, 80000), 100)
assert.equal(remainingPct(60000, 79886, 80000), 99.85)
assert.equal(remainingPct(60000, 59999, 60000), 99.99)
assert.equal(formatPctLabel(87.5), '87.5%')
assert.equal(formatPctLabel(50), '50%')

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

const stacked = billingViewFromUserData({
  planName: 'Pro',
  planStatus: 'active',
  creditsIncluded: 60000,
  allocationBalance: 70000,
  allocationGrantedTotal: 80000,
  topUpBalance: 0,
  cancelAtPeriodEnd: false
})
assert.equal(stacked.remainingPct, 87.5)

const billingPage = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../app/settings/billing/index.tsx'),
  'utf8'
)
assert.match(billingPage, /formatPctLabel/)
assert.doesNotMatch(billingPage, /Number\.isInteger\(pct\)/)
assert.match(billingPage, /fillStyle=\{\{ width: `\$\{clamped\}%` \}\}/)

console.log('okvevo-billing-listener.selfcheck: ok')
