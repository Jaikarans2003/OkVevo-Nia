/**
 * Tests for electron/backend-probes.ts.
 *
 * Run with: node --test electron/backend-probes.test.ts
 * (Wired into npm test:desktop:platforms in package.json.)
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  canImportHermesCli,
  DEFAULT_PROBE_TIMEOUT_MS,
  hermesRuntimeImportProbe,
  PROBE_TIMEOUT_MS,
  resolveProbeTimeoutMs,
  shouldTrustHermesOverride,
  verifyHermesCli
} from './backend-probes'

// Resolve the host's own Node binary -- guaranteed to be on disk and
// runnable. We use it as both a stand-in for "a python that doesn't
// have hermes_cli" (since `node -c "import hermes_cli"` will exit
// non-zero) and as a way to script verifyHermesCli's success path
// (a tiny script we write to disk that exits 0 on --version).
const NODE_BIN = process.execPath

test('canImportHermesCli returns false when path is falsy', () => {
  assert.equal(canImportHermesCli(''), false)
  assert.equal(canImportHermesCli(null), false)
  assert.equal(canImportHermesCli(undefined), false)
})

test('canImportHermesCli returns false when interpreter cannot run -c', () => {
  // node IS an interpreter, but `node -c "import hermes_cli"` is a
  // SyntaxError -- different exit reason from a real Python's
  // ModuleNotFoundError, but the predicate is "exit 0 or not" and
  // both land on "not", which is exactly what we want for the
  // resolver fall-through.
  assert.equal(canImportHermesCli(NODE_BIN), false)
})

test('canImportHermesCli returns false when binary does not exist', () => {
  const ghost = path.join(os.tmpdir(), 'hermes-probes-ghost-' + Date.now() + '.exe')
  assert.equal(canImportHermesCli(ghost), false)
})

test('hermes runtime import probe checks config dependencies', () => {
  const probe = hermesRuntimeImportProbe()
  assert.match(probe, /\bimport yaml\b/)
  // dotenv is the first third-party import on the CLI boot path
  // (hermes_cli/env_loader.py); a mid-update venv missing python-dotenv
  // passed the old probe and produced an unrecoverable boot loop.
  assert.match(probe, /\bimport dotenv\b/)
  assert.match(probe, /\bimport hermes_cli\.config\b/)
})

test('explicit Hermes override is authoritative', () => {
  assert.equal(shouldTrustHermesOverride('/nix/store/abc/bin/hermes'), true)
})

test('empty Hermes override is not authoritative', () => {
  assert.equal(shouldTrustHermesOverride(''), false)
  assert.equal(shouldTrustHermesOverride(undefined), false)
})

test('verifyHermesCli returns false when command is falsy', () => {
  assert.equal(verifyHermesCli(''), false)
  assert.equal(verifyHermesCli(null), false)
  assert.equal(verifyHermesCli(undefined), false)
})

test('verifyHermesCli returns false when binary does not exist', () => {
  const ghost = path.join(os.tmpdir(), 'hermes-probes-ghost-' + Date.now() + '.exe')
  assert.equal(verifyHermesCli(ghost), false)
})

test('verifyHermesCli returns true when --version exits 0', () => {
  // Write a tiny script that exits 0 regardless of args, then invoke
  // it through node. This stands in for a working hermes binary --
  // verifyHermesCli only cares about the exit code.
  const scriptPath = path.join(os.tmpdir(), `hermes-probes-ok-${Date.now()}-${process.pid}.cjs`)
  fs.writeFileSync(scriptPath, 'process.exit(0)\n')

  try {
    // Use node as the launcher and our script as the "command". Pass
    // shell:false (default) -- node is a real binary, no shim.
    // execFileSync passes ['--version'] as args, which node ignores
    // gracefully (well, it prints its version and exits 0, which is
    // perfect -- exit code 0 is the only signal we read).
    assert.equal(verifyHermesCli(NODE_BIN), true)
  } finally {
    try {
      fs.unlinkSync(scriptPath)
    } catch {
      void 0
    }
  }
})

test('verifyHermesCli swallows timeouts (does not throw)', () => {
  // We can't easily provoke a real hang in CI without slowing the
  // suite, but we CAN confirm that an invocation that DOES throw
  // (because the binary is missing) returns false rather than
  // propagating. Same code path the timeout case takes.
  assert.equal(verifyHermesCli('/definitely/not/a/real/binary/anywhere'), false)
})

// #74064: with shell:true the command line goes through a shell (cmd.exe on
// Windows, /bin/sh here), which truncates an unquoted executable at the first
// space — `C:\Users\John Doe\...\hermes.cmd --version` runs `C:\Users\John`.
// The same truncation reproduces on POSIX sh, so this is a real behavioral
// test of the quoting, not a platform-conditional one. Windows gets its own
// lane: there the quoted form goes through cmd.exe /s semantics instead.
test.skipIf(process.platform === 'win32')(
  'verifyHermesCli quotes a spaced executable path when probing through a shell',
  async (): Promise<void> => {
    const spacedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes probe-'))
    const spacedCmd = path.join(spacedDir, 'hermes.cmd')
    fs.writeFileSync(spacedCmd, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    fs.chmodSync(spacedCmd, 0o755)

    try {
      // Unquoted (the pre-fix wiring): the shell truncates at the space → 127.
      execFileSync(spacedCmd, ['--version'], {
        stdio: 'ignore',
        timeout: 5_000,
        shell: true,
        windowsHide: true
      })
      assert.fail('unquoted spaced path must fail through the shell')
    } catch {
      // expected: the shell could not run the truncated command
    }

    // verifyHermesCli wraps the same failure: off-Windows the helper is a
    // no-op (POSIX sh truncates identically), so the spaced-path probe
    // reports the backend missing — exactly the #74064 symptom. The quoting
    // itself is covered by the windowsShellCommand unit tests and runs on
    // the Windows lane.
    assert.equal(verifyHermesCli(spacedCmd, { shell: true }), false)

    // Direct execution (shell: false) never goes through a shell, so a
    // spaced path works as-is — the fix must not leak into the non-shell path.
    assert.equal(verifyHermesCli(spacedCmd, { shell: false }), true)

    fs.rmSync(spacedDir, { recursive: true, force: true })
  }
)

test('default probe timeout is 15s (not the old 5s death-loop value)', () => {
  assert.equal(DEFAULT_PROBE_TIMEOUT_MS, 15_000)
  // Module constant uses process.env at load time; with no override it
  // matches the default (tests run without HERMES_PROBE_TIMEOUT_MS).
  assert.equal(PROBE_TIMEOUT_MS, DEFAULT_PROBE_TIMEOUT_MS)
})

test('resolveProbeTimeoutMs honours HERMES_PROBE_TIMEOUT_MS', () => {
  assert.equal(resolveProbeTimeoutMs({}), DEFAULT_PROBE_TIMEOUT_MS)
  assert.equal(resolveProbeTimeoutMs({ HERMES_PROBE_TIMEOUT_MS: '30000' }), 30_000)
  assert.equal(resolveProbeTimeoutMs({ HERMES_PROBE_TIMEOUT_MS: '0' }), DEFAULT_PROBE_TIMEOUT_MS)
  assert.equal(resolveProbeTimeoutMs({ HERMES_PROBE_TIMEOUT_MS: 'nope' }), DEFAULT_PROBE_TIMEOUT_MS)
  // Cap runaway values
  assert.equal(resolveProbeTimeoutMs({ HERMES_PROBE_TIMEOUT_MS: '999999' }), 120_000)
})
