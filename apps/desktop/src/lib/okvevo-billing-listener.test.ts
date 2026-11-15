import { describe, expect, it } from 'vitest'

import {
  billingViewFromSummary,
  formatOkvevoBillingDescription,
  formatPctLabel
} from './okvevo-billing-listener'

describe('okvevo billing display', () => {
  it('formatPctLabel trims trailing zeros', () => {
    expect(formatPctLabel(87.5)).toBe('87.5%')
    expect(formatPctLabel(50)).toBe('50%')
    expect(formatPctLabel(100)).toBe('100%')
    expect(formatPctLabel(99.65)).toBe('99.65%')
  })

  it('formatOkvevoBillingDescription uses % only', () => {
    const line = formatOkvevoBillingDescription({
      planName: 'Starter',
      planStatus: 'active',
      remainingPct: 50,
      additionalPct: 40,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      entitled: true,
      additionalNextExpiry: null,
      canPurchase: true,
      fundedBy: null
    })

    expect(line).toBe('Starter · remaining 50% · additional 40%')
    expect(line).not.toMatch(/credits/)
  })

  it('billingViewFromSummary maps server percentages and never needs raw balances', () => {
    const view = billingViewFromSummary({
      planName: 'Pro',
      status: 'active',
      remainingPct: 50,
      additionalPct: 50,
      periodEnd: '2030-01-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      entitled: true,
      additionalNextExpiry: null,
      canPurchase: true,
      fundedBy: null
    })

    expect(view.remainingPct).toBe(50)
    expect(view.additionalPct).toBe(50)
    expect(view.planStatus).toBe('active')
    expect(view.currentPeriodEnd?.toISOString()).toBe('2030-01-01T00:00:00.000Z')
    expect(view.entitled).toBe(true)
    expect(formatOkvevoBillingDescription(view)).not.toMatch(/allocation|topUp|credits/i)
  })

  it('billingViewFromSummary treats ended status and canPurchase=false', () => {
    const view = billingViewFromSummary({
      status: 'ended',
      remainingPct: 10,
      additionalPct: 0,
      entitled: false,
      canPurchase: false,
      fundedBy: 'Acme'
    })

    expect(view.planStatus).toBe('ended')
    expect(view.entitled).toBe(false)
    expect(view.canPurchase).toBe(false)
    expect(view.fundedBy).toBe('Acme')
  })
})
