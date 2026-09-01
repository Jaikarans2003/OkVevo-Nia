// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Intro } from './intro'

afterEach(cleanup)

describe('Intro splash mark', () => {
  it('uses the Nia mark, not the OkVevo logo', () => {
    const { container } = render(<Intro seed={0} />)
    const img = container.querySelector('img')

    expect(img?.getAttribute('src')).toMatch(/nia\.png$/)
    expect(container.querySelector('.rounded-2xl')).toBeTruthy()
    expect(container.querySelector('[data-slot="aui_intro"]')).toBeTruthy()
  })
})
