/**
 * Proves the "Your genre is named" test reads the genre from the artist's OWN node in the
 * fact card, passes only when it is a real style matching Tapir's, and doesn't apply to a
 * visual artist.
 *
 * Code:     src/lib/seo-tests/who.ts (`genre`), finding the artist's node with
 *           src/lib/seo-tests/match.ts (`ownArtistNode`)
 * Feature:  SEO test `genre` · Test tab "Says who you are"
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads untrusted JSON-LD from the live site and
 *           compares it with what Tapir published.
 * Covers:   • a style on the artist's node passes, as a list or one string, in any card shape
 *           • no genre, a placeholder ("N/A", a link), or a different one from Tapir's fails,
 *             with the right advice (publish vs add)
 *           • only the artist's own node counts: never a support act, never another band's card
 *           • `na` for an artist published as a visual artist, whatever the card says; a
 *             Person card for a musician is the card's fault; unknown with nothing published
 * Not here: an unreachable home page, or a card cut at the read cap (../honesty.test.ts).
 * Fixtures: _page-fixture.ts (a healthy site; each case swaps the fact card). Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import { WHO_TESTS } from '@/lib/seo-tests/who'
import { ORIGIN, artistNode, evidence, expectPlainWords, graphBlock, healthyGraph, homeHtml, known, ldScript, rowOf } from '@tests/unit/seo-tests/_page-fixture'

const g = WHO_TESTS.genre
const withArtist = (over: Record<string, unknown>, more: Parameters<typeof evidence>[0] = {}) => evidence({ home: homeHtml({ ld: [graphBlock([artistNode(over)])] }), ...more })
/** A card about another band only. */
const otherBand = (over: Record<string, unknown>) => evidence({ home: homeHtml({ ld: [ldScript({ '@context': 'https://schema.org', '@type': 'MusicGroup', name: 'Other Band', ...over })] }) })

describe('a genre on your own node passes', () => {
  // The one exact-wording check: the pass sentence names the styles found.
  it('passes the healthy card’s two styles', () => {
    const r = g(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('House, Tech House')
    expect(r.sentence).toBe('Your site says your genre is House and Tech House.')
    expectPlainWords(r)
  })

  // One genre written as a single string is still a genre.
  it('passes a single string genre', () => {
    expect(g(withArtist({ genre: 'Techno' }, { known: known({}, { genre: 'Techno' }) })).status).toBe('pass')
  })

  // A card can be written three ways (a list of nodes, one node, or @graph): each is read.
  it('reads the card as a list, as one node, or as @graph', () => {
    const node = { '@context': 'https://schema.org', ...artistNode() }
    expect(g(evidence({ home: homeHtml({ ld: [ldScript([node])] }) })).status).toBe('pass')
    expect(g(evidence({ home: homeHtml({ ld: [ldScript(node)] }) })).status).toBe('pass')
    expect(g(evidence({ home: homeHtml({ ld: [ldScript({ '@context': 'https://schema.org', '@graph': node })] }) })).status).toBe('pass')
  })

  // The artist can be in the second of several blocks.
  it('finds the artist in the second block', () => {
    const html = homeHtml({ ld: [ldScript({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'x', url: ORIGIN }), graphBlock(healthyGraph())] })
    expect(g(evidence({ home: html })).status).toBe('pass')
  })

  // A card under another name that carries the artist's own site address is the artist's. (verify-found G1)
  it('reads a card with the artist’s own address as the artist', () => {
    expect(g(otherBand({ genre: 'House', url: `${ORIGIN}/` })).status).toBe('pass')
  })
})

describe('a missing or wrong genre fails', () => {
  // No genre while Tapir has one: the advice is "publish", pointing to the Facts tab.
  it('fails with no genre, advising publish when Tapir has one', () => {
    const r = g(withArtist({ genre: undefined }))
    expect(r.status).toBe('fail')
    expect(r.todo).toMatch(/publish/i)
    expect(r.action).toEqual(expect.objectContaining({ target: 'facts' }))
    expectPlainWords(r)
  })

  // No genre and none in Tapir: the advice is "add it".
  it('fails with no genre, advising add when Tapir has none', () => {
    const r = g(withArtist({ genre: [] }, { known: known({}, { genre: null }) }))
    expect(r.status).toBe('fail')
    expect(r.todo).toMatch(/add/i)
  })

  // The details name the sound Tapir has, labelled as Tapir's, when the card has none.
  it('names the sound Tapir has, as Tapir’s', () => {
    expect(rowOf(g(withArtist({ genre: undefined })), 'in Tapir: genre')).toBe('House, Tech House')
  })

  // No fact card, or one that doesn't parse, names no genre.
  it('fails when there is no fact card, or it cannot be read', () => {
    expect(g(evidence({ home: homeHtml({ ld: [] }) })).status).toBe('fail')
    expect(g(evidence({ home: homeHtml({ ld: ['<script type="application/ld+json">{"@graph": [</script>'] }) })).status).toBe('fail')
  })

  // The card's sound must be Tapir's: "Country" on the card when Tapir says House fails, quoting Tapir's. (verify-found G2)
  it('fails a genre that is not the one in Tapir', () => {
    const r = g(withArtist({ genre: 'Country' }))
    expect(r.status).toBe('fail')
    expect(rowOf(r, /in Tapir/)).toMatch(/House/)
  })

  // Placeholders and links fill the field without naming a sound. Tapir has no genre here, so nothing but this rule can fail them. (verify-found G3)
  it.each(['N/A', 'unknown', 'none', '-', 'https://en.wikipedia.org/wiki/House_music'])('fails "%s" as not a sound', (genre) => {
    const r = g(withArtist({ genre }, { known: known({}, { genre: null }) }))
    expect(r.status).toBe('fail')
    expect(r.value).toBe('not named')
  })
})

describe('only your own node counts', () => {
  // A support act nested in a show is not the artist: its "Rock" must not stand in for the artist's missing genre.
  it('never reads a support act as the artist', () => {
    const graph = healthyGraph()
    graph[0] = artistNode({ genre: undefined })
    ;(graph[2].performer as Record<string, unknown>[])[1] = { '@type': 'MusicGroup', name: 'Support', genre: 'Rock' }
    expect(g(evidence({ home: homeHtml({ ld: [graphBlock(graph)] }) })).status).toBe('fail')
  })

  // A card about another band is not yours, and the sentence names whose it is. (verify-found G1)
  it('does not read another band’s card as yours', () => {
    const r = g(otherBand({ genre: 'Polka' }))
    expect(r.status).not.toBe('pass')
    expect(r.sentence).toMatch(/Other Band/)
  })
})

describe('what kind of artist you are', () => {
  // CRITICAL: a visual artist has no music style, so the test does not apply (`na`), whatever the card says, and even when no page could be read.
  it('does not apply to an artist published as a visual artist', () => {
    const person = known({}, { artistType: 'Person', genre: null })
    const r = g(withArtist({ '@type': 'Person', genre: undefined }, { known: person }))
    expect(r.status).toBe('na')
    expect(r.sentence).toMatch(/visual artist/)
    expect(r.action).toBeUndefined()
    expect(g(evidence({ pages: [], known: person })).status).toBe('na')
    expect(g(evidence({ known: person })).status).toBe('na')
  })

  // A card that calls a musician a person has no place for a style: the card is wrong, and the details show both sides.
  it('fails a Person card for someone Tapir has as a musician', () => {
    const r = g(withArtist({ '@type': 'Person', genre: undefined }))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'in Tapir: artist type')).toBe('Musician')
    expect(rowOf(r, 'artist type')).toBe('Person')
    expectPlainWords(r)
  })

  // A Person card with nothing published: we can't tell which kind of artist this is, so "couldn't check", with limits saying why.
  it('is unknown for a Person card when nothing is published', () => {
    const r = g(withArtist({ '@type': 'Person', genre: undefined }, { known: known({ published: null }) }))
    expect(r.status).toBe('unknown')
    expect(r.limits).toBeTruthy()
  })
})
