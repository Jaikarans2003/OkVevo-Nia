import { isByokChromeVisible } from '@/lib/build-channel'

const OKVEVO_CATALOG_SLUGS = new Set(['okvevo', 'openrouter'])

/** Public picker/group label for a provider slug. Wire slugs stay unchanged. */
export function brandProviderSlug(slug: string): string {
  if (!isByokChromeVisible() && OKVEVO_CATALOG_SLUGS.has(slug)) {
    return 'OkVevo'
  }

  return slug
}

/** Public catalog: one OkVevo row. `openrouter` and `okvevo` are that row. */
export function brandProviderCatalog<
  T extends { aliases?: null | string[]; models?: unknown; name?: string; slug: string }
>(providers: T[]): T[] {
  if (isByokChromeVisible()) {
    return providers
  }

  const rows = providers.filter(provider => OKVEVO_CATALOG_SLUGS.has(provider.slug))

  if (rows.length === 0) {
    return []
  }

  const preferred = rows.find(provider => provider.slug === 'okvevo') ?? rows[0]
  const seen = new Set<string>()
  const models: unknown[] = []

  for (const row of rows) {
    if (!Array.isArray(row.models)) {
      continue
    }

    for (const model of row.models) {
      const id = typeof model === 'string' ? model : JSON.stringify(model)

      if (seen.has(id)) {
        continue
      }

      seen.add(id)
      models.push(model)
    }
  }

  const aliases = [...new Set([...(preferred.aliases ?? []), 'openrouter', 'okvevo'])]

  return [
    {
      ...preferred,
      ...(models.length ? { models } : {}),
      aliases,
      name: 'OkVevo'
    }
  ]
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
