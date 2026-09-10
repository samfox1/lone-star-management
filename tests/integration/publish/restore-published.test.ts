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
import { publishContent, restoreToPublished, listPublishMoments, EDITOR_RESTORE } from '@/lib/content'
import { serviceClient } from '@tests/helpers/supabase'

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

describe('publishContent — an unchanged row is not re-snapshotted', () => {
  /**
   * 89% of skeen's 3,829 revision rows were byte-identical re-writes of the row before
   * them (measured 2026-08-15): every publish re-snapshotted every row, changed or not.
   * The log grew with the number of PUBLISHES rather than the number of CHANGES.
   *
   * Skipping unchanged rows keeps the history exactly as complete — latest-per-entity is
   * unaffected, and "what was live at time T" is still the newest revision at or before
   * T — while making the list of publish moments mean "something actually changed".
   */
  let pubId: string
  const countRevisions = async () => {
    const { count } = await svc
      .from('revisions')
      .select('*', { count: 'exact', head: true })
      .eq('artist_id', pubId)
      .eq('entity_type', 'site_styles')
    return count ?? 0
  }

  beforeAll(async () => {
    const { data } = await svc
      .from('artists')
      .insert({ slug: `zz-dedupe-${Date.now()}`, name: 'ZZ Dedupe Fixture' })
      .select('id')
      .single()
    pubId = data!.id
    await svc.from('site_styles').insert({ artist_id: pubId, region_key: 'hero', class_names: 'v1' })
  })
  afterAll(async () => {
    if (pubId) await svc.from('artists').delete().eq('id', pubId)
  })

  it('CRITICAL: republishing an untouched site writes NO new revisions', async () => {
    await publishContent(svc, 'site_styles', pubId)
    const afterFirst = await countRevisions()
    expect(afterFirst).toBe(1) // the first publish records it

    await publishContent(svc, 'site_styles', pubId)
    await publishContent(svc, 'site_styles', pubId)
    expect(await countRevisions(), 'nothing changed, so nothing new is recorded').toBe(afterFirst)
  })

  it('CRITICAL: a real edit still records a new revision', async () => {
    // The other half — the dedupe must not swallow actual changes, which would silently
    // freeze the live site at an old version.
    const before = await countRevisions()
    await svc.from('site_styles').update({ class_names: 'v2' }).eq('artist_id', pubId).eq('region_key', 'hero')
    await publishContent(svc, 'site_styles', pubId)
    expect(await countRevisions()).toBe(before + 1)
    // …and the newest snapshot is the new value, so the live site would serve v2.
    const { data: newest } = await svc
      .from('revisions')
      .select('data')
      .eq('artist_id', pubId)
      .eq('entity_type', 'site_styles')
      .order('published_at', { ascending: false })
      .limit(1)
      .single()
    expect((newest!.data as { class_names: string }).class_names).toBe('v2')
  })

  it('CRITICAL: a DELETED row still gets its tombstone, dedupe or not', async () => {
    // The tombstone is what takes a row off the live site. Losing it to the dedupe would
    // leave deleted content published forever.
    const before = await countRevisions()
    await svc.from('site_styles').delete().eq('artist_id', pubId).eq('region_key', 'hero')
    await publishContent(svc, 'site_styles', pubId)
    expect(await countRevisions()).toBe(before + 1)
    const { data: newest } = await svc
      .from('revisions')
      .select('data')
      .eq('artist_id', pubId)
      .eq('entity_type', 'site_styles')
      .order('published_at', { ascending: false })
      .limit(1)
      .single()
    expect((newest!.data as { _deleted?: boolean })._deleted).toBe(true)
  })
})

describe('publish history — going back to an OLDER version', () => {
  /**
   * The log already held every published state; what was missing was the ability to ask
   * it about a moment other than "now" (Sam, 2026-08-15).
   */
  let histId: string
  let v1At: string
  const heroClass = async () => {
    const { data } = await svc.from('site_styles').select('class_names').eq('artist_id', histId).eq('region_key', 'hero').maybeSingle()
    return data?.class_names ?? null
  }

  beforeAll(async () => {
    const { data } = await svc
      .from('artists')
      .insert({ slug: `zz-history-${Date.now()}`, name: 'ZZ History Fixture' })
      .select('id')
      .single()
    histId = data!.id
    // Three published versions, each a real change (the dedupe means each writes a row).
    await svc.from('site_styles').insert({ artist_id: histId, region_key: 'hero', class_names: 'version one' })
    await publishContent(svc, 'site_styles', histId)
    await svc.from('site_styles').update({ class_names: 'version two' }).eq('artist_id', histId).eq('region_key', 'hero')
    await publishContent(svc, 'site_styles', histId)
    await svc.from('site_styles').update({ class_names: 'version three' }).eq('artist_id', histId).eq('region_key', 'hero')
    await publishContent(svc, 'site_styles', histId)
  })
  afterAll(async () => {
    if (histId) await svc.from('artists').delete().eq('id', histId)
  })

  it('CRITICAL: lists one moment per publish, newest first', async () => {
    const moments = await listPublishMoments(svc, histId)
    expect(moments).toHaveLength(3)
    const times = moments.map((m) => new Date(m.publishedAt).getTime())
    expect(times[0]).toBeGreaterThanOrEqual(times[1])
    expect(times[1]).toBeGreaterThanOrEqual(times[2])
    v1At = moments[2].publishedAt // the OLDEST publish
  })

  it('CRITICAL: restoring to an older moment brings back THAT version, not the newest', async () => {
    // The whole feature. Restoring to the first publish must produce "version one" —
    // reading the newest snapshot regardless of the moment is the bug this pins.
    expect(await heroClass()).toBe('version three')
    const counts = await restoreToPublished(svc, histId, v1At)
    expect(counts.hasPublished).toBe(true)
    expect(await heroClass()).toBe('version one')
  })

  it('with no moment given it still means the LATEST publish', async () => {
    // The default path the Undo button uses — unchanged by the history feature.
    await svc.from('site_styles').update({ class_names: 'scribble' }).eq('artist_id', histId).eq('region_key', 'hero')
    await restoreToPublished(svc, histId)
    expect(await heroClass()).toBe('version three')
  })
})

describe('restoreToPublished — a site that has NEVER published', () => {
  /**
   * THE REGRESSION. Shipped 2026-08-14 and destroyed Juniper's styling within the minute:
   * with no revisions at all, every draft row read as "added since the publish" and was
   * deleted — the manager's whole body of work, with no snapshot anywhere to get it back.
   *
   * Its own artist, so the fixture is guaranteed to have published nothing.
   */
  let freshId: string
  beforeAll(async () => {
    const { data } = await svc
      .from('artists')
      .insert({ slug: `zz-neverpub-${Date.now()}`, name: 'ZZ Never Published' })
      .select('id')
      .single()
    freshId = data!.id
    await svc.from('site_styles').insert({ artist_id: freshId, region_key: 'hero', class_names: 'precious work' })
    await svc.from('site_content').insert({ artist_id: freshId, key: 'bio', value: 'precious words' })
  })
  afterAll(async () => {
    if (freshId) await svc.from('artists').delete().eq('id', freshId)
  })

  it('CRITICAL: changes NOTHING, and says so, rather than deleting everything', async () => {
    const counts = await restoreToPublished(svc, freshId)
    expect(counts.hasPublished).toBe(false)
    expect(counts).toMatchObject({ restored: 0, removed: 0, readded: 0 })
    const { data: styles } = await svc.from('site_styles').select('class_names').eq('artist_id', freshId)
    expect(styles, 'the unpublished styling must survive').toHaveLength(1)
    expect(styles![0].class_names).toBe('precious work')
    const { data: content } = await svc.from('site_content').select('value').eq('artist_id', freshId)
    expect(content).toHaveLength(1)
  })
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
    //
    // A published photo has to exist first: with NO published media at all, the per-type
    // guard skips media entirely (see the never-published regression above), so a slot
    // assignment would survive. That is the safe reading, and it is also why this fixture
    // publishes before it places.
    await svc.from('media').insert({
      artist_id: artistId,
      purpose: 'gallery_image',
      storage_path: `${artistId}/gallery/already-published.jpg`,
    })
    await publishContent(svc, 'media', artistId)

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
