import { afterAll, describe, expect, it } from 'vitest'
import { customSiteUrl, isCustom } from '@/lib/custom-site'
import { SEED, anonClient, artistIdBySlug, serviceClient } from '@tests/helpers/supabase'

describe('isCustom', () => {
  it('is a usable custom site only with kind=custom AND a url', () => {
    expect(isCustom({ site_kind: 'custom', custom_site_url: 'https://x.dev' })).toBe(true)
    expect(isCustom({ site_kind: 'custom', custom_site_url: null })).toBe(false)
    expect(isCustom({ site_kind: 'template', custom_site_url: 'https://x.dev' })).toBe(false)
    expect(isCustom(null)).toBe(false)
  })

  it('CRITICAL: only http(s) counts as a site', () => {
    // `/[slug]` hands this value straight to permanentRedirect, on a PUBLIC route with no
    // login. custom_site_url is manager-supplied free text, so anything that is not a web
    // address here is an arbitrary-scheme Location on a fan-facing URL: a stored open
    // redirect at best, `javascript:` navigation at worst.
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'mailto:book@skeen.fm', // a real link, but not somewhere a site is hosted
      '//evil.example', // protocol-relative — reads as a path, navigates off-origin
      '/somewhere', // relative — would redirect this route back onto itself
      'skeen.fm', // no scheme: not a resolvable Location
      'https://x.dev/\r\nSet-Cookie: a=b', // CR/LF splits the redirect response header
    ]) {
      expect(isCustom({ site_kind: 'custom', custom_site_url: url }), url).toBe(false)
    }
  })

  it('accepts an ordinary hosted site, trimmed', () => {
    expect(isCustom({ site_kind: 'custom', custom_site_url: 'http://staging.skeen.fm' })).toBe(true)
    expect(isCustom({ site_kind: 'custom', custom_site_url: '  https://skeen.fm/  ' })).toBe(true)
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

  it('CRITICAL: a non-http(s) value stored on the row never reaches the redirect', async () => {
    // The door is SECURITY DEFINER and returns whatever is in the column, so the scheme
    // check has to live on THIS side of it — otherwise a typo (or a compromised manager
    // account) turns the artist's public URL into someone else's landing page, permanently:
    // /[slug] issues a 308, which browsers cache.
    const id = await artistIdBySlug(SEED.artistBSlug)
    await svc.from('artists').update({ site_kind: 'custom', custom_site_url: 'javascript:alert(1)' }).eq('id', id)

    expect(await customSiteUrl(anonClient(), SEED.artistBSlug)).toBeNull()
  })

  it('does NOT leak the rest of the artists row to anon', async () => {
    // The door returns ONE public URL. A blanket anon SELECT policy on `artists`
    // would have exposed shopify_domain / bandsintown_name / integration ids.
    const { data } = await anonClient().from('artists').select('id, slug').limit(1)
    expect(data ?? []).toEqual([])
  })
})
