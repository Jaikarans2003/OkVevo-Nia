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
  /** How the next Fal queue submit answers. CI never calls live Fal. */
  setFalMode: (mode: FalMode) => void
  falSubmits: number
  origin: string
  refreshes: number
  urls: string[]
}

export type FalMode = 'reject' | 'ok'

/** A user message starting with this makes the chat mock call image_generate once. */
export const IMAGE_MARKER = 'draw e2e image'

export const E2E_IMAGE_PATH = '/e2e-image.png'

/** Same body OkVevo-Web returns when Fal refuses a job (handleQueue vendorErrorBody). */
export const VENDOR_REJECTED_BODY = {
  error: {
    code: 'vendor_rejected',
    vendor: 'fal',
    vendor_status: 403,
    credits_returned: true,
    message: 'Fal rejected this job (HTTP 403). Your credits were returned.'
  }
}

// 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

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

function completion(stream: boolean, content: string = REPLY): string {
  if (!stream) {
    return JSON.stringify({
      id: 'chatcmpl-e2e',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 3 }
    })
  }

  return [
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }]
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

type ImageRoute = 'direct' | 'bridge'

function imageToolCall(stream: boolean, route: ImageRoute): string {
  const args = { prompt: 'e2e red circle' }
  // tool_search defers image_generate on desktop; a real model reaches it through tool_call.
  const call = {
    id: 'call_e2e_image',
    type: 'function',
    function:
      route === 'direct'
        ? { name: 'image_generate', arguments: JSON.stringify(args) }
        : { name: 'tool_call', arguments: JSON.stringify({ calls: [{ name: 'image_generate', arguments: args }] }) }
  }

  if (!stream) {
    return JSON.stringify({
      id: 'chatcmpl-e2e-img',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 8, completion_tokens: 3 }
    })
  }

  return [
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e-img',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, ...call }] }, finish_reason: null }]
    })}`,
    '',
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e-img',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
    })}`,
    '',
    'data: [DONE]',
    ''
  ].join('\n')
}

function lastMessage(body: Record<string, unknown>): { content?: unknown; role?: unknown } | undefined {
  const messages = Array.isArray(body.messages) ? body.messages : []

  return messages[messages.length - 1] as { content?: unknown; role?: unknown } | undefined
}

function messageContent(message: { content?: unknown } | undefined): string {
  return typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '')
}

function offeredTools(body: Record<string, unknown>): string[] {
  const tools = Array.isArray(body.tools) ? body.tools : []

  return tools.map(tool => String((tool as { function?: { name?: unknown } })?.function?.name ?? ''))
}

/** The last message asks for the E2E image: call image_generate directly if offered, else via tool_call. */
function imageRoute(body: Record<string, unknown>): ImageRoute | null {
  const last = lastMessage(body)

  if (last?.role !== 'user' || !messageContent(last).includes(IMAGE_MARKER)) {
    return null
  }

  const tools = offeredTools(body)

  return tools.includes('image_generate') ? 'direct' : tools.includes('tool_call') ? 'bridge' : null
}

/** After a failed tool result, relay its error the way a model would; otherwise the plain reply. */
function replyAfter(body: Record<string, unknown>): string {
  const last = lastMessage(body)

  if (last?.role !== 'tool') {
    return REPLY
  }

  const match = /"error"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(messageContent(last))

  return match ? `${REPLY} ${JSON.parse(`"${match[1]}"`)}` : REPLY
}

/** OpenAI-compatible stand-in for `{origin}/api/gateway`. */
export function startGatewayMock(options: GatewayMockOptions = {}): Promise<GatewayMock> {
  const calls: ChatCall[] = []
  const urls: string[] = []
  const state = {
    refreshes: 0,
    rejectedExpired: false,
    dead: new Set<string>(),
    falMode: 'ok' as FalMode,
    falSubmits: 0,
    origin: ''
  }
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
        const route = imageRoute(body)

        if (messageContent(lastMessage(body)).includes(IMAGE_MARKER) || lastMessage(body)?.role === 'tool') {
          writeLog(options.logPath, `image turn route=${route ?? 'none'} tools=${offeredTools(body).join(',')}`)
        }

        res.end(route ? imageToolCall(stream, route) : completion(stream, replyAfter(body)))
        return
      }

      if (url.pathname.includes('/api/gateway/fal/queue/')) {
        const requestBase = `${state.origin}/api/gateway/fal/queue/e2e/requests/e2e-image`
        if (req.method === 'POST' && !url.pathname.includes('/requests/')) {
          state.falSubmits += 1
          const reject = state.falMode === 'reject'
          writeLog(options.logPath, `POST ${url.pathname} ${reject ? 502 : 200} fal`)
          res.writeHead(reject ? 502 : 200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify(
              reject
                ? VENDOR_REJECTED_BODY
                : {
                    request_id: 'e2e-image',
                    status_url: `${requestBase}/status`,
                    response_url: requestBase,
                    cancel_url: `${requestBase}/cancel`
                  }
            )
          )
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify(
            url.pathname.endsWith('/status')
              ? { status: 'COMPLETED', logs: [] }
              : { images: [{ url: `${state.origin}${E2E_IMAGE_PATH}`, width: 1, height: 1 }] }
          )
        )
        return
      }

      if (url.pathname === E2E_IMAGE_PATH) {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(PNG)
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
      state.origin = `http://127.0.0.1:${address.port}`
      resolve({
        calls,
        expireBearer(bearer: string) {
          if (bearer) state.dead.add(bearer)
        },
        setFalMode(mode: FalMode) {
          state.falMode = mode
        },
        get falSubmits() {
          return state.falSubmits
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
