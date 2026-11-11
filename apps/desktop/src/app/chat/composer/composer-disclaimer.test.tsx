// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'

import { COMPOSER_DISCLAIMER_CLASS, ComposerDisclaimer } from './composer-disclaimer'

afterEach(cleanup)

const renderDisclaimer = (show: boolean) =>
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <ComposerDisclaimer show={show} />
    </I18nProvider>
  )

describe('ComposerDisclaimer', () => {
  it('renders the disclaimer when docked', () => {
    const { container } = renderDisclaimer(true)

    const el = container.querySelector('[data-slot="composer-disclaimer"]')
    expect(el).toBeTruthy()
    expect(el?.className).toContain(COMPOSER_DISCLAIMER_CLASS.split(' ')[0])
    expect(el?.textContent).toBe('OkVevo is an AI agent and can make mistakes. Check important info.')
  })

  it('is absent when popped out', () => {
    const { container } = renderDisclaimer(false)

    expect(container.querySelector('[data-slot="composer-disclaimer"]')).toBeNull()
  })
})
