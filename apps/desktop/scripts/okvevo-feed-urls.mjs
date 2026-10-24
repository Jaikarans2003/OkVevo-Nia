/**
 * One update URL per channel. Pack bakes this into okvevo-pack-env.json.
 * Do not read STAGING_UPDATE_FEED_URL / PROD_UPDATE_FEED_URL.
 */
export const RELEASES_ORIGIN = 'https://releases.okvevo.com'

export const FEEDS = {
  staging: {
    prefix: 'okvevo/staging',
    url: 'https://releases.okvevo.com/okvevo/staging'
  },
  production: {
    prefix: 'okvevo/stable',
    url: 'https://releases.okvevo.com/okvevo/stable'
  }
}

export function feedFor(packTarget) {
  const feed = FEEDS[packTarget]
  if (!feed) {
    throw new Error(`pack_target must be staging or production, got ${JSON.stringify(packTarget)}`)
  }
  const folder = `${RELEASES_ORIGIN}/${feed.prefix}`
  if (feed.url !== folder) {
    throw new Error(`feed url ${feed.url} != ${folder}`)
  }
  return feed
}
