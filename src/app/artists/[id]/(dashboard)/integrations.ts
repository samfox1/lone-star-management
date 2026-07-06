import type { CatalogSource } from '@/lib/catalog'
import {
  saveAppleIdAction,
  saveBandsintownNameAction,
  saveDeezerIdAction,
  saveSpotifyIdAction,
  saveTicketmasterIdAction,
  saveYoutubeChannelAction,
  syncAppleAction,
  syncBandsintownAction,
  syncDeezerAction,
  syncSpotifyAction,
  syncTicketmasterAction,
  syncYouTubeAction,
} from './actions'

/**
 * The one registry of an artist's syncable data sources — the single place that
 * answers "what integrations exist," so the Integrations hub, the Manager-tools
 * connected-count, and any future connected-badge all project over one list
 * instead of three hand-maintained enumerations. In the spirit of the CRUD /
 * PUBLISHABLE registries (ADR-0003) and the integration-client pattern (ADR-0005).
 *
 * Two shapes live here, distinguished by `catalogSource`:
 *  - **Catalog sources** (Spotify / Deezer / Apple) are MUTUALLY EXCLUSIVE — only
 *    the one matching `artists.catalog_source` is the active importer; they carry
 *    a `catalogSource` tag and share one slot on the Music section.
 *  - **Standalone sources** (YouTube / Bandsintown / Ticketmaster) are independent
 *    and each feed their own section.
 *
 * Shopify is intentionally NOT here: it uses a connect/disconnect storefront-token
 * flow (write-only token → Vault), not an artist id column, so the hub renders it
 * with its own ShopifyPanel. Its connected state is a separate `getShopifyDomain`.
 */

/** The artist columns an integration reads to decide if it is connected. */
export type ArtistIdField =
  | 'spotify_artist_id'
  | 'deezer_artist_id'
  | 'apple_artist_id'
  | 'youtube_channel_id'
  | 'bandsintown_name'
  | 'ticketmaster_attraction_id'

/** The manager-facing section an integration feeds. */
export type IntegrationSection = 'music' | 'videos' | 'tour'

/** Display label per section — kept beside the registry so it can't drift from `section`. */
export const SECTION_LABEL: Record<IntegrationSection, string> = {
  music: 'Music',
  videos: 'Videos',
  tour: 'Tour dates',
}

type SaveAction = (artistId: string, formData: FormData) => Promise<void>
type PullAction = (artistId: string) => Promise<void>

export type Integration = {
  key: string
  label: string
  section: IntegrationSection
  idField: ArtistIdField
  placeholder: string
  pullLabel: string
  save: SaveAction
  pull: PullAction
  /** Present on the three catalog sources; they share one exclusive slot. */
  catalogSource?: CatalogSource
}

export const INTEGRATIONS: Integration[] = [
  { key: 'spotify', label: 'Spotify', section: 'music', catalogSource: 'spotify', idField: 'spotify_artist_id', placeholder: 'Spotify artist ID', pullLabel: 'Pull from Spotify', save: saveSpotifyIdAction, pull: syncSpotifyAction },
  { key: 'deezer', label: 'Deezer', section: 'music', catalogSource: 'deezer', idField: 'deezer_artist_id', placeholder: 'Deezer artist ID', pullLabel: 'Pull from Deezer', save: saveDeezerIdAction, pull: syncDeezerAction },
  { key: 'apple', label: 'Apple Music', section: 'music', catalogSource: 'apple', idField: 'apple_artist_id', placeholder: 'Apple Music artist ID', pullLabel: 'Pull from Apple Music', save: saveAppleIdAction, pull: syncAppleAction },
  { key: 'youtube', label: 'YouTube', section: 'videos', idField: 'youtube_channel_id', placeholder: 'YouTube channel ID', pullLabel: 'Import uploads', save: saveYoutubeChannelAction, pull: syncYouTubeAction },
  { key: 'bandsintown', label: 'Bandsintown', section: 'tour', idField: 'bandsintown_name', placeholder: 'Bandsintown artist name', pullLabel: 'Pull tour dates', save: saveBandsintownNameAction, pull: syncBandsintownAction },
  { key: 'ticketmaster', label: 'Ticketmaster', section: 'tour', idField: 'ticketmaster_attraction_id', placeholder: 'Ticketmaster attraction ID', pullLabel: 'Pull tour dates', save: saveTicketmasterIdAction, pull: syncTicketmasterAction },
]

/** The subset of the artist row the registry reads — a structural projection. */
export type IntegrationArtist = { [K in ArtistIdField]?: string | null } & {
  catalog_source?: string | null
}

/** Catalog sources (Spotify/Deezer/Apple), which share one exclusive slot. */
export const CATALOG_INTEGRATIONS = INTEGRATIONS.filter((i) => i.catalogSource)

/** Independent sources (YouTube/Bandsintown/Ticketmaster), grouped per section. */
export const STANDALONE_INTEGRATIONS = INTEGRATIONS.filter((i) => !i.catalogSource)

/** Is this source's id configured on the artist? (Independent of which catalog source is active.) */
export function isConnected(intg: Integration, artist: IntegrationArtist): boolean {
  return !!artist[intg.idField]
}

/**
 * Count of connected data sources for the Manager-tools summary. The catalog
 * sources count as ONE slot — only the artist's active `catalog_source` counts,
 * so a stale id left behind by a source-switch doesn't inflate the number past
 * what the hub actually renders. `shopifyConnected` is passed in because Shopify's
 * state lives outside the artist row (Vault/metadata).
 */
export function connectedCount(artist: IntegrationArtist, shopifyConnected: boolean): number {
  const standalone = STANDALONE_INTEGRATIONS.filter((i) => isConnected(i, artist)).length
  const active = CATALOG_INTEGRATIONS.find((i) => i.catalogSource === artist.catalog_source)
  const catalog = active && isConnected(active, artist) ? 1 : 0
  return standalone + catalog + (shopifyConnected ? 1 : 0)
}
