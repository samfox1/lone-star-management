/**
 * THE DATA HALF of the integrations registry — what a syncable source IS, with none of
 * the server actions that drive it.
 *
 * Split out of `app/artists/[id]/(dashboard)/integrations.ts` (2026-09-13) so that pure
 * modules — `lib/connections.ts`, which merges these sources with the social platforms
 * into one Connections list — can read the registry without importing server actions,
 * and so that the DB-free tests (and Stryker) can reach it. The dashboard module joins
 * each entry here to its save/pull action by key, and a key with no action is a compile
 * error there, not a silent gap.
 *
 * Every integration is INDEPENDENT and grouped by the `section` it feeds. The three
 * music sources coexist: an artist can connect all of them and the tracks sync MERGES
 * their catalogs into union rows (`lib/sync.ts syncTracks`). Shopify is intentionally
 * NOT here: it is a connect/disconnect storefront-token flow (token → Vault), not an
 * artist-id column, and the code that lists it beside these resolves it by name.
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

/** Display label per section — beside the registry so it can't drift from `section`. */
export const SECTION_LABEL: Record<IntegrationSection, string> = {
  music: 'Music',
  videos: 'Videos',
  tour: 'Tour dates',
  files: 'Files',
}

export const INTEGRATION_KEYS = ['spotify', 'apple', 'deezer', 'youtube', 'bandsintown', 'ticketmaster', 'drive'] as const
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number]

export type IntegrationDef = {
  key: IntegrationKey
  label: string
  section: IntegrationSection
  idField: ArtistIdField
  /** What goes in the id field, named for the manager ("Spotify artist ID"). */
  placeholder: string
  pullLabel: string
}

export const INTEGRATION_REGISTRY: readonly IntegrationDef[] = [
  { key: 'spotify', label: 'Spotify', section: 'music', idField: 'spotify_artist_id', placeholder: 'Spotify artist ID', pullLabel: 'Pull from Spotify' },
  { key: 'apple', label: 'Apple Music', section: 'music', idField: 'apple_artist_id', placeholder: 'Apple Music artist ID', pullLabel: 'Pull from Apple Music' },
  { key: 'deezer', label: 'Deezer', section: 'music', idField: 'deezer_artist_id', placeholder: 'Deezer artist ID', pullLabel: 'Pull from Deezer' },
  { key: 'youtube', label: 'YouTube', section: 'videos', idField: 'youtube_channel_id', placeholder: 'YouTube @handle, channel ID, or URL', pullLabel: 'Import uploads' },
  { key: 'bandsintown', label: 'Bandsintown', section: 'tour', idField: 'bandsintown_name', placeholder: 'Bandsintown artist name', pullLabel: 'Pull tour dates' },
  { key: 'ticketmaster', label: 'Ticketmaster', section: 'tour', idField: 'ticketmaster_attraction_id', placeholder: 'Ticketmaster attraction ID', pullLabel: 'Pull tour dates' },
  // Not a catalog source: a link-shared folder the dashboard can browse and copy-import
  // audio/images/videos from ("Check" verifies sharing + counts).
  { key: 'drive', label: 'Google Drive', section: 'files', idField: 'drive_folder_id', placeholder: 'Google Drive folder link', pullLabel: 'Check folder' },
]

/** The subset of the artist row the registry reads — a structural projection. */
export type IntegrationArtist = { [K in ArtistIdField]?: string | null }

/** Is this source's id configured on the artist? */
export function isConnected(intg: Pick<IntegrationDef, 'idField'>, artist: IntegrationArtist): boolean {
  return !!artist[intg.idField]
}

/**
 * Count of connected data sources for the Manager-tools summary. Every configured
 * integration counts independently — the three music sources are no longer one
 * exclusive slot — plus Shopify, whose state lives outside the artist row (Vault).
 */
export function connectedCount(artist: IntegrationArtist, shopifyConnected: boolean): number {
  const configured = INTEGRATION_REGISTRY.filter((i) => isConnected(i, artist)).length
  return configured + (shopifyConnected ? 1 : 0)
}
