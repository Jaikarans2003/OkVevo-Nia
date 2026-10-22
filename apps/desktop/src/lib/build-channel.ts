/** BYOK chrome: baked build channel only. Missing define → public (fail closed). */
export function isByokChromeVisible(): boolean {
  return typeof __OKVEVO_BUILD_CHANNEL__ !== 'undefined' && __OKVEVO_BUILD_CHANNEL__ === 'internal'
}
