import assert from 'node:assert/strict'

import { test } from 'vitest'

import { ABOUT_CREDITS, HERMES_ATTRIBUTION_LINE, OKVEVO_COMPANY_LINE, OKVEVO_COPYRIGHT } from './okvevo-about'

test('About credits name the company and the Hermes attribution', () => {
  assert.equal(ABOUT_CREDITS, `${OKVEVO_COMPANY_LINE}\n${HERMES_ATTRIBUTION_LINE}`)
  assert.match(ABOUT_CREDITS, /OkVevo by Azonova Technologies Pvt Ltd/)
  assert.match(ABOUT_CREDITS, /Built on Hermes Agent by Nous Research/)
  assert.equal(OKVEVO_COPYRIGHT, '© 2026 Azonova Technologies Pvt Ltd')
})
