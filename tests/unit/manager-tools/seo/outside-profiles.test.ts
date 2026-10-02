/**
 * The Profiles tab's Discogs and Wikidata checks ask the right thing, politely, and tell the
 * manager only what the answer says.
 *
 * Code:     src/lib/manager-tools/seo/profiles/outside.ts (what is asked, how an answer is read),
 *           src/lib/manager-tools/seo/profiles/outside-check.ts (the fetching)
 * Feature:  SEO / GEO page · Profiles tab · the Discogs and Wikidata rows (VISIBILITY_TOOLKIT.md
 *           "Round 3")
 * Tier:     STRICT (AGENTS.md "Test depth"): it builds addresses from the artist's data and
 *           decides what the artist is told to do on another service.
 * Covers:   • which site is asked about: the custom site by the AI test's rule, path kept; a
 *             template artist's `<app>/<slug>` page is no site (its host is every artist's)
 *           • the site's spellings (Wikidata's match is exact), on the site's own path, and the
 *             one search built from them
 *           • "the same site": host AND, for a site on a path, that path (another page on a
 *             shared host is someone else's)
 *           • the ids Tapir already knows: Connections links, and the AI test's MusicBrainz page
 *             (a pass only)
 *           • Wikidata: found through the search (by the website alone, too), with which of P856 /
 *             P434 the item carries; no item; a 429 given up at once; a linked item that is gone
 *             falls back to the search; no site and no MusicBrainz id is "no site", nothing asked
 *           • Discogs: lists the site (any spelling) / site missing / no page there / no page
 *             linked or no site (nothing asked) / couldn't check
 *           • each service gets its own User-Agent
 * Not here: the Discogs and Wikidata link parsers (tests/unit/manager-tools/connections/identity-only.test.ts);
 *           guardedFetch's address and redirect rules (tests/unit/safe-fetching/); the rows'
 *           words (tests/components/manager-tools/seo/outside-rows.test.tsx); the day-long cache
 *           (outside-load.ts, Next's unstable_cache).
 * Fixtures: tests/fixtures/outside-profiles.json: REAL answers from Wikidata (Q1299, The Beatles,
 *           P856 https://thebeatles.com) and Discogs (82730 The Beatles; 1230117, the OTHER
 *           "Skeen"), fetched 2026-09-30 and trimmed; `search_P856_only_thebeatles` is the exact
 *           search Tapir sends with no MusicBrainz id (the 8 spellings, OR'd), fetched 2026-10-01:
 *           Wikidata DOES find an item by its website alone. `fakeSite` serves them; nothing
 *           reaches the network.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { connectedIds, isSameSite, knownMbid, profileSiteUrl, siteSpellings, wikidataSearchUrl } from '@/lib/manager-tools/seo/profiles/outside'
import { checkDiscogs, checkWikidata } from '@/lib/manager-tools/seo/profiles/outside-check'
import { fakeSite, type FakeAnswer, type FakeRequest } from '@tests/helpers/seo/fake-site'

const FIX = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/outside-profiles.json'), 'utf8'))
const BEATLES_MBID = 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d'
const json = (body: unknown, status = 200, headers: Record<string, string> = {}): FakeAnswer => ({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })

const SEARCH = 'https://www.wikidata.org/w/api.php'
const STATEMENTS = (q: string, p: string) => `https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/${q}/statements?property=${p}`
/** The search's own clause list, read back off the request. */
const clausesOf = (url: string) => (new URL(url).searchParams.get('srsearch') ?? '').replace(/^haswbstatement:/, '').split('|')

/** Wikidata as it answers for The Beatles: the search finds Q1299 when asked for ANY clause
 *  that item really carries (its P856 is stored as `https://thebeatles.com`, exactly). A search
 *  by the website alone gets the real answer to exactly that search. */
function beatlesWikidata(p856: unknown = FIX.wikidata.Q1299_P856) {
  return fakeSite(
    { [STATEMENTS('Q1299', 'P856')]: json(p856), [STATEMENTS('Q1299', 'P434')]: json(FIX.wikidata.Q1299_P434) },
    (req: FakeRequest) => {
      if (!req.url.startsWith(`${SEARCH}?`)) return undefined
      const clauses = clausesOf(req.url)
      if (!clauses.some((c) => c === 'P856=https://thebeatles.com' || c === `P434=${BEATLES_MBID}`)) return json(FIX.wikidata.search_none)
      return json(clauses.every((c) => c.startsWith('P856=')) ? FIX.wikidata.search_P856_only_thebeatles : FIX.wikidata.search_P434_or_P856_thebeatles)
    },
  )
}

/** A site that lives on a path of a host other artists share. */
const PATH_SITE = 'https://www.facebook.com/thebeatles'

describe('what is asked', () => {
  // Wikidata matches P856 exactly, so every common spelling of the homepage is asked: missing
  // one (the bare, slash-less https form is how The Beatles' is stored) misses the item.
  it('spells the site every common way, and nothing for an address that is not a web host', () => {
    expect(siteSpellings('https://www.skeenmusic.com')).toEqual([
      'https://www.skeenmusic.com/', 'https://www.skeenmusic.com', 'http://www.skeenmusic.com/', 'http://www.skeenmusic.com',
      'https://skeenmusic.com/', 'https://skeenmusic.com', 'http://skeenmusic.com/', 'http://skeenmusic.com',
    ])
    expect(siteSpellings('https://thebeatles.com/')).toContain('https://www.thebeatles.com/')
    for (const bad of [null, '', 'mailto:a@b.com', 'ftp://x.com', 'http://localhost:3000', 'not a url']) expect(siteSpellings(bad)).toEqual([])
  })

  // The site asked about is the custom site, by the AI test's own rule (seoSiteOrigin), with its
  // path. A template artist's page is `<this app>/<slug>`: asking for that host would find any
  // artist's, so it is no site. A local or private address is none either.
  it('asks about the custom site, path kept; a template page or a private address is no site', () => {
    expect(profileSiteUrl({ site_kind: 'custom', custom_site_url: 'https://www.skeenmusic.com/' })).toBe('https://www.skeenmusic.com')
    expect(profileSiteUrl({ site_kind: 'custom', custom_site_url: ' https://linktr.ee/skeen/ ' })).toBe('https://linktr.ee/skeen')
    for (const row of [
      { site_kind: 'template', custom_site_url: null },
      { site_kind: 'template', custom_site_url: 'https://www.skeenmusic.com' },
      { site_kind: 'custom', custom_site_url: 'http://localhost:3004' },
      { site_kind: 'custom', custom_site_url: 'http://10.0.0.7/skeen' },
      null,
    ]) expect(profileSiteUrl(row), JSON.stringify(row)).toBeNull()
  })

  // A site on a path is spelled on that path, never as the bare host: P856=https://www.facebook.com/
  // would match every artist whose website is Facebook's home page. A `|` in the path would add a
  // clause of its own to the OR, so such a path is not asked about.
  it('spells a site that lives on a path on that path, and never the bare host', () => {
    expect(siteSpellings(PATH_SITE)).toEqual([
      'https://www.facebook.com/thebeatles/', 'https://www.facebook.com/thebeatles', 'http://www.facebook.com/thebeatles/', 'http://www.facebook.com/thebeatles',
      'https://facebook.com/thebeatles/', 'https://facebook.com/thebeatles', 'http://facebook.com/thebeatles/', 'http://facebook.com/thebeatles',
    ])
    expect(clausesOf(wikidataSearchUrl(`${PATH_SITE}/`, null)!).every((c) => c.includes('facebook.com/thebeatles'))).toBe(true)
    expect(siteSpellings('https://x.com/a|P434=b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d')).toEqual([])
  })

  // The same site: host (give or take www. and the scheme) and, for a site on a path, that path
  // or a page under it. A root site owns its whole host.
  it('the same site: the host, and the path for a site that lives on one', () => {
    for (const same of ['https://facebook.com/thebeatles', 'http://www.facebook.com/thebeatles/', 'https://www.facebook.com/thebeatles/videos']) expect(isSameSite(same, PATH_SITE), same).toBe(true)
    for (const other of ['https://www.facebook.com/', 'https://www.facebook.com/someoneelse', 'https://www.facebook.com/thebeatles2', 'https://thebeatles.com/']) expect(isSameSite(other, PATH_SITE), other).toBe(false)
    expect(isSameSite('https://www.thebeatles.com/shop', 'https://thebeatles.com')).toBe(true)
  })

  // ONE search, every clause OR'd: the MusicBrainz id (lower-cased, and only a real one) and
  // each spelling of the site. Nothing to ask by = no search at all.
  it('builds one OR search from the MusicBrainz id and the site', () => {
    const url = wikidataSearchUrl('https://www.skeenmusic.com', BEATLES_MBID.toUpperCase())!
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe(SEARCH)
    expect(u.searchParams.get('action')).toBe('query')
    expect(u.searchParams.get('list')).toBe('search')
    expect(u.searchParams.get('srsearch')).toBe(`haswbstatement:P434=${BEATLES_MBID}|${siteSpellings('https://www.skeenmusic.com').map((s) => `P856=${s}`).join('|')}`)
    expect(clausesOf(wikidataSearchUrl('https://www.skeenmusic.com', 'not-an-mbid')!)).toHaveLength(8)
    expect(clausesOf(wikidataSearchUrl(null, BEATLES_MBID)!)).toEqual([`P434=${BEATLES_MBID}`])
    expect(wikidataSearchUrl(null, null)).toBeNull()
  })

  // The ids come from the manager's own Connections links first; the AI test's MusicBrainz page
  // only when that test PASSED (a failed one names someone else's page, or none).
  it('knows the ids from Connections, and the MusicBrainz id from a passing AI test only', () => {
    const links = [
      { url: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR' },
      { url: 'https://www.discogs.com/artist/1230117-Skeen' },
      { url: 'https://www.wikidata.org/wiki/Q1299' },
    ]
    expect(connectedIds(links)).toEqual({ mbid: null, wikidata: 'Q1299', discogs: '1230117' })
    const page = { label: 'MusicBrainz page', value: `https://musicbrainz.org/artist/${BEATLES_MBID}` }
    expect(knownMbid(links, { status: 'pass', evidence: [page] })).toBe(BEATLES_MBID)
    expect(knownMbid(links, { status: 'fail', evidence: [page] })).toBeNull()
    expect(knownMbid(links, null)).toBeNull()
    const other = '0383dadf-2a4e-4d10-a46a-e9e041da8eb3'
    expect(knownMbid([...links, { url: `https://musicbrainz.org/artist/${other}` }], { status: 'pass', evidence: [page] })).toBe(other)
  })
})

describe('Wikidata', () => {
  // The Beatles' real answers: the search finds Q1299 by a site spelling, and the item carries
  // both the site and the MusicBrainz id. Asked as a bot with a contact address, no email.
  it('finds the item and reads which of the site and the MusicBrainz id it carries', async () => {
    const web = beatlesWikidata()
    const r = await checkWikidata({ siteUrl: 'https://www.thebeatles.com/', mbid: BEATLES_MBID, item: null }, { fetcher: web })
    expect(r).toEqual({ kind: 'found', item: 'Q1299', url: 'https://www.wikidata.org/wiki/Q1299', hasSite: true, hasMbid: true })
    expect(web.calls.length).toBe(3)
    for (const c of web.calls) expect(c.ua).toBe('TapirBot/1.0 (https://tapirwebsites.com)')

    // A known MusicBrainz id that is not the item's: found by the site, but the id is "missing".
    const other = await checkWikidata({ siteUrl: 'https://thebeatles.com', mbid: '0383dadf-2a4e-4d10-a46a-e9e041da8eb3', item: null }, { fetcher: beatlesWikidata() })
    expect(other).toMatchObject({ kind: 'found', hasSite: true, hasMbid: false })

    // A DEPRECATED website (Wikidata's "wrong or outdated") is not the site.
    const old = structuredClone(FIX.wikidata.Q1299_P856)
    old.P856[0].rank = 'deprecated'
    expect(await checkWikidata({ siteUrl: 'https://thebeatles.com', mbid: BEATLES_MBID, item: null }, { fetcher: beatlesWikidata(old) })).toMatchObject({ kind: 'found', hasSite: false, hasMbid: true })
  })

  // No MusicBrainz id: the website alone finds the item (the real answer to exactly this search).
  // No site but a MusicBrainz id: the item is found and the site is not asked about (null), so
  // the row never says "site missing" to an artist who has none.
  it('finds the item by the website alone, and says nothing about a site the artist doesn’t have', async () => {
    const web = beatlesWikidata()
    expect(await checkWikidata({ siteUrl: 'https://www.thebeatles.com', mbid: null, item: null }, { fetcher: web })).toEqual({ kind: 'found', item: 'Q1299', url: 'https://www.wikidata.org/wiki/Q1299', hasSite: true, hasMbid: true })
    expect(clausesOf(web.calls[0].url).every((c) => c.startsWith('P856='))).toBe(true)
    expect(await checkWikidata({ siteUrl: null, mbid: BEATLES_MBID, item: null }, { fetcher: beatlesWikidata() })).toMatchObject({ kind: 'found', item: 'Q1299', hasSite: null, hasMbid: true })
  })

  // No item lists the site: "no item yet". A 429 is given up at once (one request, no retry).
  // A linked item Wikidata no longer has falls back to the search. Nothing to ask by: no request.
  it('says no item, gives up on a 429, falls back from a gone item, and asks nothing with no site and no ID', async () => {
    expect(await checkWikidata({ siteUrl: 'https://www.skeenmusic.com', mbid: null, item: null }, { fetcher: beatlesWikidata() })).toEqual({ kind: 'none', byMbid: false })

    const busy = fakeSite({}, () => json({ error: 'slow down' }, 429, { 'retry-after': '30' }))
    expect(await checkWikidata({ siteUrl: 'https://thebeatles.com', mbid: null, item: null }, { fetcher: busy })).toEqual({ kind: 'unknown' })
    expect(busy.calls.length).toBe(1)

    const viaGone = fakeSite({ [STATEMENTS('Q999999990', 'P856')]: json(FIX.wikidata.Q999999990_missing, 404), [STATEMENTS('Q999999990', 'P434')]: json(FIX.wikidata.Q999999990_missing, 404), [STATEMENTS('Q1299', 'P856')]: json(FIX.wikidata.Q1299_P856), [STATEMENTS('Q1299', 'P434')]: json(FIX.wikidata.Q1299_P434) }, (req) =>
      req.url.startsWith(`${SEARCH}?`) ? json(FIX.wikidata.search_P434_or_P856_thebeatles) : undefined,
    )
    expect(await checkWikidata({ siteUrl: 'https://thebeatles.com', mbid: null, item: 'Q999999990' }, { fetcher: viaGone })).toMatchObject({ kind: 'found', item: 'Q1299', hasSite: true })

    const silent = fakeSite({})
    expect(await checkWikidata({ siteUrl: null, mbid: null, item: null }, { fetcher: silent })).toEqual({ kind: 'nosite' })
    expect(silent.calls.length).toBe(0)
  })
})

describe('Discogs', () => {
  const API = (id: string) => `https://api.discogs.com/artists/${id}`
  const discogsWeb = () =>
    fakeSite({
      [API('82730')]: json(FIX.discogs.artist_82730_the_beatles),
      [API('1230117')]: json(FIX.discogs.artist_1230117_the_other_skeen),
      [API('999999999')]: json(FIX.discogs.artist_999999999_missing, 404),
      [API('5')]: json({ message: 'You are making requests too quickly.' }, 429),
    })

  // Only the page the manager linked is read. Any spelling of the site counts (Discogs has
  // `https://www.thebeatles.com/`); a page with no Sites (the other Skeen) is "site missing";
  // 404 is "no page there"; no link asks nothing; a 429 is "couldn't check".
  it('reads the linked page: lists your site, site missing, gone, unlinked, couldn’t check', async () => {
    const web = discogsWeb()
    const id = connectedIds([{ url: 'https://www.discogs.com/artist/1230117-Skeen' }]).discogs
    expect(await checkDiscogs({ siteUrl: 'https://thebeatles.com', id: '82730' }, { fetcher: web })).toEqual({ kind: 'listed', id: '82730', url: 'https://www.discogs.com/artist/82730' })
    expect(await checkDiscogs({ siteUrl: 'https://www.skeenmusic.com', id }, { fetcher: web })).toEqual({ kind: 'missing', id: '1230117', url: 'https://www.discogs.com/artist/1230117' })
    expect(await checkDiscogs({ siteUrl: 'https://www.skeenmusic.com', id: '999999999' }, { fetcher: web })).toMatchObject({ kind: 'gone' })
    expect(await checkDiscogs({ siteUrl: 'https://www.skeenmusic.com', id: '5' }, { fetcher: web })).toEqual({ kind: 'unknown', url: 'https://www.discogs.com/artist/5' })
    expect(web.calls.map((c) => c.ua)).toEqual(Array(4).fill('TapirSites/1.0 +https://tapirwebsites.com'))

    const none = discogsWeb()
    expect(await checkDiscogs({ siteUrl: 'https://www.skeenmusic.com', id: null }, { fetcher: none })).toEqual({ kind: 'unlinked' })
    // A linked page but no site: nothing to look for, so nothing is asked ("no site", not "couldn't check").
    expect(await checkDiscogs({ siteUrl: null, id: '82730' }, { fetcher: none })).toEqual({ kind: 'nosite', id: '82730', url: 'https://www.discogs.com/artist/82730' })
    expect(none.calls.length).toBe(0)
  })

  // The Beatles' real page lists https://www.facebook.com/thebeatles. A site at ANOTHER path on
  // Facebook is not on it: the host alone would have said "lists your site".
  it('a site on a shared host is listed only at its own path', async () => {
    expect(await checkDiscogs({ siteUrl: PATH_SITE, id: '82730' }, { fetcher: discogsWeb() })).toMatchObject({ kind: 'listed' })
    expect(await checkDiscogs({ siteUrl: 'https://www.facebook.com/someoneelse', id: '82730' }, { fetcher: discogsWeb() })).toMatchObject({ kind: 'missing' })
  })
})
