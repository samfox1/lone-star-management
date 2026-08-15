/**
 * "Undo changes" — restoreToPublished puts the DRAFT back to the last published version
 * for everything the site editor owns (Sam, 2026-08-14).
 *
 * ISOLATED TO ITS OWN ARTIST, on purpose. This function DELETES draft rows that the last
 * publish knows nothing about, so pointing it at a seed artist would destroy whatever
 * unpublished work another suite (or a human) had sitting there — the exact hazard
 * AGENTS.md rule 6 names. A throwaway artist created here, and dropped in teardown
 * (every content table is `artist_id → artists(id) ON DELETE CASCADE`), can only ever
 * affect rows this file made.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishContent, restoreToPublished, EDITOR_RESTORE } from '@/lib/content'
import { serviceClient } from './helpers/supabase'

const svc = serviceClient()
let artistId: string

/** A style row's current class string, read past RLS so the assertion sees row STATE
 *  rather than a write's return value (AGENTS.md rule 3). */
async function styleOf(regionKey: string): Promise<string | null> {
  const { data } = await svc
    .from('site_styles')
    .select('class_names')
    .eq('artist_id', artistId)
    .eq('region_key', regionKey)
    .maybeSingle()
  return data ? (data.class_names as string) : null
}

beforeAll(async () => {
  const { data, error } = await svc
    .from('artists')
    .insert({ slug: `zz-restore-${Date.now()}`, name: 'ZZ Restore Fixture' })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  artistId = data!.id
})

afterAll(async () => {
  // The artist and everything cascading off it. Nothing outside this row ever existed.
  if (artistId) await svc.from('artists').delete().eq('id', artistId)
})

describe('restoreToPublished — the editor’s Undo changes', () => {
  it('CRITICAL: puts an edited style back, drops one added since, and re-adds one deleted since', async () => {
    // The three cases that together mean "the draft equals the last published version".
    // A restore that only handled the first would leave the draft looking published while
    // still carrying the addition and still missing the deletion.
    await svc.from('site_styles').insert([
      { artist_id: artistId, region_key: 'edited', class_names: 'published-value' },
      { artist_id: artistId, region_key: 'deleted_later', class_names: 'was-here' },
    ])
    await publishContent(svc, 'site_styles', artistId)

    // Now diverge the draft in all three ways.
    await svc.from('site_styles').update({ class_names: 'draft-scribble' })
      .eq('artist_id', artistId).eq('region_key', 'edited')
    await svc.from('site_styles').insert({ artist_id: artistId, region_key: 'added_later', class_names: 'brand-new' })
    await svc.from('site_styles').delete().eq('artist_id', artistId).eq('region_key', 'deleted_later')
    // Witness: the draft really is diverged, so the assertions below can't pass vacuously.
    expect(await styleOf('edited')).toBe('draft-scribble')
    expect(await styleOf('added_later')).toBe('brand-new')
    expect(await styleOf('deleted_later')).toBeNull()

    const counts = await restoreToPublished(svc, artistId)

    expect(await styleOf('edited')).toBe('published-value') // put back
    expect(await styleOf('added_later')).toBeNull() // added since publish → gone
    expect(await styleOf('deleted_later')).toBe('was-here') // deleted since publish → back
    expect(counts).toMatchObject({ restored: 1, removed: 1, readded: 1 })
  })

  it('CRITICAL: a second restore changes nothing — no churn on an already-published draft', async () => {
    // The no-op path matters: this runs on every click, and a blind UPDATE of every row
    // would bump updated_at across the whole site each time.
    const counts = await restoreToPublished(svc, artistId)
    expect(counts).toMatchObject({ restored: 0, removed: 0, readded: 0 })
    // …and this artist HAS published, which is what tells the editor to use the server
    // restore rather than falling back to undoing the session.
    expect(counts.hasPublished).toBe(true)
    expect(await styleOf('edited')).toBe('published-value')
  })

  it('CRITICAL: text and links restore too, not just styles', async () => {
    await svc.from('site_content').insert({ artist_id: artistId, key: 'bio', value: 'published words' })
    await svc.from('links').insert({ artist_id: artistId, label: 'Spotify', url: 'https://published.example' })
    await publishContent(svc, 'site_content', artistId)
    await publishContent(svc, 'link', artistId)

    await svc.from('site_content').update({ value: 'draft words' }).eq('artist_id', artistId).eq('key', 'bio')
    await svc.from('links').update({ url: 'https://draft.example' }).eq('artist_id', artistId).eq('label', 'Spotify')

    await restoreToPublished(svc, artistId)

    const { data: content } = await svc.from('site_content').select('value').eq('artist_id', artistId).eq('key', 'bio').single()
    expect(content!.value).toBe('published words')
    const { data: link } = await svc.from('links').select('url').eq('artist_id', artistId).eq('label', 'Spotify').single()
    expect(link!.url).toBe('https://published.example')
  })

  it('CRITICAL: a photo added since the publish is UNPLACED, never deleted', async () => {
    // The file is the manager's, not the editor's. Undo takes it out of the slot it was
    // dropped into; deleting the upload would be destroying work the editor never made.
    const { data: photo } = await svc
      .from('media')
      .insert({
        artist_id: artistId,
        purpose: 'gallery_image',
        storage_path: `${artistId}/gallery/undo-fixture.jpg`,
        site_role: 'polaroid_1_photo',
      })
      .select('id')
      .single()

    await restoreToPublished(svc, artistId)

    const { data: after } = await svc.from('media').select('id, site_role').eq('id', photo!.id).maybeSingle()
    expect(after, 'the photo row must still exist').not.toBeNull()
    expect(after!.site_role).toBeNull() // unplaced, not deleted
  })

  it('restores ONLY the columns the editor owns', async () => {
    // A styling undo must not rename a video someone retitled on the Videos page. The
    // config is the guard; this pins it rather than trusting a reading of the list.
    const byType = Object.fromEntries(EDITOR_RESTORE.map((e) => [e.type, e]))
    expect(byType.media.columns).toEqual(['site_role'])
    expect(byType.video.columns).toEqual(['site_role'])
    expect(byType.media.absent).toBe('unplace')
    expect(byType.video.absent).toBe('unplace')
    // Nothing edited outside the editor is in scope at all.
    for (const t of ['track', 'tour_date', 'merch', 'release'])
      expect(byType[t], `${t} must not be restorable from the editor`).toBeUndefined()
  })
})
