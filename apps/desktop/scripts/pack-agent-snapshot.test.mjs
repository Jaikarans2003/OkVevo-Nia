import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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
  assert.ok(SNAPSHOT_DIRS.includes('brand'))
  assert.ok(SNAPSHOT_FILES.includes('pyproject.toml'))
  assert.ok(SNAPSHOT_FILES.includes('scripts/install.sh'))
  assert.ok(!SNAPSHOT_DIRS.includes('apps'))
  assert.doesNotThrow(() => assertSnapshotAllowlist(['hermes_cli', 'pyproject.toml', 'agent']))
  assert.throws(() => assertSnapshotAllowlist(['apps', 'hermes_cli', 'pyproject.toml']), /must not include apps/)
  assert.throws(() => assertSnapshotAllowlist(['pyproject.toml']), /missing hermes_cli/)
})

test('repo snapshot members exist and pack a readable tar.gz', { timeout: 60_000 }, () => {
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

  const listed = spawnSync('tar', ['-tzf', outFile], { encoding: 'utf8' })
  assert.equal(listed.status, 0)
  const names = listed.stdout.split('\n')
  assert.ok(names.some((name) => name.endsWith('okvevo/drama_fal_adapter.py')))
  assert.ok(names.some((name) => name.endsWith('skills/creative/short-drama-produce/scripts/provider_adapters.py')))
  assert.ok(names.some((name) => name.endsWith('skills/creative/short-drama-produce/references/okvevo-adapter.example.json')))
  for (const skill of [
    'short-drama',
    'short-drama-novel-analyze',
    'short-drama-develop',
    'short-drama-write',
    'short-drama-assets',
    'short-drama-image-prompts',
    'short-drama-storyboard',
    'short-drama-video-prompts',
    'short-drama-produce',
    'short-drama-edit',
    'short-drama-review'
  ]) {
    assert.ok(names.some((name) => name.includes(`skills/creative/${skill}/SKILL.md`)), skill)
  }
  assert.ok(names.some((name) => name.endsWith('skills/creative/short-drama/scripts/dashboard_server.py')))

  fs.rmSync(dir, { recursive: true, force: true })
})
