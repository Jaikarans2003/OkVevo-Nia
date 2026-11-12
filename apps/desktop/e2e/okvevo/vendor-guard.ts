/** Hosts a public OkVevo build must not contact. Ordinary websites are allowed. */
export const VENDOR_HOSTS = [
  'openrouter.ai',
  'api.openai.com',
  'api.anthropic.com',
  'fal.run',
  'fal.ai',
  'api.tavily.com',
  'api.firecrawl.dev',
  'api.exa.ai',
  'api.elevenlabs.io',
  'generativelanguage.googleapis.com',
  'api.x.ai',
  'api.groq.com',
  'nousresearch.com'
] as const

export function vendorHostHit(url: string): null | string {
  let host = ''

  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }

  for (const vendor of VENDOR_HOSTS) {
    if (host === vendor || host.endsWith(`.${vendor}`)) {
      return vendor
    }
  }

  return null
}

export function noteRequestUrl(url: string): void {
  const hit = vendorHostHit(url)

  if (hit) {
    throw new Error(`public build contacted vendor host ${hit}: ${url}`)
  }
}
