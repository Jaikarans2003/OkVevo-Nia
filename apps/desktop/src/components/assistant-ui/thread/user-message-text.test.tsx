import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { referenceRe, WIRE_REFERENCE_KINDS } from '@/components/assistant-ui/reference-kinds'

import { UserMessageText } from './user-message-text'

afterEach(cleanup)

/**
 * A sent reference must render as the chip the composer showed. These cover the
 * seam where that used to break: the value's quoting is directive syntax, and a
 * surface that reads it as markdown splits one reference into two wrong things.
 */
describe('a sent reference renders as the chip the composer showed', () => {
  it('chips a backtick-quoted @url: instead of splitting it into code', () => {
    render(
      <UserMessageText text="@url:`https://github.com/NousResearch/hermes-agent/pull/74790` urls lose formatting" />
    )

    expect(screen.queryByTitle('https://github.com/NousResearch/hermes-agent/pull/74790')).not.toBeNull()
    // The whole reference is one node — no bare `@url:` text left behind.
    expect(document.body.textContent).not.toContain('@url:')
  })

  it('chips a backtick-quoted @file: path with spaces', () => {
    render(<UserMessageText text="see @file:`apps/desktop/my notes.md` please" />)

    expect(screen.queryByTitle('apps/desktop/my notes.md')).not.toBeNull()
    expect(document.body.textContent).not.toContain('@file:')
  })

  it('chips every kind that travels in message text', () => {
    // The guard against WIRE_REFERENCE_KINDS and the pattern's own alternation
    // drifting apart: add a kind to one and this fails until both agree.
    for (const kind of WIRE_REFERENCE_KINDS) {
      expect(`@${kind}:\`some value\``.match(referenceRe()), kind).toHaveLength(1)
    }
  })

  it('wraps with break-words on the bubble shell, not w-max width hacks', () => {
    render(<UserMessageText text="Hi" />)

    const root = document.querySelector('[data-slot="aui_user-message-text"]')
    const inline = document.querySelector('[data-slot="aui_user-inline-text"]')

    expect(root?.className.split(/\s+/)).not.toContain('wrap-anywhere')
    expect(inline?.className.split(/\s+/)).not.toContain('wrap-anywhere')
    expect(root?.className.split(/\s+/)).not.toContain('w-max')
    expect(inline?.className.split(/\s+/)).not.toContain('w-max')
    expect(inline?.className.split(/\s+/)).toContain('break-words')
  })

  it('breaks a long unspaced token without horizontal overflow', () => {
    const longUrl =
      'https://example.com/very/long/path/with/no/break/points?query=abcdef0123456789abcdef0123456789abcdef0123456789'

    render(<UserMessageText text={longUrl} />)

    const inline = document.querySelector('[data-slot="aui_user-inline-text"]')

    expect(inline?.className.split(/\s+/)).toContain('break-words')

    const host = document.createElement('div')
    host.style.width = '320px'
    host.append(inline!.cloneNode(true))
    document.body.append(host)

    const measured = host.firstElementChild as HTMLElement
    expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth + 1)

    host.remove()
  })

  it('still renders a genuine code span as code', () => {
    render(<UserMessageText text="run `npm test` first" />)

    const code = document.querySelector('[data-slot="aui_user-inline-code"]')

    expect(code?.textContent).toBe('npm test')
  })

  it('renders code and a reference side by side', () => {
    render(<UserMessageText text="run `npm test` on @file:`apps/desktop/a b.ts` now" />)

    expect(document.querySelector('[data-slot="aui_user-inline-code"]')?.textContent).toBe('npm test')
    expect(screen.queryByTitle('apps/desktop/a b.ts')).not.toBeNull()
  })

  it('leaves a fenced block alone', () => {
    render(<UserMessageText text={'before\n```ts\nconst x = 1\n```\nafter'} />)

    expect(document.querySelector('[data-slot="aui_user-fence"]')?.textContent).toBe('const x = 1\n')
  })
})
