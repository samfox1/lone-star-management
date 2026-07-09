import {
  checkDriveFolderAction,
  saveAppleIdAction,
  saveBandsintownNameAction,
  saveDeezerIdAction,
  saveDriveFolderAction,
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
 * answers "what integrations exist," so the Integrations hub and the Manager-tools
 * connected-count both project over one list instead of two hand-maintained
 * enumerations. In the spirit of the CRUD / PUBLISHABLE registries (ADR-0003) and
 * the integration-client pattern (ADR-0005).
 *
 * Every integration is INDEPENDENT and grouped by the `section` it feeds. The three
 * music sources (Spotify / Apple / Deezer) coexist: an artist can connect and pull
 * from all of them, and the tracks sync MERGES their catalogs into union rows
 * (see `lib/sync.ts syncTracks`) rather than one exclusive importer overwriting the
 * others. (This replaced the old mutually-exclusive `catalog_source` model.)
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
  | 'drive_folder_id'

/** The manager-facing section an integration feeds. */
export type IntegrationSection = 'music' | 'videos' | 'tour' | 'files'

/** Display label per section — kept beside the registry so it can't drift from `section`. */
export const SECTION_LABEL: Record<IntegrationSection, string> = {
  music: 'Music',
  videos: 'Videos',
  tour: 'Tour dates',
  files: 'Files',
}

type SaveAction = (artistId: string, formData: FormData) => Promise<{ error?: string }>
/** Pull-style actions may report a dynamic success line (e.g. "Found 12 media files"). */
type PullAction = (artistId: string) => Promise<{ ok: boolean; error?: string; message?: string }>

export type Integration = {
  key: string
  label: string
  section: IntegrationSection
  idField: ArtistIdField
  placeholder: string
  pullLabel: string
  save: SaveAction
  pull: PullAction
}

export const INTEGRATIONS: Integration[] = [
  { key: 'spotify', label: 'Spotify', section: 'music', idField: 'spotify_artist_id', placeholder: 'Spotify artist ID', pullLabel: 'Pull from Spotify', save: saveSpotifyIdAction, pull: syncSpotifyAction },
  { key: 'apple', label: 'Apple Music', section: 'music', idField: 'apple_artist_id', placeholder: 'Apple Music artist ID', pullLabel: 'Pull from Apple Music', save: saveAppleIdAction, pull: syncAppleAction },
  { key: 'deezer', label: 'Deezer', section: 'music', idField: 'deezer_artist_id', placeholder: 'Deezer artist ID', pullLabel: 'Pull from Deezer', save: saveDeezerIdAction, pull: syncDeezerAction },
  { key: 'youtube', label: 'YouTube', section: 'videos', idField: 'youtube_channel_id', placeholder: 'YouTube @handle, channel ID, or URL', pullLabel: 'Import uploads', save: saveYoutubeChannelAction, pull: syncYouTubeAction },
  { key: 'bandsintown', label: 'Bandsintown', section: 'tour', idField: 'bandsintown_name', placeholder: 'Bandsintown artist name', pullLabel: 'Pull tour dates', save: saveBandsintownNameAction, pull: syncBandsintownAction },
  { key: 'ticketmaster', label: 'Ticketmaster', section: 'tour', idField: 'ticketmaster_attraction_id', placeholder: 'Ticketmaster attraction ID', pullLabel: 'Pull tour dates', save: saveTicketmasterIdAction, pull: syncTicketmasterAction },
  // Not a catalog source: a link-shared folder the dashboard can browse and
  // copy-import audio/images/videos from ("Check" verifies sharing + counts).
  { key: 'drive', label: 'Google Drive', section: 'files', idField: 'drive_folder_id', placeholder: 'Google Drive folder link', pullLabel: 'Check folder', save: saveDriveFolderAction, pull: checkDriveFolderAction },
]

/** The subset of the artist row the registry reads — a structural projection. */
export type IntegrationArtist = { [K in ArtistIdField]?: string | null }

/** Integrations grouped by the section they feed, in registry order — the hub renders each group. */
export const INTEGRATIONS_BY_SECTION: Record<IntegrationSection, Integration[]> = INTEGRATIONS.reduce(
  (acc, intg) => {
    ;(acc[intg.section] ??= []).push(intg)
    return acc
  },
  {} as Record<IntegrationSection, Integration[]>,
)

/** Is this source's id configured on the artist? */
export function isConnected(intg: Integration, artist: IntegrationArtist): boolean {
  return !!artist[intg.idField]
}

/**
 * Count of connected data sources for the Manager-tools summary. Every configured
 * integration counts independently — the three music sources are no longer one
 * exclusive slot — plus Shopify, whose state lives outside the artist row (Vault).
 */
export function connectedCount(artist: IntegrationArtist, shopifyConnected: boolean): number {
  const configured = INTEGRATIONS.filter((i) => isConnected(i, artist)).length
  return configured + (shopifyConnected ? 1 : 0)
}
