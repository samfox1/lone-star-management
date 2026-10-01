import type { SupabaseClient } from '@supabase/supabase-js'
import type { IntegrationArtist } from '@/lib/integrations-registry'
import { readProfileMarks, type ProfileMarks } from '@/lib/manager-tools/profiles/marks'
import { BIO_FACTS, connectedBios, factChanges, type BiosInput, type ProfileRevision } from '@/lib/manager-tools/profiles/bio-state'

/** The newest profile Publishes read. A Publish only writes the profile when it changed, so this
 *  is years of history; the oldest row of a full window is never taken for the first (factChanges). */
const REVISION_CAP = 300

/**
 * What the Outside bios rows are built from (lib/manager-tools/profiles/bio-state.ts): the
 * artist's links (which platforms are connected), the "updated" ticks, and the published
 * profiles, newest first, reading ONLY the fact fields out of each snapshot.
 *
 * Every read runs on the manager's own session after the page's ownership gate, so RLS decides
 * (`revisions_rw`, `links`, `profile_marks`: the artist's managers). NEVER THROWS: a read that
 * fails leaves its part null, and the rows say "couldn't check" (bioRows).
 *
 * `artist` is the gate's row (requireArtist), which carries the source id columns. `marks`: the
 * page's own read of profile_marks, when it makes one (the Profiles page), so it is read once.
 */
export async function loadOutsideBios(
  supabase: SupabaseClient,
  artist: IntegrationArtist & { id: string },
  marksRead?: Promise<ProfileMarks | null>,
): Promise<BiosInput> {
  const id = artist.id
  const [links, marks, revisions] = await Promise.all([
    supabase
      .from('links')
      .select('id, label, url, role')
      .eq('artist_id', id)
      .then(
        (r) => (r.error ? null : ((r.data ?? []) as { id: string; label: string | null; url: string | null; role: string | null }[])),
        () => null,
      ),
    marksRead ?? readProfileMarks(supabase, id).catch(() => null),
    supabase
      .from('revisions')
      // `name:data->name, …`: the facts only, never the whole snapshot (the press kit rides it).
      .select(['published_at', ...BIO_FACTS.map((f) => `${f}:data->${f}`)].join(', '))
      .eq('artist_id', id)
      .eq('entity_type', 'artist')
      .order('published_at', { ascending: false })
      .limit(REVISION_CAP)
      .then(
        (r) => (r.error ? null : ((r.data ?? []) as unknown as Record<string, unknown>[])),
        () => null,
      ),
  ])
  const rows: ProfileRevision[] | null = revisions?.map(({ published_at, ...data }) => ({ published_at: String(published_at), data })) ?? null
  return {
    bios: links ? connectedBios(links, artist) : null,
    marks,
    factsKnown: rows !== null,
    changes: rows ? factChanges(rows, { complete: rows.length < REVISION_CAP }) : [],
  }
}
