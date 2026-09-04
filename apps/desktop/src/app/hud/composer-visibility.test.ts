import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const STYLES = join(dirname(fileURLToPath(import.meta.url)), '../../styles.css')

/** Post-splash dock anatomy: composer-root nests inside composer-column. */
function mountHudDock() {
  document.body.innerHTML = `
    <div data-hud-shell>
      <div data-slot="composer-dock">
        <div class="wrapper">
          <div data-slot="composer-column">
            <div id="status-chrome">status</div>
            <div data-slot="composer-root" id="composer">input</div>
            <div id="underside">underside</div>
          </div>
          <p data-slot="composer-disclaimer">disclaimer</p>
        </div>
      </div>
    </div>
  `
}

function hudComposerCss(full: string): string {
  const hideStart = full.indexOf('/* HUD mode is the input and the log')
  const hideEnd = full.indexOf('/* The composer is the Spotlight bar')
  const dockStart = full.indexOf('[data-hud-shell] [data-slot=\'composer-dock\'] {')
  const composerStart = full.indexOf('[data-hud-shell] [data-slot=\'composer-root\'] {')

  if (hideStart < 0 || hideEnd < 0 || dockStart < 0 || composerStart < 0) {
    throw new Error('HUD composer rules not found in styles.css')
  }

  return `${full.slice(hideStart, hideEnd)}${full.slice(dockStart, composerStart + 400)}`
}

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = hudComposerCss(readFileSync(STYLES, 'utf8'))
  document.head.append(style)
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('HUD composer visibility', () => {
  it('keeps composer-root visible inside the nested composer-column', () => {
    mountHudDock()

    const composer = document.getElementById('composer')!
    const status = document.getElementById('status-chrome')!
    const underside = document.getElementById('underside')!
    const disclaimer = document.querySelector('[data-slot="composer-disclaimer"]')!

    expect(getComputedStyle(composer).display).not.toBe('none')
    expect(getComputedStyle(status).display).toBe('none')
    expect(getComputedStyle(underside).display).toBe('none')
    expect(getComputedStyle(disclaimer).display).toBe('none')
  })

  it('disables the dock frost pseudo-element in HUD mode', () => {
    const css = readFileSync(STYLES, 'utf8')

    expect(css).toMatch(
      /\[data-hud-shell\] \[data-slot='composer-dock'\]::before[\s\S]*?content:\s*none\s*!important/
    )
  })
})
