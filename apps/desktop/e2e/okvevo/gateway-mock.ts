import { createServer, type Server } from 'node:http'

export interface ChatCall {
  messages: unknown
  model?: string
  plugins?: Array<{ cost_tier?: string; id?: string }>
}

export interface GatewayMock {
  calls: ChatCall[]
  close: () => Promise<void>
  origin: string
  urls: string[]
}

const REPLY = 'E2E_REPLY ok'

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
export function startGatewayMock(): Promise<GatewayMock> {
  const calls: ChatCall[] = []
  const urls: string[] = []
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

      if (req.method === 'POST' && url.pathname.includes('/chat/completions')) {
        calls.push({
          messages: body.messages,
          model: typeof body.model === 'string' ? body.model : undefined,
          plugins: Array.isArray(body.plugins) ? (body.plugins as ChatCall['plugins']) : undefined
        })
        const stream = body.stream === true
        res.writeHead(200, {
          'content-type': stream ? 'text/event-stream' : 'application/json'
        })
        res.end(completion(stream))
        return
      }

      if (url.pathname.endsWith('/models')) {
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
