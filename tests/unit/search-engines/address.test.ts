// The one address a site is registered under at Google and Bing, worked out once.
/**
 * Code:     src/lib/search-engines/address.ts (registrationForm, resolveSiteAddress)
 * Feature:  Add website · registering a site with Google and Bing (ADD_WEBSITE_PLAN.md step 4)
 * Tier:     STRICT (AGENTS.md "Test depth"): a parser of addresses that end up as a Search
 *           Console property and a Bing site, in the database's site_url CHECK, and in every
 *           URL Inspection call. Registering the apex of a site that redirects to www verifies
 *           fine and then quietly fails every sitemap and inspection call, so the FINAL address
 *           after redirects is the one kept.
 * Covers:   • the registered form: https, lower-case host, trailing slash, no path, no port
 *           • refused: http, a preview (*.vercel.app), loopback and private addresses, a bare
 *             IP (v4 or v6), any explicit port, names the database would refuse, junk
 *           • the live site decides: the final address after redirects, apex → www kept,
 *             a redirect to ANOTHER site (lookalike names, other subdomains) refused with where it
 *             went, no answer (or an error status) said as such
 *           • the form always passes the database CHECK on site_verifications.site_url
 * Not here: the guarded fetch itself (tests/unit/safe-fetching/).
 * Fixtures: a fake fetch that answers with scripted redirects; no network.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SITE_URL_SHAPE, registrationForm, resolveSiteAddress } from '@/lib/search-engines/address'

/** The database's own CHECK on site_verifications.site_url, read from the migration. */
const DB_SITE_URL = (() => {
  const sql = readFileSync(join(__dirname, '../../../supabase/migrations/20260930120000_site_verifications.sql'), 'utf8')
  const m = sql.match(/site_url ~ '([^']+)'/)
  if (!m) throw new Error('site_url CHECK not found in the migration')
  return new RegExp(m[1])
})()

/** A fake web: each address answers with a redirect to the next, or 200. */
function web(routes: Record<string, string | number>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const to = routes[url]
    if (to === undefined) throw new TypeError('fetch failed')
    if (typeof to === 'number') return new Response('<html></html>', { status: to, headers: { 'content-type': 'text/html' } })
    return new Response(null, { status: 308, headers: { location: to } })
  }) as typeof fetch
}

describe('registrationForm', () => {
  // The one shape every provider call and the database agree on.
  it('gives https, a lower-case host and a trailing slash', () => {
    expect(registrationForm('https://www.skeenmusic.com')).toBe('https://www.skeenmusic.com/')
    expect(registrationForm('https://WWW.SkeenMusic.COM/')).toBe('https://www.skeenmusic.com/')
    expect(registrationForm('  https://www.skeenmusic.com/about?x=1#y ')).toBe('https://www.skeenmusic.com/')
    expect(registrationForm('https://bücher.example')).toBe('https://xn--bcher-kva.example/')
    // Digits are fine inside a name: only an all-digit host is an IP address.
    expect(registrationForm('https://123abc.com')).toBe('https://123abc.com/')
    expect(registrationForm('https://1975.band')).toBe('https://1975.band/')
    expect(registrationForm('https://my.site2')).toBe('https://my.site2/')
  })

  // The longest address the database takes is 300 characters; one more is refused.
  it('takes an address up to 300 characters, not 301', () => {
    const at = (n: number) => `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(n - 8 - 3 * 64 - 5)}.com/`
    expect(registrationForm(at(300))).toHaveLength(300)
    expect(registrationForm(at(301))).toBeNull()
  })

  // Not text at all: refused, never a crash.
  it('refuses a value that isn’t text', () => {
    for (const bad of [null, undefined, 42, {}]) expect(registrationForm(bad as unknown as string)).toBeNull()
  })

  // Anything Google or Bing shouldn't be told about, or the database would refuse.
  it('refuses what can’t be registered', () => {
    for (const bad of [
      'http://www.skeenmusic.com',
      'https://skeen-website.vercel.app',
      'https://localhost',
      'https://127.0.0.1',
      'https://10.0.0.8',
      'https://8.8.8.8',
      'https://www.skeenmusic.com:8443',
      'https://www.skeenmusic.com:80',
      'https://[2606:4700:4700::1111]',
      'https://my_site.example.com',
      'https://-foo.example.com',
      'https://a..b.com',
      'ftp://www.skeenmusic.com',
      'skeenmusic.com',
      '',
      'not a url',
    ]) {
      expect(registrationForm(bad), bad).toBeNull()
    }
  })

  // The code's shape IS the database's: read from the migration, so the two can't drift.
  it('uses the database’s own site_url CHECK', () => {
    expect(SITE_URL_SHAPE.source).toBe(DB_SITE_URL.source)
  })

  // Whatever comes in, what comes out is either nothing or an address the database accepts.
  it('never gives an address the database would refuse', () => {
    const inputs = ['https://www.skeenmusic.com', 'https://a.b.c.example/x', 'https://bücher.example', 'https://my-site.co.uk', 'https://my_site.example.com', 'https://-foo.example.com', 'https://a..b.com', 'https://www.skeenmusic.com./', `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}.com`]
    for (const input of inputs) {
      const form = registrationForm(input)
      if (form !== null) expect(form, input).toMatch(DB_SITE_URL)
    }
    expect(registrationForm('https://www.skeenmusic.com./')).toBe('https://www.skeenmusic.com/')
  })
})

describe('resolveSiteAddress: the live site decides', () => {
  // Skeen: the apex 308s to www, and www is what gets registered.
  it('follows the redirect from the apex to www', async () => {
    const fetcher = web({ 'https://skeenmusic.com/': 'https://www.skeenmusic.com/', 'https://www.skeenmusic.com/': 200 })
    expect(await resolveSiteAddress('https://skeenmusic.com', { fetcher })).toEqual({ ok: true, siteUrl: 'https://www.skeenmusic.com/' })
  })

  // Already the final address: nothing moves.
  it('keeps an address that answers itself', async () => {
    const fetcher = web({ 'https://www.skeenmusic.com/': 200 })
    expect(await resolveSiteAddress('https://www.skeenmusic.com', { fetcher })).toEqual({ ok: true, siteUrl: 'https://www.skeenmusic.com/' })
  })

  // A site that forwards to someone else's (a link page, a store) is not this artist's site.
  it('refuses a redirect to another site', async () => {
    const fetcher = web({ 'https://www.newartist.com/': 'https://linktr.ee/newartist', 'https://linktr.ee/newartist': 200 })
    expect(await resolveSiteAddress('https://www.newartist.com', { fetcher })).toEqual({ ok: false, reason: 'redirects_elsewhere', to: 'https://linktr.ee/newartist' })
  })

  // Lookalikes and other subdomains are other sites: only the name itself, with or without www.
  it('refuses lookalike names and other subdomains', async () => {
    for (const to of ['https://www.evil-skeenmusic.com/', 'https://skeenmusic.com.evil.com/', 'https://music.skeenmusic.com/', 'https://skeenmusic.www.com/']) {
      const fetcher = web({ 'https://skeenmusic.com/': to, [to]: 200 })
      expect(await resolveSiteAddress('https://skeenmusic.com', { fetcher }), to).toEqual({ ok: false, reason: 'redirects_elsewhere', to })
    }
  })

  // www → apex is the same site too.
  it('accepts www redirecting to the bare name', async () => {
    const fetcher = web({ 'https://www.newartist.com/': 'https://newartist.com/', 'https://newartist.com/': 200 })
    expect(await resolveSiteAddress('https://www.newartist.com', { fetcher })).toEqual({ ok: true, siteUrl: 'https://newartist.com/' })
  })

  // A site that doesn't answer can't be registered yet; say so.
  it('says when the site doesn’t answer, or answers with an error', async () => {
    expect(await resolveSiteAddress('https://www.newartist.com', { fetcher: web({}) })).toEqual({ ok: false, reason: 'no_answer', detail: 'network' })
    for (const status of [503, 404, 400]) {
      const down = web({ 'https://www.newartist.com/': status })
      expect(await resolveSiteAddress('https://www.newartist.com', { fetcher: down })).toMatchObject({ ok: false, reason: 'no_answer', detail: `answered ${status}` })
    }
  })

  // A redirect with nowhere to go (no Location) is not a site answering.
  it('says no answer for a redirect with no Location', async () => {
    const fetcher = (async () => new Response(null, { status: 308 })) as typeof fetch
    expect(await resolveSiteAddress('https://www.newartist.com', { fetcher })).toMatchObject({ ok: false, reason: 'no_answer' })
  })

  // Nothing is fetched for an address that can't be registered.
  it('refuses a bad address without fetching it', async () => {
    let fetched = false
    const spy = (async () => {
      fetched = true
      return new Response(null, { status: 200 })
    }) as typeof fetch
    expect(await resolveSiteAddress('http://www.newartist.com', { fetcher: spy })).toEqual({ ok: false, reason: 'bad_address' })
    expect(fetched).toBe(false)
  })
})
