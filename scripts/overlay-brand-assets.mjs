import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function insideRoot(root, dest) {
  const resolved = path.resolve(root)
  return dest === resolved || dest.startsWith(resolved + path.sep)
}

function walk(dir, onFile) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, onFile)
    else onFile(abs)
  }
}

export function overlayBrandAssets(root) {
  const spec = JSON.parse(readFileSync(path.join(root, 'brand', 'nia.json'), 'utf8'))
  const overlay = spec.assetOverlay
  if (!overlay || !overlay.root) throw new Error('brand/nia.json assetOverlay.root missing')
  const assetRoot = path.resolve(root, overlay.root)
  const copied = []
  if (existsSync(assetRoot)) {
    walk(assetRoot, (abs) => {
      const rel = path.relative(assetRoot, abs)
      const dest = path.resolve(root, rel)
      if (!insideRoot(root, dest)) throw new Error(`overlay escapes root: ${rel}`)
      mkdirSync(path.dirname(dest), { recursive: true })
      copyFileSync(abs, dest)
      copied.push(rel.split(path.sep).join('/'))
    })
  }
  const removed = []
  for (const rel of overlay.remove || []) {
    const dest = path.resolve(root, rel)
    if (!insideRoot(root, dest)) throw new Error(`remove escapes root: ${rel}`)
    if (existsSync(dest)) rmSync(dest)
    removed.push(rel)
  }
  return { copied, removed }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = overlayBrandAssets(root)
  console.log(`[brand] overlaid ${result.copied.length} assets, removed ${result.removed.length}`)
}
