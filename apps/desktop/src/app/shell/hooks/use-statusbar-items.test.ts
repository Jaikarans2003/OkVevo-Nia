import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'use-statusbar-items.tsx'), 'utf8')

describe('useStatusbarItems chrome', () => {
  it('does not register a terminal statusbar item or toggle', () => {
    expect(source).not.toMatch(/id:\s*'terminal'/)
    expect(source).not.toMatch(/toggleTerminal/)
  })
})
