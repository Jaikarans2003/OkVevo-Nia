import { describe, expect, it } from 'vitest'

import {
  formatRemainingPct,
  formatOkvevoBillingDescription,
  periodRemainingDisplay
} from './okvevo-billing-listener'

describe('okvevo billing display', () => {
  it('formatRemainingPct shows percent, not raw allocation', () => {
    expect(formatRemainingPct(20000, 10000)).toBe('50%')
    expect(formatRemainingPct(0, 10000)).toBe('0%')
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
      remainingPctLabel: '50%',
      additional: 120,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false
    })

    expect(line).toBe('Starter · remaining 50% · additional 120 credits')
    expect(line).not.toMatch(/\b10000\b/)
  })
})
