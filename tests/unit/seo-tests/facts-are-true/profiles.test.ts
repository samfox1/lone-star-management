/**
 * Proves the "Your fact card lists all your profiles" test passes only when the artist's own
 * node lists exactly the identity profiles Tapir published: none missing, none extra, none
 * twice, and no link that isn't a profile page.
 *
 * Code:     src/lib/seo-tests/facts.ts (`profiles`), comparing links with
 *           src/lib/seo-tests/html.ts (`linkKey`)
 * Feature:  SEO test `profiles` · Test tab "Facts are true"
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads untrusted JSON-LD from the live site and
 *           compares it with what Tapir published.
 * Covers:   • the same profiles as Tapir passes, however each link is spelled
 *           • the Spotify profile the bridge adds from the artist id counts as Tapir's
 *           • a profile missing, one Tapir doesn't have, a playlist, or one listed twice fails,
 *             naming it
 *           • no profiles at all points to Connections; another band's card is not yours
 *           • `sameAs` as one string, a list, or {"@id": url} is read
 * Not here: nothing published, a home page cut at the read cap, or unreachable
 *           (../honesty.test.ts); how two spellings of a link are matched (../page-reading/html.test.ts).
 * Fixtures: tests/helpers/seo/page-fixture.ts (a healthy site whose card lists 4 profiles, the same 4 Tapir
 *           published plus a booking mailto); `graphWith` swaps one node. Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import { FACTS_TESTS } from '@/lib/seo-tests/facts'
import { PROFILES, artistNode, evidence, expectPlainWords, graphBlock, healthyGraph, homeHtml, known, ldScript, rowOf, type Graph } from '@tests/helpers/seo/page-fixture'

const p = FACTS_TESTS.profiles
const withGraph = (graph: Graph, more: Parameters<typeof evidence>[0] = {}) => evidence({ home: homeHtml({ ld: [graphBlock(graph)] }), ...more })
/** The artist's node with `over` changed, the rest of the healthy card kept. */
const withArtist = (over: Record<string, unknown>, more: Parameters<typeof evidence>[0] = {}) => withGraph([artistNode(over), ...healthyGraph().slice(1)], more)

describe('the profiles Tapir published pass', () => {
  // The one exact-wording check: all 4 profiles listed (tracking and slashes ignored); the limits say we don't open each profile.
  it('passes when the card lists exactly Tapir’s profiles', () => {
    const r = p(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('4 of 4')
    expect(r.sentence).toBe('Your fact card lists all 4 of your profiles.')
    expect(r.limits).toMatch(/open/i)
    expectPlainWords(r)
  })

  // CRITICAL: the bridge writes the Spotify profile from the artist id alone; it is Tapir's, never "not in Tapir".
  it('counts the Spotify profile the site adds from the artist id as Tapir’s', () => {
    const k = known({}, { links: known().published!.links.filter((l) => l.url !== PROFILES[0]), spotifyArtistId: '26KxuQlgIw8VP8YX2IkMWR' })
    const r = p(evidence({ known: k }))
    expect(r.status).toBe('pass')
    expect(r.value).toBe('4 of 4')
    expect(rowOf(r, 'not in Tapir')).toBeUndefined()
  })

  // One profile written as a single string is read.
  it('reads a single sameAs string', () => {
    const k = known({}, { links: [{ label: 'Spotify', url: PROFILES[0], onSite: true }] })
    expect(p(withArtist({ sameAs: PROFILES[0] }, { known: k })).status).toBe('pass')
  })

  // Profiles written as {"@id": url} are read. (verify-found PR4)
  it('reads sameAs written as {"@id": url}', () => {
    expect(p(withGraph([artistNode({ sameAs: PROFILES.map((u) => ({ '@id': u })) })])).status).toBe('pass')
  })
})

describe('a missing, extra or wrong profile fails', () => {
  // A profile Tapir has that the card is missing fails, and the details name it as Tapir's.
  it('fails a profile Tapir has that the card is missing', () => {
    const k = known({}, { links: [...known().published!.links, { label: 'Bandcamp', url: 'https://skeen.bandcamp.com/', onSite: false }] })
    const r = p(evidence({ known: k }))
    expect(r.status).toBe('fail')
    expect(r.value).toBe('4 of 5')
    expect(rowOf(r, 'in Tapir: not on your site')).toMatch(/skeen\.bandcamp\.com/)
    expectPlainWords(r)
  })

  // A Spotify profile Tapir has only from the id, missing from the card, is named too.
  it('names a Spotify profile from the id that the card is missing', () => {
    const r = p(evidence({ known: known({}, { spotifyArtistId: 'Zq0Other0Id' }) }))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'in Tapir: not on your site')).toMatch(/open\.spotify\.com\/artist\/Zq0Other0Id/)
  })

  // A profile on the card that Tapir doesn't have fails, and is named.
  it('fails a profile on the card that Tapir does not have', () => {
    const r = p(withArtist({ sameAs: [...PROFILES, 'https://www.tiktok.com/@skeen200'] }))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'not in Tapir')).toMatch(/tiktok\.com\/@skeen200/)
  })

  // A playlist is not a profile page: it doesn't say which account is the artist's.
  it('fails a link on the card that is not a profile page', () => {
    const r = p(withArtist({ sameAs: [...PROFILES, 'https://open.spotify.com/playlist/37i9dQZF1DX'] }))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'not a profile page')).toMatch(/playlist/)
  })

  // The same profile twice, however it is spelled (no www, a tracking query), fails.
  it('fails the same profile listed twice', () => {
    const r = p(withArtist({ sameAs: [...PROFILES, 'https://instagram.com/skeeeeeeen?utm_source=ig'] }))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'listed twice')).toMatch(/instagram\.com\/skeeeeeeen/)
  })
})

describe('no profiles, or not your card', () => {
  // No profiles anywhere: a fail pointing to Connections.
  it('fails with no profiles at all, pointing to Connections', () => {
    const r = p(withArtist({ sameAs: undefined }, { known: known({}, { links: [] }) }))
    expect(r.status).toBe('fail')
    expect(r.action).toEqual(expect.objectContaining({ target: 'connections' }))
  })

  // Links in Tapir, but none of them a profile (a playlist): the sentence says so, not "you haven't connected any". (verify-found PR3)
  it('says when none of the links is a profile', () => {
    const k = known({}, { links: [{ label: null, url: 'https://open.spotify.com/playlist/abc', onSite: true }], spotifyArtistId: null })
    expect(p(withGraph([artistNode({ sameAs: undefined })], { known: k })).sentence).toMatch(/none of your links is a profile/)
  })

  // A card with no artist in it, while Tapir has profiles, fails.
  it('fails when the card has no artist but Tapir has profiles', () => {
    expect(p(evidence({ home: homeHtml({ ld: [] }) })).status).toBe('fail')
  })

  // Another band's profiles are not yours. (verify-found PR2)
  it('does not count another band’s profiles as yours', () => {
    const other = evidence({ home: homeHtml({ ld: [ldScript({ '@context': 'https://schema.org', '@type': 'MusicGroup', name: 'Other Band', sameAs: PROFILES })] }) })
    expect(p(other).status).not.toBe('pass')
  })
})
