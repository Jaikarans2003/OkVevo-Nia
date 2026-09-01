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

function hudComposerHideCss(full: string): string {
  const start = full.indexOf('/* HUD mode is the input and the log')
  const end = full.indexOf('/* The composer is the Spotlight bar')

  if (start < 0 || end < 0) {
    throw new Error('HUD composer hide rules not found in styles.css')
  }

  return full.slice(start, end)
}

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = hudComposerHideCss(readFileSync(STYLES, 'utf8'))
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
})
