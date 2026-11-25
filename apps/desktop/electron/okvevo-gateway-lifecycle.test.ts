import assert from 'node:assert/strict'
import path from 'node:path'

import { test } from 'vitest'

import {
  clearDesktopGatewayMarker,
  isOkvevoPackagedGateway,
  parseGatewayLock,
  reclaimStaleOkvevoDesktopGateway,
  shouldTakeOverStaleDesktopGateway,
  stopOkvevoDesktopGateway,
  writeDesktopGatewayMarker
} from './okvevo-gateway-lifecycle'

const HOME = '/tmp/okvevo-gw-home'

const PACKAGED = {
  pid: 4242,
  kind: 'hermes-gateway',
  argv: [
    '/Applications/OkVevo.app/Contents/Resources/agent-payload/hermes-agent/hermes_cli/main.py',
    'gateway',
    'run',
    '--quiet'
  ],
  hermes_home: HOME
}

const CLI = {
  pid: 9001,
  kind: 'hermes-gateway',
  argv: ['/usr/local/bin/hermes', 'gateway', 'run'],
  hermes_home: HOME
}

test('parseGatewayLock reads a live lock record', () => {
  const record = parseGatewayLock(JSON.stringify(PACKAGED))
  assert.equal(record?.pid, 4242)
  assert.ok(isOkvevoPackagedGateway(record))
})

test('CLI argv is never treated as an OkVevo packaged gateway', () => {
  assert.equal(isOkvevoPackagedGateway(CLI), false)
  assert.equal(isOkvevoPackagedGateway(null), false)
})

test('shouldTakeOver is false for a live CLI owner even when the socket is dead', async () => {
  const files = new Map<string, string>([[path.join(HOME, 'gateway.lock'), JSON.stringify(CLI)]])

  const takeover = await shouldTakeOverStaleDesktopGateway(HOME, {
    existsSync: p => files.has(p) || p.endsWith('gateway.sock'),
    readFileSync: p => files.get(p) || '',
    isPidAlive: pid => pid === 9001,
    connectSocket: async () => false
  })

  assert.equal(takeover, false)
})

test('shouldTakeOver is true for a packaged owner whose socket does not answer', async () => {
  const files = new Map<string, string>([[path.join(HOME, 'gateway.lock'), JSON.stringify(PACKAGED)]])

  const takeover = await shouldTakeOverStaleDesktopGateway(HOME, {
    existsSync: p => files.has(p) || p.endsWith('gateway.sock'),
    readFileSync: p => files.get(p) || '',
    isPidAlive: pid => pid === 4242,
    connectSocket: async () => false
  })

  assert.equal(takeover, true)
})

test('shouldTakeOver is false when the packaged owner still answers', async () => {
  const files = new Map<string, string>([[path.join(HOME, 'gateway.lock'), JSON.stringify(PACKAGED)]])

  const takeover = await shouldTakeOverStaleDesktopGateway(HOME, {
    existsSync: p => files.has(p) || p.endsWith('gateway.sock'),
    readFileSync: p => files.get(p) || '',
    isPidAlive: pid => pid === 4242,
    connectSocket: async () => true
  })

  assert.equal(takeover, false)
})

test('stopOkvevoDesktopGateway SIGTERMs then SIGKILLs a stuck packaged owner and clears the marker', async () => {
  const files = new Map<string, string>([[path.join(HOME, 'gateway.lock'), JSON.stringify(PACKAGED)]])
  const alive = new Set([4242, 4240])
  const signals: Array<[number, string]> = []
  let stopped = false

  writeDesktopGatewayMarker(HOME, 4242, {
    writeFileSync: (p, data) => {
      files.set(p, data)
    },
    parentPid: () => 4240,
    processCmdline: pid => (pid === 4240 ? '/usr/bin/osascript -l JavaScript' : 'python gateway')
  })

  const result = await stopOkvevoDesktopGateway(HOME, {
    existsSync: p => files.has(p),
    readFileSync: p => files.get(p) || '',
    writeFileSync: (p, data) => {
      files.set(p, data)
    },
    rmSync: p => {
      files.delete(p)
    },
    isPidAlive: pid => alive.has(pid),
    kill: (pid, signal) => {
      signals.push([pid, signal])

      if (signal === 'SIGKILL') {
        alive.delete(pid)
      }
    },
    parentPid: () => 4240,
    processCmdline: pid => (pid === 4240 ? '/usr/bin/osascript -l JavaScript' : 'python'),
    runGatewayStop: async () => {
      stopped = true
    },
    sleep: async () => undefined,
    now: (() => {
      let t = 0

      return () => {
        t += 2_000

        return t
      }
    })()
  })

  assert.equal(result.stopped, true)
  assert.equal(stopped, true)
  assert.ok(signals.some(([pid, sig]) => pid === 4242 && sig === 'SIGTERM'))
  assert.ok(signals.some(([pid, sig]) => pid === 4240 && sig === 'SIGTERM'))
  assert.ok(signals.some(([, sig]) => sig === 'SIGKILL'))
  assert.equal(files.has(path.join(HOME, 'okvevo-desktop-gateway.json')), false)
})

test('stopOkvevoDesktopGateway is a no-op for a CLI gateway', async () => {
  const files = new Map<string, string>([[path.join(HOME, 'gateway.lock'), JSON.stringify(CLI)]])
  const signals: Array<[number, string]> = []

  const result = await stopOkvevoDesktopGateway(HOME, {
    existsSync: p => files.has(p),
    readFileSync: p => files.get(p) || '',
    isPidAlive: () => true,
    kill: (pid, signal) => signals.push([pid, signal]),
    runGatewayStop: async () => {
      throw new Error('must not stop CLI')
    }
  })

  assert.equal(result.stopped, false)
  assert.equal(result.reason, 'not_desktop_owned')
  assert.deepEqual(signals, [])
})

test('reclaimStaleOkvevoDesktopGateway stops a dead-socket packaged owner', async () => {
  const files = new Map<string, string>([[path.join(HOME, 'gateway.lock'), JSON.stringify(PACKAGED)]])
  const alive = new Set([4242])

  const result = await reclaimStaleOkvevoDesktopGateway(HOME, {
    existsSync: p => files.has(p) || p.endsWith('gateway.sock'),
    readFileSync: p => files.get(p) || '',
    rmSync: p => {
      files.delete(p)
    },
    isPidAlive: pid => alive.has(pid),
    kill: pid => {
      alive.delete(pid)
    },
    connectSocket: async () => false,
    runGatewayStop: async () => undefined,
    sleep: async () => undefined,
    now: () => 0
  })

  assert.equal(result.replaced, true)
  assert.equal(alive.has(4242), false)
})

test('clearDesktopGatewayMarker removes the marker file', () => {
  const files = new Map<string, string>([[path.join(HOME, 'okvevo-desktop-gateway.json'), '{}']])
  clearDesktopGatewayMarker(HOME, {
    existsSync: p => files.has(p),
    rmSync: p => {
      files.delete(p)
    }
  })
  assert.equal(files.size, 0)
})
