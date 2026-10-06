import { linkRowsOf } from '@/lib/connections'
import type { ContentRow } from '@/lib/content'
import { musicBrainzCreateFor } from '@/lib/manager-tools/connections/services/musicbrainz/seed'
import { connectedProfiles, type DatabasePage, type ProfileLink } from '@/lib/manager-tools/seo/profiles/connected'
import type { loadSeoBase } from '../load'

type Base = Awaited<ReturnType<typeof loadSeoBase>>

/**
 * What the Connected profiles and MusicBrainz rows read (connected-rows.tsx; moved from the Facts
 * page, 2026-10-02): the artist's links, split by connectedProfiles, and MusicBrainz's own artist
 * editor filled in from the draft facts. RLS-scoped, after loadSeoBase's ownership gate.
 * `linksRead`: the page's one read of the links (listContent), shared with the bio email.
 */
export async function loadConnected(b: Base, linksRead: Promise<ContentRow[]>): Promise<{ profiles: ProfileLink[]; musicbrainz?: DatabasePage; musicBrainzCreate: string }> {
  const rows = linkRowsOf(await linksRead)
  const { profiles, databases } = connectedProfiles(rows)
  return {
    profiles,
    musicbrainz: databases.musicbrainz,
    musicBrainzCreate: musicBrainzCreateFor({ name: b.artist.name as string, schemaType: b.schemaType, location: b.location, siteUrl: b.siteUrl, links: rows }),
  }
}
