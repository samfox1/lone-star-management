import { afterAll, describe, expect, it } from 'vitest'
import { customSiteUrl, isCustom } from '@/lib/custom-site'
import { SEED, anonClient, artistIdBySlug, serviceClient } from './helpers/supabase'

describe('isCustom', () => {
  it('is a usable custom site only with kind=custom AND a url', () => {
    expect(isCustom({ site_kind: 'custom', custom_site_url: 'https://x.dev' })).toBe(true)
    expect(isCustom({ site_kind: 'custom', custom_site_url: null })).toBe(false)
    expect(isCustom({ site_kind: 'template', custom_site_url: 'https://x.dev' })).toBe(false)
    expect(isCustom(null)).toBe(false)
  })
})

/**
 * `customSiteUrl` is exercised against the REAL database as a REAL anonymous
 * client — never a fake.
 *
 * This originally used a hand-rolled fake of the `from().select().eq()` chain that
 * always returned the row. It passed while the real thing was broken: `/[slug]` is
 * a PUBLIC route on the anon client, and `artists_select` RLS
 * (`is_admin() OR is_manager_of(id)`) hides the row from a visitor — so the lookup
 * returned null for everyone and the redirect silently never fired. The fake had
 * mocked away the only thing that could break. Now it goes through the
 * `public_custom_site` door (20260714170000) and the tests use a real anon client.
 */
describe('customSiteUrl — as an ANONYMOUS visitor (the real public path)', () => {
  const svc = serviceClient()

  afterAll(async () => {
    const id = await artistIdBySlug(SEED.artistBSlug)
    await svc.from('artists').update({ site_kind: 'template', custom_site_url: null }).eq('id', id)
  })

  it('CRITICAL: anon resolves a custom site (RLS hides the artists table from them)', async () => {
    const id = await artistIdBySlug(SEED.artistBSlug)
    await svc
      .from('artists')
      .update({ site_kind: 'custom', custom_site_url: 'https://custom.example' })
      .eq('id', id)

    expect(await customSiteUrl(anonClient(), SEED.artistBSlug)).toBe('https://custom.example')
  })

  it('anon gets null for a template artist, and for an unknown slug', async () => {
    expect(await customSiteUrl(anonClient(), SEED.artistASlug)).toBeNull()
    expect(await customSiteUrl(anonClient(), 'no-such-artist-slug')).toBeNull()
  })

  it('does NOT leak the rest of the artists row to anon', async () => {
    // The door returns ONE public URL. A blanket anon SELECT policy on `artists`
    // would have exposed shopify_domain / bandsintown_name / integration ids.
    const { data } = await anonClient().from('artists').select('id, slug').limit(1)
    expect(data ?? []).toEqual([])
  })
})
