import { isByokChromeVisible } from '@/lib/build-channel'

/** Public picker/group label for a provider slug. Wire slugs stay unchanged. */
export function brandProviderSlug(slug: string): string {
  if (!isByokChromeVisible() && slug === 'openrouter') {
    return 'OkVevo'
  }

  return slug
}

/** Public catalog: keep ONLY the OpenRouter row, renamed OkVevo. No MoA, no BYOK. */
export function brandProviderCatalog<T extends { name?: string; slug: string }>(providers: T[]): T[] {
  if (isByokChromeVisible()) {
    return providers
  }

  return providers
    .filter(provider => provider.slug === 'openrouter')
    .map(provider => ({ ...provider, name: brandProviderSlug(provider.slug) }))
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
