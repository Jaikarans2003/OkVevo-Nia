import { resolveFeedBaseUrl } from './updater/feed-config'
import type { PackEnvFile } from './okvevo-env'

/** Feed URL baked into Resources/okvevo-pack-env.json. Not process.env. */
export function bakedFeedUrlFromPack(pack: PackEnvFile | null | undefined): string {
  return String(pack?.OKVEVO_UPDATE_FEED_URL ?? '').trim()
}

/**
 * config.yaml `updates.desktop_feed_base_url` wins. Otherwise the URL packed
 * for this channel. Empty when neither is set (unpackaged dev).
 */
export function resolveDesktopFeedBase(configured: string, baked: string): string {
  return resolveFeedBaseUrl(configured.trim() || baked.trim())
}
