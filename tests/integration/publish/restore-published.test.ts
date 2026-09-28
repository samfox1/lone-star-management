// Undo changes: putting the draft back to the last published version, for this artist only.
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
import {
  publishAll,
  publishContent,
  publishProfile,
  restoreToPublished,
  revertableChanges,
  diffUnpublished,
  listPublishMoments,
  EDITOR_RESTORE,
} from '@/lib/content'
import { serviceClient } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

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

  it('CRITICAL: site text restores too — but a connection’s URL does NOT', async () => {
    // This test once asserted the opposite for the link: Revert put a Spotify URL back.
    // Links became Connections rows on 2026-09-13 and their URL is edited on the
    // Connections page, so an editor Revert resetting it undid a fix made somewhere else
    // (Sam, 2026-09-28). The text half is unchanged: site text is the editor's own.
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
    expect(link!.url, 'the Connections page owns this URL').toBe('https://draft.example')
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

    const { data: after } = await svc.from('media').select('id, site_role, on_site').eq('id', photo!.id).maybeSingle()
    expect(after, 'the photo row must still exist').not.toBeNull()
    expect(after!.site_role).toBeNull() // unplaced, not deleted
    expect(after!.on_site).toBe(false) // …and off the site, as it was at the publish
  })

  it('library kinds come back by PLACEMENT only — never deleted, never their content', async () => {
    // This pinned "songs, shows, products and releases are out of reach" (2026-08-14).
    // The editor toggles and orders all four, and its Publish ships them, so Revert now
    // puts back where and whether they sit on the site (Sam, 2026-09-28) — and still
    // nothing more: a show's venue or a song's title is the Tour or Music page's. The
    // shape of every rule is pinned in tests/unit/publish/restore-scope.test.ts; the
    // database behaviour in the "library kinds" block below.
    for (const t of ['track', 'tour_date', 'merch', 'release', 'video'] as const) {
      const rules = EDITOR_RESTORE.filter((e) => e.type === t)
      expect(rules.length, `${t} has a rule`).toBeGreaterThan(0)
      for (const r of rules) expect(r.mode, t).toBe('placement')
    }
  })
})

/* ── Links are Connections rows (2026-09-13) ──────────────────────────────────────────
 * Sam, 2026-09-28: a connection's URL is edited in Connections, a new connection starts
 * OFF the site, and the editor's × "takes it off the site and deletes nothing". So the
 * editor's Revert (and Restore version) puts back a connection's ORDER and takes one the
 * version never had off the site — and nothing else: no delete, no re-insert, no URL.
 * Each block has its own throwaway artist: these restores flip rows a shared artist's
 * other tests rely on. */

type LinkRow = { id: string; url: string; label: string; on_site: boolean; sort_order: number }

async function linksOf(id: string): Promise<Map<string, LinkRow>> {
  const { data, error } = await svc.from('links').select('id, url, label, on_site, sort_order').eq('artist_id', id)
  if (error) throw new Error(error.message)
  return new Map((data as LinkRow[]).map((l) => [l.label, l]))
}

describe('restoreToPublished — a connection is never deleted and never re-pointed', () => {
  let a: ThrowawayArtist | undefined
  beforeAll(async () => {
    a = await createThrowawayArtist(svc, 'restore-connections')
    const { error } = await svc.from('links').insert([
      { artist_id: a.id, label: 'Threads', url: 'https://www.threads.net/@zz', sort_order: 0, on_site: true },
      { artist_id: a.id, label: 'Instagram', url: 'https://instagram.com/zz', sort_order: 1, on_site: true },
      { artist_id: a.id, label: 'TikTok', url: 'https://tiktok.com/@zz', sort_order: 2, on_site: true },
    ])
    if (error) throw new Error(error.message)
    await publishContent(svc, 'link', a.id)
  })
  afterAll(() => deleteThrowawayArtist(svc, a))

  it('CRITICAL: a URL fixed in Connections (threads.net → threads.com) survives a Revert', async () => {
    await svc.from('links').update({ url: 'https://www.threads.com/@zz' }).eq('artist_id', a!.id).eq('label', 'Threads')
    // Witness: the draft really differs from the publish, so "unchanged" below is earned.
    expect((await diffUnpublished(svc, a!.id)).link.edited).toBe(1)

    const counts = await restoreToPublished(svc, a!.id)

    expect((await linksOf(a!.id)).get('Threads')!.url).toBe('https://www.threads.com/@zz')
    expect(counts).toMatchObject({ restored: 0, removed: 0, readded: 0 })
  })

  it('CRITICAL: the ORDER comes back', async () => {
    await svc.from('links').update({ sort_order: 1 }).eq('artist_id', a!.id).eq('label', 'Threads')
    await svc.from('links').update({ sort_order: 0 }).eq('artist_id', a!.id).eq('label', 'Instagram')

    await restoreToPublished(svc, a!.id)

    const links = await linksOf(a!.id)
    expect(links.get('Threads')!.sort_order).toBe(0)
    expect(links.get('Instagram')!.sort_order).toBe(1)
  })

  it('CRITICAL: a connection added since is NOT deleted — a button made from it goes off the site', async () => {
    // Bandcamp: connected since the publish, and the editor's "Add button" turned it on.
    // Twitch: connected since, never a button. Both are the Connections page's rows.
    await svc.from('links').insert([
      { artist_id: a!.id, label: 'Bandcamp', url: 'https://zz.bandcamp.com', sort_order: 3, on_site: true },
      { artist_id: a!.id, label: 'Twitch', url: 'https://twitch.tv/zz', sort_order: 4, on_site: false },
    ])

    const counts = await restoreToPublished(svc, a!.id)

    const links = await linksOf(a!.id)
    expect(links.get('Bandcamp'), 'the connection must survive').toBeTruthy()
    expect(links.get('Bandcamp')!.on_site).toBe(false)
    expect(links.get('Bandcamp')!.url).toBe('https://zz.bandcamp.com')
    expect(links.get('Twitch'), 'an untouched new connection stays').toBeTruthy()
    expect(links.get('Twitch')!.on_site).toBe(false)
    // One row changed (Bandcamp off); Twitch was already off, so no write at all.
    expect(counts).toMatchObject({ restored: 0, removed: 1, readded: 0 })
  })

  it('CRITICAL: a connection removed in Connections since the publish is NOT re-added', async () => {
    await svc.from('links').delete().eq('artist_id', a!.id).eq('label', 'TikTok')

    const counts = await restoreToPublished(svc, a!.id)

    expect((await linksOf(a!.id)).has('TikTok')).toBe(false)
    expect(counts.readded).toBe(0)
  })

  it('a PUBLISHED connection’s on/off is live, so Revert leaves it where it is', async () => {
    // Links are a LIVE toggle (ADR 0009): the door reads the working row's on_site, and
    // the publish log never records it. So the × on a published button already changed
    // the live site, and there is no published on/off to go back to. Putting it back
    // would need on_site in the link snapshot (and the door taught to strip it).
    await svc.from('links').update({ on_site: false }).eq('artist_id', a!.id).eq('label', 'Instagram')

    await restoreToPublished(svc, a!.id)

    expect((await linksOf(a!.id)).get('Instagram')!.on_site).toBe(false)
  })
})

describe('Restore version — an OLDER moment leaves a connection’s URL alone too', () => {
  let a: ThrowawayArtist | undefined
  beforeAll(async () => {
    a = await createThrowawayArtist(svc, 'restore-connections-at')
    await svc.from('links').insert({ artist_id: a.id, label: 'Threads', url: 'https://www.threads.net/@zz', sort_order: 0 })
    await publishContent(svc, 'link', a.id)
    await svc.from('links').update({ url: 'https://www.threads.com/@zz' }).eq('artist_id', a.id)
    await publishContent(svc, 'link', a.id)
  })
  afterAll(() => deleteThrowawayArtist(svc, a))

  it('CRITICAL: restoring the first version keeps the newer URL', async () => {
    const moments = await listPublishMoments(svc, a!.id)
    expect(moments).toHaveLength(2)
    await restoreToPublished(svc, a!.id, moments[1].publishedAt) // the OLDER one
    expect((await linksOf(a!.id)).get('Threads')!.url).toBe('https://www.threads.com/@zz')
  })
})

describe('restoreToPublished — the editor’s OWN links (USB/Merch/booking buttons, contact rows)', () => {
  /**
   * CURRENT BEHAVIOUR, KEPT (checked 2026-09-28). A role-bound button is created, re-pointed
   * and cleared only by the editor's Buttons panel (saveEditorLink), and a contact row's
   * label and address are edited only in the editor's Contact group. Neither is a
   * connection. So they restore WHOLE, as all links used to: edited ones go back, one added
   * since goes, one cleared since comes back with its id.
   */
  let a: ThrowawayArtist | undefined
  let merchId: string
  beforeAll(async () => {
    a = await createThrowawayArtist(svc, 'restore-editor-links')
    const { data, error } = await svc
      .from('links')
      .insert([
        { artist_id: a.id, label: 'USB', url: 'https://usb.example/a', role: 'usb' },
        { artist_id: a.id, label: 'Merch', url: 'https://merch.example/a', role: 'merch' },
        { artist_id: a.id, label: 'Booking', url: 'mailto:a@zz.example' },
      ])
      .select('id, role')
    if (error) throw new Error(error.message)
    merchId = (data as { id: string; role: string | null }[]).find((r) => r.role === 'merch')!.id
    await publishContent(svc, 'link', a.id)
  })
  afterAll(() => deleteThrowawayArtist(svc, a))

  it('CRITICAL: re-pointed buttons go back, a new one goes, a cleared one returns', async () => {
    await svc.from('links').update({ url: 'https://usb.example/b' }).eq('artist_id', a!.id).eq('role', 'usb')
    await svc.from('links').update({ url: 'mailto:b@zz.example' }).eq('artist_id', a!.id).eq('label', 'Booking')
    await svc.from('links').delete().eq('artist_id', a!.id).eq('role', 'merch')
    await svc.from('links').insert({ artist_id: a!.id, label: 'Listen', url: 'https://listen.example', role: 'listen' })

    const counts = await restoreToPublished(svc, a!.id)

    const links = await linksOf(a!.id)
    expect(links.get('USB')!.url).toBe('https://usb.example/a')
    expect(links.get('Booking')!.url).toBe('mailto:a@zz.example')
    expect(links.get('Merch')?.id).toBe(merchId)
    expect(links.has('Listen')).toBe(false)
    expect(counts).toMatchObject({ restored: 2, removed: 1, readded: 1 })
  })
})

describe('restoreToPublished — the artist’s name, bio and hero come back', () => {
  /**
   * Sam, 2026-08-17: drafts stay "until I hit publish or manually undo". With a publish on
   * record, Revert used to restore styles, text and links but skipped the three profile
   * columns the editor edits — the artist name, the bio and the hero image — so a renamed
   * artist stayed renamed after Revert said it was done.
   */
  let a: ThrowawayArtist | undefined
  const PUBLISHED = { name: 'ZZ Published', bio: 'published bio', hero_image_url: 'https://x.example/hero-a.jpg' }
  beforeAll(async () => {
    a = await createThrowawayArtist(svc, 'restore-profile')
    await svc.from('artists').update({ ...PUBLISHED, press_pitch: 'published pitch' }).eq('id', a.id)
    await publishProfile(svc, a.id)
  })
  afterAll(() => deleteThrowawayArtist(svc, a))

  it('CRITICAL: name, bio and hero go back to the published profile', async () => {
    await svc
      .from('artists')
      .update({ name: 'ZZ Draft', bio: 'draft bio', hero_image_url: 'https://x.example/hero-b.jpg' })
      .eq('id', a!.id)

    const counts = await restoreToPublished(svc, a!.id)

    const { data } = await svc.from('artists').select('name, bio, hero_image_url').eq('id', a!.id).single()
    expect(data).toEqual(PUBLISHED)
    expect(counts.restored).toBe(1)
  })

  it('CRITICAL: the rest of the profile (the press kit) is another page’s, and stays', async () => {
    await svc.from('artists').update({ press_pitch: 'draft pitch' }).eq('id', a!.id)
    await restoreToPublished(svc, a!.id)
    const { data } = await svc.from('artists').select('press_pitch').eq('id', a!.id).single()
    expect(data!.press_pitch).toBe('draft pitch')
  })
})

describe('restoreToPublished — library kinds: presence and order come back, content does not', () => {
  let a: ThrowawayArtist | undefined
  const ids: Record<string, string> = {}
  const one = async (table: string, id: string, cols: string) => {
    const { data } = await svc.from(table).select(cols).eq('id', id).maybeSingle()
    return data as Record<string, unknown> | null
  }

  beforeAll(async () => {
    a = await createThrowawayArtist(svc, 'restore-library')
    const ins = async (table: string, key: string, row: Record<string, unknown>) => {
      const { data, error } = await svc.from(table).insert({ artist_id: a!.id, ...row }).select('id').single()
      if (error) throw new Error(`${table}: ${error.message}`)
      ids[key] = data!.id as string
    }
    await ins('tour_dates', 'mohawk', { venue: 'Mohawk', on_site: true, sort_order: 0 })
    await ins('tour_dates', 'parish', { venue: 'Parish', on_site: true, sort_order: 1 })
    await ins('tracks', 'song', { title: 'Song', on_site: false, sort_order: 0 })
    await ins('merch', 'tee', { title: 'Tee', on_site: true, sort_order: 0 })
    await ins('merch', 'hat', { title: 'Hat', on_site: true, sort_order: 1 })
    await publishAll(svc, a.id)

    // Diverge: every way the editor (or a library page) can move these since the publish.
    await svc.from('tour_dates').update({ on_site: false, venue: 'Mohawk Outdoors' }).eq('id', ids.mohawk)
    await svc.from('tour_dates').delete().eq('id', ids.parish) // the editor's trash
    await ins('tour_dates', 'scoot', { venue: 'Scoot Inn', on_site: true, sort_order: 2 })
    await svc.from('tracks').update({ on_site: true }).eq('id', ids.song)
    await svc.from('merch').update({ sort_order: 1 }).eq('id', ids.tee)
    await svc.from('merch').update({ sort_order: 0 }).eq('id', ids.hat)
    await restoreToPublished(svc, a.id)
  })
  afterAll(() => deleteThrowawayArtist(svc, a))

  it('CRITICAL: a show taken off the site comes back on — its edited venue stays edited', async () => {
    expect(await one('tour_dates', ids.mohawk, 'on_site, venue')).toEqual({ on_site: true, venue: 'Mohawk Outdoors' })
  })

  it('CRITICAL: a show added since is taken off the site, never deleted', async () => {
    expect(await one('tour_dates', ids.scoot, 'on_site')).toEqual({ on_site: false })
  })

  it('CRITICAL: a show deleted since is NOT re-inserted (its coordinates and source are not in the log)', async () => {
    expect(await one('tour_dates', ids.parish, 'id')).toBeNull()
  })

  it('CRITICAL: a song ticked on since goes back off', async () => {
    expect(await one('tracks', ids.song, 'on_site')).toEqual({ on_site: false })
  })

  it('CRITICAL: a dragged product order comes back', async () => {
    expect(await one('merch', ids.tee, 'sort_order')).toEqual({ sort_order: 0 })
    expect(await one('merch', ids.hat, 'sort_order')).toEqual({ sort_order: 1 })
  })
})

describe('restoreToPublished — gallery photos come back; Brand’s media is left alone', () => {
  let a: ThrowawayArtist | undefined
  const ids: Record<string, string> = {}
  beforeAll(async () => {
    a = await createThrowawayArtist(svc, 'restore-gallery')
    const rows = [
      { key: 'g1', purpose: 'gallery_image', on_site: true, sort_order: 0 },
      { key: 'g2', purpose: 'gallery_image', on_site: false, sort_order: 1 },
      { key: 'logo', purpose: 'logo_primary', on_site: true, sort_order: 0 },
    ]
    for (const { key, ...r } of rows) {
      const { data, error } = await svc
        .from('media')
        .insert({ artist_id: a.id, storage_path: `${a.id}/gallery/${key}.jpg`, ...r })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      ids[key] = data!.id as string
    }
    await publishContent(svc, 'media', a.id)
    await svc.from('media').update({ on_site: false, sort_order: 1 }).eq('id', ids.g1)
    await svc.from('media').update({ on_site: true, sort_order: 0 }).eq('id', ids.g2)
    await svc.from('media').update({ sort_order: 5 }).eq('id', ids.logo)
    await restoreToPublished(svc, a.id)
  })
  afterAll(() => deleteThrowawayArtist(svc, a))

  it('CRITICAL: a gallery photo’s on/off and order go back', async () => {
    const { data } = await svc.from('media').select('id, on_site, sort_order').in('id', [ids.g1, ids.g2])
    const by = new Map((data ?? []).map((r) => [r.id, r]))
    expect(by.get(ids.g1)).toMatchObject({ on_site: true, sort_order: 0 })
    expect(by.get(ids.g2)).toMatchObject({ on_site: false, sort_order: 1 })
  })

  it('CRITICAL: a logo is Brand’s — the editor’s Revert does not touch it', async () => {
    const { data } = await svc.from('media').select('sort_order').eq('id', ids.logo).single()
    expect(data!.sort_order).toBe(5)
  })
})

describe('revertableChanges — the Revert button counts only what Revert can undo', () => {
  /**
   * The editor showed Revert whenever ANYTHING was unpublished (diffUnpublished), so it
   * offered to undo song, tour and Brand edits it then left in place. The button now asks
   * the same plan the restore runs: its count is exactly what a click would change.
   */
  let a: ThrowawayArtist | undefined
  let fresh: ThrowawayArtist | undefined
  beforeAll(async () => {
    a = await createThrowawayArtist(svc, 'revertable')
    fresh = await createThrowawayArtist(svc, 'revertable-never-published')
    await svc.from('tracks').insert({ artist_id: a.id, title: 'Song', sort_order: 0 })
    await svc.from('tour_dates').insert({ artist_id: a.id, venue: 'Mohawk', sort_order: 0 })
    await svc.from('links').insert({ artist_id: a.id, label: 'Threads', url: 'https://www.threads.net/@zz' })
    await svc.from('site_content').insert({ artist_id: a.id, key: 'tagline', value: 'published' })
    await publishAll(svc, a.id)
    // A never-published artist with plenty of draft work.
    await svc.from('site_content').insert({ artist_id: fresh.id, key: 'tagline', value: 'draft' })
  })
  afterAll(async () => {
    await deleteThrowawayArtist(svc, a)
    await deleteThrowawayArtist(svc, fresh)
  })

  it('CRITICAL: song, show, connection-URL, Brand and press-kit edits count ZERO', async () => {
    await svc.from('tracks').update({ title: 'Song (edit)' }).eq('artist_id', a!.id)
    await svc.from('tour_dates').update({ venue: 'Mohawk Outdoors' }).eq('artist_id', a!.id)
    await svc.from('links').update({ url: 'https://www.threads.com/@zz' }).eq('artist_id', a!.id)
    await svc.from('artists').update({ theme_color: '#112233', press_pitch: 'draft pitch' }).eq('id', a!.id)

    // Witness: every one of them IS unpublished — the old button would have shown.
    const diff = await diffUnpublished(svc, a!.id)
    for (const k of ['track', 'tour_date', 'link', 'theme_color', 'profile'] as const)
      expect(diff[k].dirty, `${k} should be unpublished`).toBe(true)

    expect(await revertableChanges(svc, a!.id)).toBe(0)
  })

  it('CRITICAL: an edit Revert CAN undo counts, and a Revert brings it back to zero', async () => {
    await svc.from('site_content').update({ value: 'draft' }).eq('artist_id', a!.id).eq('key', 'tagline')
    await svc.from('artists').update({ bio: 'draft bio' }).eq('id', a!.id)
    expect(await revertableChanges(svc, a!.id)).toBe(2) // the text row, the profile

    await restoreToPublished(svc, a!.id)
    expect(await revertableChanges(svc, a!.id)).toBe(0)
  })

  it('CRITICAL: a never-published site has nothing to revert to — zero', async () => {
    expect(await revertableChanges(svc, fresh!.id)).toBe(0)
  })
})

describe('restoreToPublished — the guards that stop a restore from wiping a whole kind', () => {
  let brandOnly: ThrowawayArtist | undefined
  let oldLog: ThrowawayArtist | undefined
  let photoId: string
  let songId: string
  beforeAll(async () => {
    // (1) Only BRAND has ever been published: a logo is on record, the gallery is not.
    brandOnly = await createThrowawayArtist(svc, 'restore-brand-only')
    const { error: logoErr } = await svc
      .from('media')
      .insert({ artist_id: brandOnly.id, purpose: 'logo_primary', storage_path: `${brandOnly.id}/brand/logo.png` })
    if (logoErr) throw new Error(logoErr.message)
    await publishContent(svc, 'media', brandOnly.id, undefined, { keep: (s) => s.purpose === 'logo_primary' })
    const { data: photo, error } = await svc
      .from('media')
      .insert({ artist_id: brandOnly.id, purpose: 'gallery_image', storage_path: `${brandOnly.id}/gallery/p.jpg`, on_site: true })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    photoId = photo!.id as string

    // (2) A revision OLDER than a column: this song's snapshot never said on_site, and the
    // profile's never carried the hero (hand-written, as the log held them before). Its
    // name is blank — a snapshot that must never blank the artist's name.
    oldLog = await createThrowawayArtist(svc, 'restore-old-log')
    await svc.from('artists').update({ hero_image_url: 'https://x.example/hero.jpg' }).eq('id', oldLog.id)
    const { data: song } = await svc.from('tracks').insert({ artist_id: oldLog.id, title: 'Old', on_site: false }).select('id').single()
    songId = song!.id as string
    const { error: revErr } = await svc.from('revisions').insert([
      { artist_id: oldLog.id, entity_type: 'track', entity_id: songId, data: { id: songId, title: 'Old', sort_order: 0 } },
      { artist_id: oldLog.id, entity_type: 'artist', entity_id: oldLog.id, data: { name: '', bio: null } },
    ])
    if (revErr) throw new Error(revErr.message)
  })
  afterAll(async () => {
    await deleteThrowawayArtist(svc, brandOnly)
    await deleteThrowawayArtist(svc, oldLog)
  })

  it('CRITICAL: a Brand-only publish does not take the whole gallery off the site', async () => {
    // With no gallery photo on record, every photo reads as "added since the publish".
    // Taking them all off would un-curate the gallery; the rule is skipped instead.
    await restoreToPublished(svc, brandOnly!.id)
    const { data } = await svc.from('media').select('on_site').eq('id', photoId).single()
    expect(data!.on_site).toBe(true)
  })

  it('CRITICAL: a snapshot that never carried on_site leaves the switch alone (never nulls it)', async () => {
    const counts = await restoreToPublished(svc, oldLog!.id)
    const { data } = await svc.from('tracks').select('on_site').eq('id', songId).single()
    expect(data!.on_site).toBe(false)
    expect(counts.restored).toBe(0) // not the song, and not the profile
    const { data: artist } = await svc.from('artists').select('name, hero_image_url').eq('id', oldLog!.id).single()
    expect(artist!.name, 'a blank published name never blanks the artist').toBe('restore-old-log throwaway')
    expect(artist!.hero_image_url, 'a snapshot without the hero leaves it').toBe('https://x.example/hero.jpg')
  })
})
