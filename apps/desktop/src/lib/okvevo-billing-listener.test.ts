import { describe, expect, it } from 'vitest'

import {
  additionalRemainingPct,
  billingViewFromUserData,
  formatPctLabel,
  formatRemainingPct,
  formatOkvevoBillingDescription,
  periodRemainingDisplay,
  remainingPct
} from './okvevo-billing-listener'

describe('okvevo billing display', () => {
  it('remainingPct floors to two decimals, never rounds, and stays percent-only', () => {
    expect(remainingPct(20000, 10000)).toBe(50)
    expect(remainingPct(0, 10000)).toBe(0)
    expect(remainingPct(20000, 19931)).toBe(99.65)
    expect(formatRemainingPct(20000, 19931)).toBe('99.65%')
    expect(formatPctLabel(87.5)).toBe('87.5%')
    expect(formatPctLabel(50)).toBe('50%')
    expect(formatPctLabel(100)).toBe('100%')
  })

  it('plan remaining uses cycle grant total, not leftover or latest creditsIncluded', () => {
    expect(remainingPct(20000, 10000, 20000)).toBe(50)
    expect(remainingPct(60000, 70000, 80000)).toBe(87.5)
    expect(remainingPct(60000, 70000, 80000)).not.toBe(50)
    expect(remainingPct(60000, 70000, 80000)).not.toBe(100)
    expect(remainingPct(60000, 80000, 80000)).toBe(100)
    expect(remainingPct(60000, 79886, 80000)).toBe(99.85)
    expect(remainingPct(60000, 79886, 80000)).not.toBe(100)
    expect(remainingPct(60000, 59999, 60000)).toBe(99.99)
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

  it('billingViewFromUserData uses allocationGrantedTotal for stacked UPI grants', () => {
    const view = billingViewFromUserData({
      planName: 'Pro',
      planStatus: 'active',
      creditsIncluded: 60000,
      allocationBalance: 70000,
      allocationGrantedTotal: 80000,
      topUpBalance: 0,
      cancelAtPeriodEnd: false
    })

    expect(view.remainingPct).toBe(87.5)
    expect(formatPctLabel(view.remainingPct)).toBe('87.5%')
  })
})
