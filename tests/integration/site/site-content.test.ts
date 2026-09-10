// Site text overrides, draft to publish, and the guard against a typed field taking junk.
/**
 * SITE EDITOR — site_content override behavior + draft→publish + XSS guard.
 * (Isolation is covered separately in site-content.isolation.test.ts.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { diffUnpublished, publishContent } from '@/lib/content'
import { getWorkingSite } from '@/lib/site'
import { acceptsValue, fieldHref, fieldValue, type SiteContentField } from '@/lib/site-content-schema'
import { saveEditorField } from '@/lib/site-editor/save'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('site_content').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'site_content')
})

async function publicContent(): Promise<Record<string, string>> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return (data as { site_content?: Record<string, string> } | null)?.site_content ?? {}
}

describe('fieldValue override semantics', () => {
  it('returns the override when set, else the template default', () => {
    expect(fieldValue({}, 'cinematic', 'hero_tagline')).toBe('DJ & Producer')
    expect(fieldValue({ hero_tagline: 'Selector' }, 'cinematic', 'hero_tagline')).toBe('Selector')
    expect(fieldValue({ hero_tagline: '' }, 'cinematic', 'hero_tagline')).toBe('DJ & Producer')
    expect(fieldValue({}, 'cinematic', 'no_such_key')).toBe('')
  })
})

describe('fieldHref XSS guard', () => {
  it('produces a mailto for a real email, undefined for a javascript: payload', () => {
    expect(fieldHref({ booking_email: 'book@skeen.fm' }, 'cinematic', 'booking_email')).toBe(
      'mailto:book@skeen.fm',
    )
    expect(
      fieldHref({ booking_email: 'javascript:alert(1)' }, 'cinematic', 'booking_email'),
    ).toBeUndefined()
    expect(fieldHref({}, 'cinematic', 'booking_email')).toBeUndefined() // unset
  })

  it('only an email-typed field yields a link at all', () => {
    // Email is the only link-bearing type; a heading is React-escaped text, so a URL
    // typed into one stays inert rather than becoming a live outbound link nobody
    // reviewed. An unknown key is likewise not a link.
    expect(fieldHref({ hero_tagline: 'https://evil.example' }, 'cinematic', 'hero_tagline')).toBeUndefined()
    expect(fieldHref({}, 'cinematic', 'no_such_key')).toBeUndefined()
  })
})

describe('acceptsValue — the write-side guard on a typed field', () => {
  const email: SiteContentField = { key: 'booking_email', label: 'Booking email', type: 'email', default: '' }
  const text: SiteContentField = { key: 'shows_heading', label: 'Shows heading', type: 'text', default: 'Shows' }

  it('accepts a plausible address and refuses everything else', () => {
    expect(acceptsValue(email, 'book@skeen.fm')).toBe(true)
    expect(acceptsValue(email, 'book+tour@mgmt.co.uk')).toBe(true)

    for (const junk of [
      'not an email',
      'book@skeen', // no dot in the domain
      '@skeen.fm',
      'book@',
      'book @skeen.fm', // whitespace
      'javascript:alert(1)',
      'mailto:book@skeen.fm', // the scheme is added at render, never stored
    ]) {
      expect(acceptsValue(email, junk), junk).toBe(false)
    }
  })

  it('lets any text through a text field — headings are free-form', () => {
    expect(acceptsValue(text, 'Live dates <3')).toBe(true)
    expect(acceptsValue(text, '')).toBe(true)
  })
})

describe('saveEditorField — a typed field refuses junk before the write', () => {
  // A client that throws if any property is read — proves the guard returns before a write.
  const noDb = new Proxy(
    {},
    {
      get() {
        throw new Error('DB must not be touched for a rejected save')
      },
    },
  ) as unknown as SupabaseClient

  it('CRITICAL: the visual editor cannot store junk in an email-typed field', async () => {
    // booking_email is where /contact resolves the recipient (resolve_booking_recipient),
    // and it takes effect on live enquiries WITHOUT a publish. A stored non-address is a
    // silently dead inbox — enquiries accepted and delivered nowhere.
    expect(await saveEditorField(noDb, 'artist-1', 'cinematic', 'booking_email', 'not an email')).toEqual({
      ok: false,
      error: 'That value looks invalid.',
    })
    expect(await saveEditorField(noDb, 'artist-1', 'classic', 'booking_email', 'javascript:alert(1)')).toEqual({
      ok: false,
      error: 'That value looks invalid.',
    })
  })

  it('a real address writes through, and clearing it is always allowed', async () => {
    expect(await saveEditorField(asA, artistA, 'cinematic', 'booking_email', 'book@skeen.fm')).toEqual({ ok: true })
    const { data: set } = await svc
      .from('site_content')
      .select('value')
      .eq('artist_id', artistA)
      .eq('key', 'booking_email')
      .maybeSingle<{ value: string }>()
    expect(set?.value).toBe('book@skeen.fm')

    // Blank deletes the override before any type check — a manager must always be able to
    // undo a field, even one whose current value would no longer validate.
    expect(await saveEditorField(asA, artistA, 'cinematic', 'booking_email', '  ')).toEqual({ ok: true })
    const { data: cleared } = await svc
      .from('site_content')
      .select('value')
      .eq('artist_id', artistA)
      .eq('key', 'booking_email')
      .maybeSingle()
    expect(cleared).toBeNull()
  })
})

describe('site_content draft → publish', () => {
  it('CRITICAL: editing site text is a draft until publish; preview shows it', async () => {
    await asA
      .from('site_content')
      .upsert({ artist_id: artistA, key: 'shows_heading', value: 'Live' }, { onConflict: 'artist_id,key' })
    await publishContent(asA, 'site_content', artistA)
    expect((await publicContent()).shows_heading).toBe('Live')

    // Edit = draft.
    await asA
      .from('site_content')
      .update({ value: 'Gigs' })
      .eq('artist_id', artistA)
      .eq('key', 'shows_heading')
    expect((await publicContent()).shows_heading).toBe('Live') // public unchanged

    const working = await getWorkingSite(asA, artistA)
    expect(working?.site_content.shows_heading).toBe('Gigs') // preview shows draft

    await publishContent(asA, 'site_content', artistA)
    expect((await publicContent()).shows_heading).toBe('Gigs') // now live
  })

  it('diffUnpublished reports site_content dirty on edit, clean after publish (badge canary)', async () => {
    await asA
      .from('site_content')
      .upsert({ artist_id: artistA, key: 'about_heading', value: 'Bio' }, { onConflict: 'artist_id,key' })
    await publishContent(asA, 'site_content', artistA)
    expect((await diffUnpublished(asA, artistA)).site_content.dirty).toBe(false)

    await asA
      .from('site_content')
      .update({ value: 'Story' })
      .eq('artist_id', artistA)
      .eq('key', 'about_heading')
    expect((await diffUnpublished(asA, artistA)).site_content.dirty).toBe(true)

    await publishContent(asA, 'site_content', artistA)
    expect((await diffUnpublished(asA, artistA)).site_content.dirty).toBe(false)
  })

  it('removing a key tombstones it off the published site', async () => {
    await asA
      .from('site_content')
      .upsert({ artist_id: artistA, key: 'work_heading', value: 'Catalogue' }, { onConflict: 'artist_id,key' })
    await publishContent(asA, 'site_content', artistA)
    expect((await publicContent()).work_heading).toBe('Catalogue')

    await asA.from('site_content').delete().eq('artist_id', artistA).eq('key', 'work_heading')
    await publishContent(asA, 'site_content', artistA)
    expect((await publicContent()).work_heading).toBeUndefined()
  })
})
