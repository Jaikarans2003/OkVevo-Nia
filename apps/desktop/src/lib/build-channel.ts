/** BYOK chrome: baked build channel only. Missing define → public (fail closed). */
export function isByokChromeVisible(): boolean {
  return typeof __OKVEVO_BUILD_CHANNEL__ !== 'undefined' && __OKVEVO_BUILD_CHANNEL__ === 'internal'
}

const PUBLIC_BYOK_KEY = /(?:_API_KEY|_TOKEN|_SECRET)$|^FAL_KEY$/

/** Public builds cannot save or reveal bring-your-own-key settings. */
export function refusePublicByokWrite(key: string, providerSetup = false): void {
  if (isByokChromeVisible()) {
    return
  }

  if (providerSetup || PUBLIC_BYOK_KEY.test(key)) {
    throw new Error('This build does not save API keys.')
  }
}
