/**
 * OkVevo-owned brand icon paths. Upstream pack hooks call these so sync
 * conflicts take upstream then re-apply one-line helpers (see docs/okvevo/SYNC.md).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** hermes-agent git root (apps/desktop/scripts → ../../..) */
export function repoRootFromDesktopScripts(scriptDir = here) {
  return path.resolve(scriptDir, '../../..')
}

/** apps/desktop package root */
export function desktopRootFromScripts(scriptDir = here) {
  return path.resolve(scriptDir, '..')
}

export function brandDesktopAssets(root = repoRootFromDesktopScripts()) {
  return path.join(root, 'brand/assets/apps/desktop/assets')
}

export function brandLegacyMacIcns(root = repoRootFromDesktopScripts()) {
  return path.join(brandDesktopAssets(root), 'icon.icns')
}

export function brandWinIco(root = repoRootFromDesktopScripts()) {
  return path.join(brandDesktopAssets(root), 'icon.ico')
}

export function brandDmgVolumeIcns(root = repoRootFromDesktopScripts()) {
  return path.join(root, 'brand/assets/apps/desktop/packaging/dmg-volume.icns')
}

export function brandDmgLayoutJson(root = repoRootFromDesktopScripts()) {
  return path.join(root, 'brand/assets/apps/desktop/packaging/dmg-layout.json')
}

export function brandDmgBackground(root = repoRootFromDesktopScripts()) {
  return path.join(root, 'brand/assets/apps/desktop/packaging/dmg-background.png')
}

export function brandDmgBackground2x(root = repoRootFromDesktopScripts()) {
  return path.join(root, 'brand/assets/apps/desktop/packaging/dmg-background@2x.png')
}

export function brandPublicOkvevoPng(root = repoRootFromDesktopScripts()) {
  return path.join(root, 'brand/assets/apps/desktop/public/okvevo.png')
}
