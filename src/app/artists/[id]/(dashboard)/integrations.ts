import type { SyncNote } from '@/lib/sync'
import {
  INTEGRATION_REGISTRY,
  type IntegrationDef,
  type IntegrationKey,
} from '@/lib/integrations-registry'
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
 * answers "what integrations exist," so the Connections page, the Sync dialog and the
 * Manager-tools connected-count all project over one list instead of hand-maintained
 * enumerations. In the spirit of the CRUD / PUBLISHABLE registries (ADR-0003) and the
 * integration-client pattern (ADR-0005).
 *
 * The DATA lives in `lib/integrations-registry.ts` so pure modules can read it; this
 * file joins each entry to its save/pull server action BY KEY. The two maps below are
 * `Record<IntegrationKey, …>`, so adding a source to the registry without wiring its
 * actions is a compile error here rather than a button that does nothing.
 */
export type {
  ArtistIdField,
  IntegrationArtist,
  IntegrationSection,
} from '@/lib/integrations-registry'
export { SECTION_LABEL, connectedCount, isConnected } from '@/lib/integrations-registry'

type SaveAction = (artistId: string, formData: FormData) => Promise<{ error?: string }>
/** Pull-style actions may report a dynamic success line (e.g. "Found 12 media files"),
 *  and the track pulls may name songs the run could not settle (SyncNote). */
type PullAction = (artistId: string) => Promise<{ ok: boolean; error?: string; message?: string; notes?: SyncNote[] }>

export type Integration = IntegrationDef & {
  save: SaveAction
  pull: PullAction
}

const SAVE: Record<IntegrationKey, SaveAction> = {
  spotify: saveSpotifyIdAction,
  apple: saveAppleIdAction,
  deezer: saveDeezerIdAction,
  youtube: saveYoutubeChannelAction,
  bandsintown: saveBandsintownNameAction,
  ticketmaster: saveTicketmasterIdAction,
  drive: saveDriveFolderAction,
}

const PULL: Record<IntegrationKey, PullAction> = {
  spotify: syncSpotifyAction,
  apple: syncAppleAction,
  deezer: syncDeezerAction,
  youtube: syncYouTubeAction,
  bandsintown: syncBandsintownAction,
  ticketmaster: syncTicketmasterAction,
  drive: checkDriveFolderAction,
}

export const INTEGRATIONS: Integration[] = INTEGRATION_REGISTRY.map((d) => ({ ...d, save: SAVE[d.key], pull: PULL[d.key] }))

/** Integrations grouped by the section they feed, in registry order. */
export const INTEGRATIONS_BY_SECTION = INTEGRATIONS.reduce(
  (acc, intg) => {
    ;(acc[intg.section] ??= []).push(intg)
    return acc
  },
  {} as Record<Integration['section'], Integration[]>,
)
