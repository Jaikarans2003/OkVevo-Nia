import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  SNAPSHOT_DIRS,
  SNAPSHOT_FILES,
  assertSnapshotAllowlist,
  existingSnapshotPaths,
  packAgentSnapshot,
  stageBundledInstallScripts
} from './pack-agent-snapshot.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')

test('allowlist includes hermes_cli and pyproject, not apps/desktop', () => {
  assert.ok(SNAPSHOT_DIRS.includes('hermes_cli'))
  assert.ok(SNAPSHOT_DIRS.includes('agent'))
  assert.ok(SNAPSHOT_FILES.includes('pyproject.toml'))
  assert.ok(SNAPSHOT_FILES.includes('scripts/install.sh'))
  assert.ok(!SNAPSHOT_DIRS.includes('apps'))
  assert.doesNotThrow(() => assertSnapshotAllowlist(['hermes_cli', 'pyproject.toml', 'agent']))
  assert.throws(() => assertSnapshotAllowlist(['apps', 'hermes_cli', 'pyproject.toml']), /must not include apps/)
  assert.throws(() => assertSnapshotAllowlist(['pyproject.toml']), /missing hermes_cli/)
})

test('repo snapshot members exist and pack a readable tar.gz', () => {
  const members = existingSnapshotPaths(REPO_ROOT)
  assert.ok(members.includes('hermes_cli'))
  assert.ok(members.includes('pyproject.toml'))
  assert.ok(members.includes('scripts/install.sh'))
  assert.ok(!members.includes('apps'))

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-snap-'))
  const outFile = path.join(dir, 'agent-snapshot.tar.gz')
  packAgentSnapshot({ repoRoot: REPO_ROOT, outFile })
  assert.ok(fs.statSync(outFile).size > 1000)

  const staged = path.join(dir, 'scripts-out')
  const copied = stageBundledInstallScripts({ repoRoot: REPO_ROOT, outDir: staged })
  assert.equal(copied.length, 2)
  assert.ok(fs.existsSync(path.join(staged, 'install.sh')))
  assert.ok(fs.existsSync(path.join(staged, 'install.ps1')))

  fs.rmSync(dir, { recursive: true, force: true })
})
