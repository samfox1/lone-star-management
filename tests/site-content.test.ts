/**
 * SITE EDITOR — site_content override behavior + draft→publish + XSS guard.
 * (Isolation is covered separately in site-content.isolation.test.ts.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishContent } from '@/lib/content'
import { getWorkingSite } from '@/lib/site'
import { fieldHref, fieldValue } from '@/lib/site-content-schema'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

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
