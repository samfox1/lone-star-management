import type { SupabaseClient } from '@supabase/supabase-js'
import type { IntegrationArtist } from '@/lib/integrations-registry'
import { readProfileMarks, type ProfileMarks } from '@/lib/manager-tools/seo/profiles/marks'
import { BIO_FACTS, connectedBios, factChanges, type BiosInput, type ProfileRevision } from '@/lib/manager-tools/seo/profiles/bio-state'

/** The newest profile Publishes read. A Publish only writes the profile when it changed, so this
 *  is years of history; the oldest row of a full window is never taken for the first (factChanges). */
const REVISION_CAP = 300

/** One row's facts, read back from their JSON text. A fact the snapshot doesn't carry (SQL null)
 *  is LEFT OUT, never null: factChanges compares a fact only when both snapshots carry it. */
function factsOf(row: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const f of BIO_FACTS) {
    const raw = row[f]
    if (typeof raw !== 'string') continue
    try {
      data[f] = JSON.parse(raw)
    } catch {
      data[f] = raw
    }
  }
  return data
}

/**
 * What the Outside bios rows are built from (lib/manager-tools/seo/profiles/bio-state.ts): the
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
      // `name:data->name::text, …`: the facts only, never the whole snapshot (the press kit rides
      // it), each as its JSON TEXT so a missing key (SQL null) is not a present null (the text
      // 'null'). `data->name` alone answers null for both.
      .select(['published_at', ...BIO_FACTS.map((f) => `${f}:data->${f}::text`)].join(', '))
      .eq('artist_id', id)
      .eq('entity_type', 'artist')
      .order('published_at', { ascending: false })
      .limit(REVISION_CAP)
      .then(
        (r) => (r.error ? null : ((r.data ?? []) as unknown as Record<string, unknown>[])),
        () => null,
      ),
  ])
  const rows: ProfileRevision[] | null = revisions?.map((r) => ({ published_at: String(r.published_at), data: factsOf(r) })) ?? null
  return {
    bios: links ? connectedBios(links, artist) : null,
    marks,
    factsKnown: rows !== null,
    changes: rows ? factChanges(rows, { complete: rows.length < REVISION_CAP }) : [],
  }
}
