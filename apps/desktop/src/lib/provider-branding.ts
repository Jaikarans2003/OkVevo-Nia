import { isByokChromeVisible } from '@/lib/build-channel'

const OPENCODE_PICKER_SLUGS = new Set(['opencode', 'opencode-free', 'opencode-zen', 'opencode-go'])

function isOpenCodePickerSlug(slug: string): boolean {
  return OPENCODE_PICKER_SLUGS.has(slug.toLowerCase())
}

/** Public picker/group label for a provider slug. Wire slugs stay unchanged. */
export function brandProviderSlug(slug: string): string {
  if (!isByokChromeVisible() && slug === 'openrouter') {
    return 'OkVevo'
  }

  return slug
}

/** Public catalog: OpenRouter display name → OkVevo; drop the OpenCode family. */
export function brandProviderCatalog<T extends { name?: string; slug: string }>(providers: T[]): T[] {
  if (isByokChromeVisible()) {
    return providers
  }

  return providers
    .filter(provider => !isOpenCodePickerSlug(provider.slug))
    .map(provider =>
      provider.slug === 'openrouter' ? { ...provider, name: brandProviderSlug(provider.slug) } : provider
    )
}

export function brandModelOptionsResponse<T extends { providers?: Array<{ name?: string; slug: string }> }>(
  options: T
): T {
  if (!options.providers) {
    return options
  }

  const providers = brandProviderCatalog(options.providers)

  return providers === options.providers ? options : { ...options, providers }
}
