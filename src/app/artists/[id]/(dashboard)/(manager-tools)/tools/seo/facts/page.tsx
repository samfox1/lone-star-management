import { FACT_CONTENT_KEYS } from '@samfox1/site-bridge/seo'
import { connectionHandle, connectionOfLink, identityUrlOf, isProfileLink, type LinkRowLike } from '@/lib/connections'
import { listContent } from '@/lib/content'
import { musicBrainzCreateUrl } from '@/lib/manager-tools/connections/services/musicbrainz/seed'
import { BIO_GOAL } from '@/lib/seo-tests/who'
import { loadSeoBase } from '../load'
import { FactsTab, type FactsTabProps, type ProfileLink } from './facts-tab'

const DATABASES = ['musicbrainz', 'discogs', 'wikidata'] as const

/**
 * FACTS: what the artist IS (round 2 mock: Who · Where · About · Profiles). The id `bio` is
 * where a test's pencil lands and where the old /about route redirects: facts-tab.tsx keeps
 * it on the bio row, and landing on it opens the bio editor.
 *
 * Every read is RLS-scoped and flies beside the ownership gate (loadSeoBase).
 */
export default async function SeoFactsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const base = await loadSeoBase(id)
  const [links, mail] = await Promise.all([
    listContent(base.supabase, 'link', id),
    // Managers may READ their mail settings (Settings reads it the same way).
    base.supabase.from('artist_mail_settings').select('booking_email').eq('artist_id', id).maybeSingle(),
  ])
  const rows: LinkRowLike[] = links.map((l) => ({
    id: l.id,
    label: (l.label as string | null) ?? null,
    url: (l.url as string | null) ?? null,
    on_site: (l.on_site as boolean | null) ?? null,
    role: (l.role as string | null) ?? null,
  }))

  // Connected profiles (one per platform), and the fact databases apart: they have rows of
  // their own. "In your fact card" is the fact card's own rule (identityUrlOf): a real artist
  // profile, never a payment handle or a playlist.
  const profiles: ProfileLink[] = []
  const databases: FactsTabProps['databases'] = {}
  for (const r of rows) {
    const def = connectionOfLink(r)
    if (!def || !r.url) continue
    const db = DATABASES.find((d) => d === def.key)
    if (db) {
      databases[db] ??= connectionHandle(def, r.url)
      continue
    }
    if (profiles.some((p) => p.slug === def.key)) continue
    profiles.push({ slug: def.social ?? def.key, label: def.label, display: connectionHandle(def, r.url), inFactCard: !!identityUrlOf(r) })
  }

  const facts = Object.fromEntries(Object.values(FACT_CONTENT_KEYS).map((k) => [k, base.content[k] ?? '']))
  return (
    <FactsTab
      artistId={id}
      artistName={base.artist.name}
      schemaType={base.schemaType}
      genre={base.genre ?? ''}
      city={base.location ?? ''}
      facts={facts}
      bio={base.bio}
      bioGoal={BIO_GOAL}
      about={{ placement: base.seo.about_placement ?? '', heading: base.seo.about_heading ?? '' }}
      bookingEmail={((mail.data?.booking_email as string | null) ?? '').trim()}
      profiles={profiles}
      databases={databases}
      musicBrainzCreate={musicBrainzCreateUrl({
        name: base.artist.name,
        // Only "Visual artist" says person; "Musician" says nothing about person vs group.
        type: base.schemaType === 'Person' ? 'person' : null,
        area: base.location,
        homepage: base.siteUrl,
        links: rows.filter(isProfileLink),
      })}
    />
  )
}
