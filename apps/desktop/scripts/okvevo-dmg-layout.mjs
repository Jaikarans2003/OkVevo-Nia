/**
 * OkVevo DMG window layout from brand/assets/.../dmg-layout.json.
 * electron-builder.config.cjs spreads this so syncs take upstream then re-apply.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { brandDmgBackground, brandDmgLayoutJson, repoRootFromDesktopScripts } from './okvevo-brand-paths.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

export function loadDmgLayout(root = repoRootFromDesktopScripts(here)) {
  const layoutPath = brandDmgLayoutJson(root)
  const raw = JSON.parse(fs.readFileSync(layoutPath, 'utf8'))
  const bgRel = String(raw.background || '')
  const background = path.isAbsolute(bgRel) ? bgRel : path.join(root, bgRel)
  const expected = brandDmgBackground(root)

  if (path.resolve(background) !== path.resolve(expected)) {
    throw new Error(`dmg-layout background must be ${expected}, got ${background}`)
  }

  if (!fs.existsSync(background)) {
    throw new Error(`missing DMG background ${background}`)
  }

  const retina = background.replace(/\.png$/i, '@2x.png')

  if (!fs.existsSync(retina)) {
    throw new Error(`missing DMG retina background ${retina}`)
  }

  // electron-builder rejects background + backgroundColor together — image only.
  if (raw.backgroundColor != null) {
    throw new Error('dmg-layout must not set backgroundColor when background is set')
  }

  return {
    shrink: false,
    icon: path.join(root, 'brand/assets/apps/desktop/assets/icon.icns'),
    title: 'OkVevo',
    background,
    iconSize: raw.iconSize,
    iconTextSize: raw.iconTextSize,
    window: raw.window,
    contents: raw.contents
  }
}
