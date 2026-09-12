import { describe, expect, it } from 'vitest'

import {
  additionalRemainingPct,
  billingViewFromUserData,
  formatOkvevoBillingDescription,
  formatRemainingPct,
  periodRemainingDisplay,
  remainingPct
} from './okvevo-billing-listener'

describe('okvevo billing display', () => {
  it('remainingPct floors, never rounds, and stays percent-only', () => {
    expect(remainingPct(20000, 10000)).toBe(50)
    expect(remainingPct(0, 10000)).toBe(0)
    expect(remainingPct(20000, 19931)).toBe(99)
    expect(formatRemainingPct(20000, 19931)).toBe('99%')
  })

  it('additionalRemainingPct uses purchased total as the denominator', () => {
    expect(additionalRemainingPct(5000, 10000)).toBe(50)
    expect(additionalRemainingPct(5000, 0)).toBe(100)
    expect(additionalRemainingPct(0, 0)).toBe(0)
  })

  it('periodRemainingDisplay never includes raw allocation when creditsIncluded > 0', () => {
    const line = periodRemainingDisplay(20000, 10000)

    expect(line).toBe('50%')
    expect(line).not.toContain('10000')
    expect(line).not.toContain('20000')
  })

  it('formatOkvevoBillingDescription uses % for period remaining', () => {
    const line = formatOkvevoBillingDescription({
      planName: 'Starter',
      planStatus: 'active',
      remainingPct: 50,
      additionalPct: 40,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false
    })

    expect(line).toBe('Starter · remaining 50% · additional 40%')
    expect(line).not.toMatch(/\b10000\b/)
    expect(line).not.toMatch(/credits/)
  })

  it('billingViewFromUserData never surfaces raw balances', () => {
    const view = billingViewFromUserData({
      planName: 'Pro',
      planStatus: 'active',
      creditsIncluded: 60000,
      allocationBalance: 30000,
      topUpBalance: 5000,
      topUpPurchasedTotal: 10000,
      cancelAtPeriodEnd: false
    })

    expect(view.remainingPct).toBe(50)
    expect(view.additionalPct).toBe(50)
    expect(formatOkvevoBillingDescription(view)).not.toMatch(/30000|5000|10000|credits/)
  })
})
