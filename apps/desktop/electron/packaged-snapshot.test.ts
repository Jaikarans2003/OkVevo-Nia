import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  extractPackagedSnapshot,
  PACK_STAMP_FILENAME,
  packagedSnapshotLayout,
  readPackStamp,
  shouldRebootstrapFromPackagedSnapshot,
  writePackStamp
} from './packaged-snapshot'

test('shouldRebootstrapFromPackagedSnapshot is packaged+snapshot+stamp mismatch only', () => {
  assert.equal(
    shouldRebootstrapFromPackagedSnapshot({
      isPackaged: false,
      snapshotPresent: true,
      installStampCommit: 'a'.repeat(40),
      extractedStampCommit: null
    }),
    false
  )
  assert.equal(
    shouldRebootstrapFromPackagedSnapshot({
      isPackaged: true,
      snapshotPresent: false,
      installStampCommit: 'a'.repeat(40),
      extractedStampCommit: null
    }),
    false
  )
  assert.equal(
    shouldRebootstrapFromPackagedSnapshot({
      isPackaged: true,
      snapshotPresent: true,
      installStampCommit: 'a'.repeat(40),
      extractedStampCommit: null
    }),
    true
  )
  assert.equal(
    shouldRebootstrapFromPackagedSnapshot({
      isPackaged: true,
      snapshotPresent: true,
      installStampCommit: 'a'.repeat(40),
      extractedStampCommit: 'a'.repeat(40)
    }),
    false
  )
  assert.equal(
    shouldRebootstrapFromPackagedSnapshot({
      isPackaged: true,
      snapshotPresent: true,
      installStampCommit: 'b'.repeat(40),
      extractedStampCommit: 'a'.repeat(40)
    }),
    true
  )
})

test('layout requires archive and install script', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-layout-'))
  assert.equal(packagedSnapshotLayout(root), null)
  fs.writeFileSync(path.join(root, 'agent-snapshot.tar.gz'), 'x')
  assert.equal(packagedSnapshotLayout(root, 'darwin'), null)
  fs.writeFileSync(path.join(root, 'install.sh'), '#!/bin/sh\n')
  assert.ok(packagedSnapshotLayout(root, 'darwin'))
  fs.rmSync(root, { recursive: true, force: true })
})

test('extract preserves venv, drops .git, writes pack stamp', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-extract-'))
  const payload = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-payload-'))
  fs.mkdirSync(path.join(payload, 'hermes_cli'), { recursive: true })
  fs.writeFileSync(path.join(payload, 'hermes_cli', 'main.py'), 'print("ok")\n')
  fs.mkdirSync(path.join(payload, '.git'), { recursive: true })
  fs.writeFileSync(path.join(payload, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  const archive = path.join(root, 'agent-snapshot.tar.gz')
  const tar = spawnSync('tar', ['-czf', archive, '-C', payload, 'hermes_cli', '.git'], { encoding: 'utf8' })
  assert.equal(tar.status, 0, tar.stderr)

  const dest = path.join(root, 'hermes-agent')
  fs.mkdirSync(path.join(dest, 'venv', 'bin'), { recursive: true })
  fs.writeFileSync(path.join(dest, 'venv', 'bin', 'python'), '# keep\n')
  fs.writeFileSync(path.join(dest, 'stale.py'), 'old\n')

  extractPackagedSnapshot({
    archive,
    activeRoot: dest,
    commit: 'c'.repeat(40)
  })

  assert.ok(fs.existsSync(path.join(dest, 'hermes_cli', 'main.py')))
  assert.ok(fs.existsSync(path.join(dest, 'venv', 'bin', 'python')))
  assert.equal(fs.existsSync(path.join(dest, 'stale.py')), false)
  assert.equal(fs.existsSync(path.join(dest, '.git')), false)
  assert.equal(readPackStamp(dest)?.commit, 'c'.repeat(40))
  assert.equal(fs.existsSync(path.join(dest, PACK_STAMP_FILENAME)), true)

  writePackStamp(dest, { commit: 'd'.repeat(40) })
  assert.equal(readPackStamp(dest)?.commit, 'd'.repeat(40))

  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(payload, { recursive: true, force: true })
})
