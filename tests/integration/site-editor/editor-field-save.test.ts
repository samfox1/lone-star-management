// The editor's draft write path: resolve a field to its target and write it, scoped by RLS.
/**
 * saveEditorField — the visual editor's draft write path. Resolves a field to its
 * manifest target and writes it: an artist column or a site_content key (blank
 * clears). RLS scopes every write to the caller's tenant. Runs against the live DB
 * as the seeded manager.
 *
 * TENANCY, AND WHY THE ARTISTS ARE THROWAWAYS. This file used to run on the shared seed
 * artists, and it wrote all over them: `bio` (snapshotted and restored — that part was
 * fine), a template site_content key, `booking_email`, and every CURSOR_KEY. Teardown was
 * `delete().eq('artist_id', …).eq('key', …)` per key, and for the cursor keys
 * `.in('artist_id', [A, B]).in('key', CURSOR_KEYS)`. On the LIVE hosted project a
 * delete-by-key destroys the artist's REAL value for that key even though this file only
 * ever overwrote it — the cursor block therefore wiped a manager's actual cursor image,
 * trail and trail colour on both seed artists, every run. Two more deletes existed purely
 * to self-heal a previous crashed run's leftovers, which is the tell that the fixtures
 * were sharing a namespace with live data.
 *
 * Both artists are created and dropped by this file now. Nothing needs snapshotting,
 * because nothing this file touches belongs to anyone else, and the "is the row absent?"
 * assertions are about a table that only this file ever wrote to.
 */
import { SEO_FIELDS } from '@/lib/site-content-schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { saveCursorField, saveEditorField } from '@/lib/site-editor/save'
import { manifestFor } from '@/lib/site-editor/manifest'
import { CURSOR_KEYS } from '@/lib/site-content-schema'
import { CURSOR_CONTENT_KEYS } from '@samfox1/site-bridge/cursor'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let a: ThrowawayArtist
let bArtist: ThrowawayArtist
let artistA: string
let artistB: string
let asA: SupabaseClient
let template: string
/** B's bio as planted below — the witness the cross-tenant denial is measured against. */
const B_BIO = "B's own bio"
const svc = serviceClient()

/** A site_content field of the artist's template, derived from the manifest rather than
 *  hand-named (AGENTS.md rule 4). tracks_heading is skipped because preview-parity uses
 *  it — a habit from when this file ran on the shared seed artist, kept because it costs
 *  nothing and the manifest still has to offer a second one. */
function siteContentField() {
  const f = manifestFor(template)!.fields.find((x) => x.target.store === 'site_content' && x.key !== 'tracks_heading')!
  return { fieldKey: f.key, contentKey: (f.target as { key: string }).key }
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  const asB = await signInAs(SEED.managerB)
  a = await createThrowawayArtist(svc, 'editor field A', asA)
  bArtist = await createThrowawayArtist(svc, 'editor field B', asB)
  artistA = a.id
  artistB = bArtist.id
  // A PLANTED WITNESS (AGENTS.md rule 2) for the cross-tenant bio test: a fresh artist's
  // bio is null, and "null is still null" would pass whether or not RLS refused anything
  // that also happened to write null.
  await svc.from('artists').update({ bio: B_BIO }).eq('id', artistB)
  const { data } = await svc.from('artists').select('template').eq('id', artistA).single<{ template: string }>()
  template = data!.template
})

afterAll(async () => {
  // Cascades every site_content row either artist ever held, whatever key it carried.
  await deleteThrowawayArtist(svc, a)
  await deleteThrowawayArtist(svc, bArtist)
})

describe('saveEditorField', () => {
  it('rejects an unknown field', async () => {
    expect(await saveEditorField(asA, artistA, template, 'nope_key', 'x')).toEqual({
      ok: false,
      error: 'Unknown field.',
    })
  })

  it('writes an artist column (bio)', async () => {
    expect((await saveEditorField(asA, artistA, template, 'artist_bio', 'Editor-written bio')).ok).toBe(true)
    const { data } = await svc.from('artists').select('bio').eq('id', artistA).single<{ bio: string }>()
    expect(data!.bio).toBe('Editor-written bio')
  })

  it('upserts a site_content override and clears it when blank', async () => {
    const { fieldKey, contentKey } = siteContentField()
    await svc.from('site_content').delete().eq('artist_id', artistA).eq('key', contentKey)

    expect((await saveEditorField(asA, artistA, template, fieldKey, 'Custom heading')).ok).toBe(true)
    const { data: set } = await svc
      .from('site_content')
      .select('value')
      .eq('artist_id', artistA)
      .eq('key', contentKey)
      .maybeSingle<{ value: string }>()
    expect(set?.value).toBe('Custom heading')

    expect((await saveEditorField(asA, artistA, template, fieldKey, '   ')).ok).toBe(true)
    const { data: cleared } = await svc
      .from('site_content')
      .select('value')
      .eq('artist_id', artistA)
      .eq('key', contentKey)
      .maybeSingle()
    expect(cleared).toBeNull()
  })

  it("CRITICAL: RLS blocks writing another tenant's field", async () => {
    const { data: b } = await svc.from('artists').select('template, bio').eq('id', artistB).single<{ template: string; bio: string | null }>()
    expect(b!.bio, 'the witness must exist before the denial means anything').toBe(B_BIO)
    // A denied UPDATE returns error:null with zero rows matched, so the ROW is the only
    // honest evidence (AGENTS.md rule 3).
    await saveEditorField(asA, artistB, b!.template, 'artist_bio', 'HACKED')
    const { data: after } = await svc.from('artists').select('bio').eq('id', artistB).single<{ bio: string | null }>()
    expect(after!.bio).toBe(B_BIO) // untouched
  })
})

/**
 * The CUSTOM-SITE path. A custom site posts its manifest over the bridge at runtime, so
 * there is nothing local to resolve the field against — the same reason saveEditorStyle
 * skips manifest membership. The caller signals it with `template: null`.
 *
 * The key is then CLIENT-SUPPLIED text that becomes a site_content key, so the shape
 * check and the reserved-key refusal are the only things standing between the Text panel
 * and keys other features read (the enquiry recipient ladder's booking_email, lib/seo.ts's
 * SEO keys).
 */
describe('saveEditorField — custom site (manifest arrives at runtime)', () => {
  /** How a caller says "custom site": NULL, not an unknown template string. A custom
   *  artist's `template` column still names a built-in template, so "manifestFor found
   *  nothing" is a state that never occurs — see the PREMISE test below. */
  const CUSTOM = null
  const KEY = 'test_custom_caption'
  /** Keys the shape check must refuse. `''` is refused too but can never appear as a row
   *  key. No pre-clean and no teardown any more: the artist is this file's own, so a
   *  previous run's leftovers cannot exist and "no row was written" is a fact about a
   *  table nobody else has touched. */
  const BAD_KEYS = ['Hero Caption', 'hero-caption', 'hero.caption', '../booking_email', 'x'.repeat(65)]

  it('PREMISE: a real custom-site artist still resolves a BUILT-IN manifest', async () => {
    // The reason this path is selected by null rather than by a missing manifest. If this
    // ever fails, `artists.template` gained a custom value and the two mechanisms have
    // stopped being different — check both callers before simplifying either.
    const { data } = await svc
      .from('artists')
      .select('template, site_kind')
      .eq('site_kind', 'custom')
      .limit(1)
      .maybeSingle<{ template: string; site_kind: string }>()
    if (!data) return // no custom-site artist seeded here; nothing to assert against
    expect(manifestFor(data.template)).toBeDefined()
  })

  it('CRITICAL: an ARTIST-COLUMN target writes the column the page renders — never site_content', async () => {
    // ftbk, 2026-08-20: custom fields with declared artist targets (name/bio) silently
    // wrote site_content by key, and the page — which renders artist.bio — never showed
    // the edit. The target rides along from the announced manifest, validated here.
    await svc.from('site_content').delete().eq('artist_id', artistA).eq('key', 'artist_bio')
    const res = await saveEditorField(asA, artistA, CUSTOM, 'artist_bio', '  Bio via target.  ', { store: 'artist', column: 'bio' })
    expect(res.ok).toBe(true)
    const { data } = await svc.from('artists').select('bio').eq('id', artistA).single<{ bio: string | null }>()
    expect(data?.bio).toBe('Bio via target.')
    // …and NOT the historic wrong home.
    const { data: sc } = await svc.from('site_content').select('value').eq('artist_id', artistA).eq('key', 'artist_bio').maybeSingle()
    expect(sc).toBeNull()
  })

  it('a blanked NAME is refused — the column is the identity of the whole dashboard', async () => {
    const res = await saveEditorField(asA, artistA, CUSTOM, 'artist_name', '   ', { store: 'artist', column: 'name' })
    expect(res.ok).toBe(false)
  })

  it('CRITICAL: a NON-ALLOWLISTED target is ignored, not honoured — the bridge proves nothing', async () => {
    // hero_image_url is image-only; a text save must never reach an arbitrary column.
    const res = await saveEditorField(asA, artistA, CUSTOM, KEY, 'x', { store: 'artist', column: 'hero_image_url' } as never)
    expect(res.ok).toBe(true) // falls through to the site_content path…
    const { data } = await svc.from('site_content').select('value').eq('artist_id', artistA).eq('key', KEY).maybeSingle<{ value: string }>()
    expect(data?.value).toBe('x') // …written under the key, no column touched
  })

  it('upserts the field key straight into site_content', async () => {
    await svc.from('site_content').delete().eq('artist_id', artistA).eq('key', KEY)
    expect((await saveEditorField(asA, artistA, CUSTOM, KEY, '  / backstage /  ')).ok).toBe(true)
    const { data } = await svc
      .from('site_content')
      .select('value')
      .eq('artist_id', artistA)
      .eq('key', KEY)
      .maybeSingle<{ value: string }>()
    expect(data?.value).toBe('/ backstage /') // trimmed, stored under the key itself
  })

  it('DELETES the row when the value is blank, so clearing a caption really clears it', async () => {
    // Storing '' would ship an empty string to the site instead of removing the override.
    await svc.from('site_content').upsert(
      { artist_id: artistA, key: KEY, value: 'something' },
      { onConflict: 'artist_id,key' },
    )
    expect((await saveEditorField(asA, artistA, CUSTOM, KEY, '   ')).ok).toBe(true)
    const { data } = await svc
      .from('site_content')
      .select('value')
      .eq('artist_id', artistA)
      .eq('key', KEY)
      .maybeSingle()
    expect(data).toBeNull()
  })

  it('caps the stored value at 2000 characters', async () => {
    // skeen's caption strip is 80px and clips overflow: a long caption is invisible on
    // the site but still ships in the HTML of every page load.
    expect((await saveEditorField(asA, artistA, CUSTOM, KEY, 'x'.repeat(2500))).ok).toBe(true)
    const { data } = await svc
      .from('site_content')
      .select('value')
      .eq('artist_id', artistA)
      .eq('key', KEY)
      .maybeSingle<{ value: string }>()
    expect(data!.value.length).toBe(2000)
  })

  it('REFUSES a key that is not a plain lowercase identifier', async () => {
    for (const bad of [...BAD_KEYS, '']) {
      expect(await saveEditorField(asA, artistA, CUSTOM, bad, 'x')).toEqual({ ok: false, error: 'Unknown field.' })
    }
    // The refusal has to be a refusal to WRITE, not just a false return value.
    const { count } = await svc
      .from('site_content')
      .select('key', { count: 'exact', head: true })
      .eq('artist_id', artistA)
      .in('key', BAD_KEYS)
    expect(count).toBe(0)
  })

  it('CRITICAL: REFUSES a key another feature reads (booking_email), leaving it intact', async () => {
    // A custom manifest is client-supplied, so a field called `booking_email` would let
    // the Text panel re-route the artist's enquiries (submit_enquiry.sql rung 3).
    await svc.from('site_content').upsert(
      { artist_id: artistA, key: 'booking_email', value: 'real@lonestar.test' },
      { onConflict: 'artist_id,key' },
    )
    const res = await saveEditorField(asA, artistA, CUSTOM, 'booking_email', 'attacker@evil.example')
    expect(res).toEqual({ ok: false, error: 'That field name is reserved.' })
    const { data } = await svc
      .from('site_content')
      .select('value')
      .eq('artist_id', artistA)
      .eq('key', 'booking_email')
      .maybeSingle<{ value: string }>()
    expect(data?.value).toBe('real@lonestar.test') // the planted witness survived
  })

  it('REFUSES the SEO keys, which lib/seo.ts reads for every artist', async () => {
    // Derived from the registry (AGENTS.md rule 4): a key added to SEO_FIELDS is reserved
    // AND proven reserved on the same day.
    for (const key of SEO_FIELDS.map((f) => f.key)) {
      expect((await saveEditorField(asA, artistA, CUSTOM, key, 'x')).ok).toBe(false)
    }
  })

  it('REFUSES the cursor keys — they carry URLs into a CSS url() sink, so only the validated path writes them', async () => {
    for (const key of CURSOR_KEYS) {
      expect(await saveEditorField(asA, artistA, CUSTOM, key, 'javascript:alert(1)')).toEqual({
        ok: false,
        error: 'That field name is reserved.',
      })
    }
  })

  describe('saveCursorField — the one path that CAN write a cursor key', () => {
    // No teardown: both artists are dropped by this file's afterAll, which cascades every
    // cursor key with them. The old one deleted CURSOR_KEYS for both SEED artists, i.e.
    // a real manager's cursor image, trail and trail colour, on every run.

    it('CRITICAL: stores a valid https cursor image and deletes it on blank', async () => {
      const key = CURSOR_CONTENT_KEYS.image
      expect((await saveCursorField(asA, artistA, key, 'https://x.test/cursor.png')).ok).toBe(true)
      const { data } = await svc
        .from('site_content').select('value').eq('artist_id', artistA).eq('key', key)
        .maybeSingle<{ value: string }>()
      expect(data?.value).toBe('https://x.test/cursor.png')
      expect((await saveCursorField(asA, artistA, key, '')).ok).toBe(true)
      const { data: gone } = await svc
        .from('site_content').select('value').eq('artist_id', artistA).eq('key', key).maybeSingle()
      expect(gone).toBeNull()
    })

    it('CRITICAL: refuses a scheme payload BEFORE it reaches the row', async () => {
      // Plant a witness so "the bad value did not store" is not vacuously true.
      await svc.from('site_content').upsert(
        { artist_id: artistA, key: CURSOR_CONTENT_KEYS.image, value: 'https://x.test/real.png' },
        { onConflict: 'artist_id,key' },
      )
      const res = await saveCursorField(asA, artistA, CURSOR_CONTENT_KEYS.image, 'javascript:alert(1)')
      expect(res.ok).toBe(false)
      const { data } = await svc
        .from('site_content').select('value').eq('artist_id', artistA).eq('key', CURSOR_CONTENT_KEYS.image)
        .maybeSingle<{ value: string }>()
      expect(data?.value).toBe('https://x.test/real.png') // witness intact
    })

    it('refuses an undeclared trail style and a non-hex color', async () => {
      expect((await saveCursorField(asA, artistA, CURSOR_CONTENT_KEYS.trail, 'confetti')).ok).toBe(false)
      expect((await saveCursorField(asA, artistA, CURSOR_CONTENT_KEYS.trailColor, 'red')).ok).toBe(false)
      expect((await saveCursorField(asA, artistA, CURSOR_CONTENT_KEYS.trail, 'dots')).ok).toBe(true)
    })

    it("CRITICAL: a non-owner's cursor write does not take effect", async () => {
      // RLS makes the denied upsert look like success — assert the ROW, not the result.
      await saveCursorField(asA, artistB, CURSOR_CONTENT_KEYS.image, 'https://x.test/hacked.png')
      const { data } = await svc
        .from('site_content').select('value').eq('artist_id', artistB).eq('key', CURSOR_CONTENT_KEYS.image)
        .maybeSingle()
      expect(data).toBeNull() // nothing INSERTED for tenant B

      // …and the UPDATE half, with a PLANTED witness (rule 2): B's real case is a cursor
      // it already set, and defacing that is the attack absence alone cannot rule out.
      await svc.from('site_content').insert({
        artist_id: artistB, key: CURSOR_CONTENT_KEYS.image, value: 'https://b.test/own-cursor.png',
      })
      await saveCursorField(asA, artistB, CURSOR_CONTENT_KEYS.image, 'https://x.test/hacked.png')
      const { data: still } = await svc
        .from('site_content').select('value').eq('artist_id', artistB).eq('key', CURSOR_CONTENT_KEYS.image)
        .single<{ value: string }>()
      expect(still!.value).toBe('https://b.test/own-cursor.png')
    })
  })

  it("CRITICAL: a non-owner's custom-field save does not take effect", async () => {
    // Row-filtered writes return error:null, so assert the ROW's state, not the result.
    await svc.from('site_content').upsert(
      { artist_id: artistB, key: KEY, value: 'tenant B copy' },
      { onConflict: 'artist_id,key' },
    )
    await saveEditorField(asA, artistB, CUSTOM, KEY, 'HACKED')
    await saveEditorField(asA, artistB, CUSTOM, KEY, '') // and the clear path can't delete it
    const { data } = await svc
      .from('site_content')
      .select('value')
      .eq('artist_id', artistB)
      .eq('key', KEY)
      .maybeSingle<{ value: string }>()
    expect(data?.value).toBe('tenant B copy')
  })
})
