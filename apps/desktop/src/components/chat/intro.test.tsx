// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Intro } from './intro'

afterEach(cleanup)

describe('Intro splash mark', () => {
  it('uses the rounded OkVevo logo, not the wordmark', () => {
    const { container } = render(<Intro seed={0} />)
    const img = container.querySelector('img')

    expect(img?.getAttribute('src')).toMatch(/okvevo-logo\.svg$/)
    expect(img?.className.split(/\s+/)).toEqual(expect.arrayContaining(['rounded-2xl', 'overflow-hidden']))
    expect(container.querySelector('[data-slot="aui_intro"]')).toBeTruthy()
  })
})
