import { FACT_CONTENT_KEYS } from '@samfox1/site-bridge/seo'
import { createClient } from '@/lib/supabase/server'
import { bioRows } from '@/lib/manager-tools/seo/profiles/bio-state'
import { outsideBiosNudge } from '@/lib/manager-tools/profile/profile'
import type { SchemaType } from '@/lib/manager-tools/profile/profile'
import { requireArtist } from '../../_data'
import { loadOutsideBios } from '@/lib/manager-tools/seo/profiles/bios-load'

/** The site_content keys Profile reads: the four facts. Where the bio shows and its heading
 *  moved to the editor's Site panel (2026-10-05). */
const KEYS = Object.values(FACT_CONTENT_KEYS)

/**
 * WHAT PROFILE READS (moved from the SEO / GEO Facts page, 2026-10-02): the artist's own columns
 * (name, bio, genre, city, type), the fact keys, and the outside
 * bios a Publish may have left out of date (the nudge, bios-load.ts). The DRAFT, as every editing
 * page reads it: Publish is what ships it.
 *
 * Every read is RLS-scoped and flies beside the ownership gate (`requireArtist`); the outside
 * bios wait only for the gate's row (their platforms are read from it). `loadOutsideBios` never
 * throws: a read that fails is no nudge, not a broken page.
 */
export async function loadProfile(id: string) {
  const supabase = await createClient()
  const gate = requireArtist(id)
  const [artist, { data: rows }, { data: cols }, bios] = await Promise.all([
    gate,
    supabase.from('site_content').select('key, value').eq('artist_id', id).in('key', KEYS),
    supabase.from('artists').select('bio, genre, location, schema_type').eq('id', id).single(),
    gate.then((a) => loadOutsideBios(supabase, a)),
  ])
  const content = Object.fromEntries((rows ?? []).map((r) => [r.key as string, (r.value as string | null) ?? '']))
  return {
    artist,
    facts: Object.fromEntries(Object.values(FACT_CONTENT_KEYS).map((k) => [k, content[k] ?? ''])),
    bio: ((cols?.bio as string | null) ?? '').trim(),
    genre: (cols?.genre as string | null) ?? '',
    city: (cols?.location as string | null) ?? '',
    schemaType: ((cols?.schema_type as string | null) === 'Person' ? 'Person' : 'MusicGroup') as SchemaType,
    bioNudge: outsideBiosNudge(bioRows(bios, new Date())),
  }
}
