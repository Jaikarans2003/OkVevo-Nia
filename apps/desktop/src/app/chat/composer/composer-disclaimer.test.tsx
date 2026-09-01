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

    expect(container.querySelector('[data-slot="composer-disclaimer"]')).toBeTruthy()
    expect(container.querySelector('[data-slot="composer-disclaimer"]')?.className).toContain(
      COMPOSER_DISCLAIMER_CLASS.split(' ')[0]
    )
  })

  it('is absent when popped out or in splash column', () => {
    const { container } = renderDisclaimer(false)

    expect(container.querySelector('[data-slot="composer-disclaimer"]')).toBeNull()
  })
})
