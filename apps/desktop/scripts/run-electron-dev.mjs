#!/usr/bin/env node
// Hide node_modules/electron during dev launch so require/import('electron')
// resolves to Electron's built-in API instead of the npm CLI shim (path string).
// Node 24 ESM + Electron 40 otherwise leave app/BrowserWindow undefined in dev.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronPkg = path.join(root, 'node_modules', 'electron')
const stashDir = path.join(root, 'node_modules', '.electron-npm-stash')

function electronBinary(fromDir) {
  if (process.platform === 'darwin') {
    return path.join(fromDir, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  }
  if (process.platform === 'win32') {
    return path.join(fromDir, 'dist', 'electron.exe')
  }
  return path.join(fromDir, 'dist', 'electron')
}

let stashed = false
let electronDir = electronPkg

if (fs.existsSync(electronPkg) && !fs.existsSync(stashDir)) {
  fs.renameSync(electronPkg, stashDir)
  stashed = true
  electronDir = stashDir
} else if (fs.existsSync(stashDir)) {
  electronDir = stashDir
}

const bin = electronBinary(electronDir)
if (!fs.existsSync(bin)) {
  console.error(`[run-electron-dev] Electron binary not found: ${bin}`)
  process.exit(1)
}

function restore() {
  if (stashed && fs.existsSync(stashDir) && !fs.existsSync(electronPkg)) {
    fs.renameSync(stashDir, electronPkg)
  }
}

for (const sig of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    restore()
    if (sig !== 'exit') process.exit(sig === 'SIGINT' ? 130 : 143)
  })
}

const child = spawn(bin, ['.'], { cwd: root, stdio: 'inherit', env: process.env })
child.on('exit', (code, signal) => {
  restore()
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
