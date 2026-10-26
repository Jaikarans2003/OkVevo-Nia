import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createServer, type Server } from 'node:http'

export interface ChatCall {
  authorization?: string
  messages: unknown
  model?: string
  plugins?: Array<{ cost_tier?: string; id?: string }>
}

export interface GatewayMock {
  calls: ChatCall[]
  close: () => Promise<void>
  /** Later chat calls that still send this bearer get 401 invalid_token. */
  expireBearer: (bearer: string) => void
  origin: string
  refreshes: number
  urls: string[]
}

export interface GatewayMockOptions {
  /** Bearer that should 401 once, then succeed. Simulates an expired Firebase ID token. */
  expiredBearer?: string
  freshIdToken?: string
  /** Append one line per request. The bearer is a short hash, never the token. */
  logPath?: string
}

const REPLY = 'E2E_REPLY ok'

function authFingerprint(authorization: string | undefined): string {
  if (!authorization) return 'none'
  const bearer = authorization.replace(/^Bearer\s+/i, '')
  return createHash('sha256').update(bearer).digest('hex').slice(0, 12)
}

function writeLog(logPath: string | undefined, line: string) {
  if (!logPath) return
  mkdirSync(dirname(logPath), { recursive: true })
  appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`)
}

function completion(stream: boolean): string {
  if (!stream) {
    return JSON.stringify({
      id: 'chatcmpl-e2e',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 3 }
    })
  }

  return [
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content: REPLY }, finish_reason: null }]
    })}`,
    '',
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    })}`,
    '',
    'data: [DONE]',
    ''
  ].join('\n')
}

/** OpenAI-compatible stand-in for `{origin}/api/gateway`. */
export function startGatewayMock(options: GatewayMockOptions = {}): Promise<GatewayMock> {
  const calls: ChatCall[] = []
  const urls: string[] = []
  const state = { refreshes: 0, rejectedExpired: false, dead: new Set<string>() }
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      urls.push(url.pathname)
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: Record<string, unknown> = {}

      if (raw.trim()) {
        try {
          body = JSON.parse(raw) as Record<string, unknown>
        } catch {
          body = {}
        }
      }

      if (req.method === 'POST' && url.pathname.includes('/api/auth/desktop/refresh')) {
        state.refreshes += 1
        writeLog(options.logPath, `POST ${url.pathname} 200 refresh`)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            uid: 'e2e-user',
            idToken: options.freshIdToken || 'e2e-fresh-token',
            refreshToken: 'e2e-refresh-2'
          })
        )
        return
      }

      if (req.method === 'POST' && url.pathname.includes('/chat/completions')) {
        const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined
        const bearer = authorization?.replace(/^Bearer\s+/i, '') ?? ''
        const dead =
          (options.expiredBearer &&
            !state.rejectedExpired &&
            bearer.length > 0 &&
            bearer === options.expiredBearer) ||
          (bearer.length > 0 && state.dead.has(bearer))
        if (dead) {
          if (options.expiredBearer && bearer === options.expiredBearer) state.rejectedExpired = true
          writeLog(options.logPath, `POST ${url.pathname} 401 auth=${authFingerprint(authorization)} model=${String(body.model ?? '')}`)
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'invalid_token', type: 'invalid_request_error' } }))
          return
        }
        calls.push({
          authorization: typeof authorization === 'string' ? authorization : undefined,
          messages: body.messages,
          model: typeof body.model === 'string' ? body.model : undefined,
          plugins: Array.isArray(body.plugins) ? (body.plugins as ChatCall['plugins']) : undefined
        })
        const stream = body.stream === true
        writeLog(
          options.logPath,
          `POST ${url.pathname} 200 auth=${authFingerprint(authorization)} model=${String(body.model ?? '')}`
        )
        res.writeHead(200, {
          'content-type': stream ? 'text/event-stream' : 'application/json'
        })
        res.end(completion(stream))
        return
      }

      if (url.pathname.endsWith('/models')) {
        const header = req.headers.authorization
        const auth = Array.isArray(header) ? header[0] : header
        writeLog(options.logPath, `${req.method} ${url.pathname} 200 auth=${authFingerprint(auth)}`)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'okvevo/auto-cost', object: 'model' },
              { id: 'okvevo/auto-intelligence', object: 'model' },
              { id: 'openai/gpt-4o-mini', object: 'model' }
            ]
          })
        )
        return
      }

      writeLog(options.logPath, `${req.method} ${url.pathname} 200`)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"data":[]}')
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('gateway mock failed to bind'))
        return
      }
      resolve({
        calls,
        expireBearer(bearer: string) {
          if (bearer) state.dead.add(bearer)
        },
        get refreshes() {
          return state.refreshes
        },
        urls,
        origin: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise(done => {
            server.close(() => done())
          })
      })
    })
  })
}
