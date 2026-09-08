/** BYOK chrome: baked build channel only. Missing define → public (fail closed). */
export function isByokChromeVisible(): boolean {
  return typeof __NIA_BUILD_CHANNEL__ !== 'undefined' && __NIA_BUILD_CHANNEL__ === 'internal'
}
