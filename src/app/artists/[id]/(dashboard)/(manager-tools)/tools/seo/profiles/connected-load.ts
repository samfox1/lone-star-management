import { isProfileLink, type LinkRowLike } from '@/lib/connections'
import type { ContentRow } from '@/lib/content'
import { musicBrainzCreateUrl } from '@/lib/manager-tools/connections/services/musicbrainz/seed'
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
  const links = await linksRead
  const rows: LinkRowLike[] = links.map((l) => ({
    id: l.id,
    label: (l.label as string | null) ?? null,
    url: (l.url as string | null) ?? null,
    on_site: (l.on_site as boolean | null) ?? null,
    role: (l.role as string | null) ?? null,
  }))
  const { profiles, databases } = connectedProfiles(rows)
  return {
    profiles,
    musicbrainz: databases.musicbrainz,
    musicBrainzCreate: musicBrainzCreateUrl({
      name: b.artist.name as string,
      // Only "Visual artist" says person; "Musician" says nothing about person vs group.
      type: b.schemaType === 'Person' ? 'person' : null,
      area: b.location,
      homepage: b.siteUrl,
      links: rows.filter(isProfileLink),
    }),
  }
}
