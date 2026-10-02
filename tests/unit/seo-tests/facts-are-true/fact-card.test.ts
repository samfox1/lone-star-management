/**
 * Proves the "Search engines can read your fact card" test passes only when every fact-card
 * block on every page read parses, says it uses schema.org, is not empty, and each node has
 * the fields its type needs, of the right kind.
 *
 * Code:     src/lib/seo-tests/facts.ts (`card`), reading blocks with src/lib/seo-tests/html.ts
 *           (`parsePage`, `ldNodes`, `typesOf`)
 * Feature:  SEO test `card` · Test tab "Facts are true"
 * Tier:     STRICT (AGENTS.md "Test depth"): it validates untrusted JSON-LD from the live site;
 *           a broken card means search engines guess about the artist.
 * Covers:   • a healthy card passes, and the details list each page's types
 *           • a block that doesn't parse (saying which page), an empty card, no card or no
 *             artist fails
 *           • a missing required field (album without byArtist, show place without address,
 *             song without name), a value of the wrong kind, or a bad date fails, named
 *           • a block without a real schema.org context fails; an unknown type is named, not failed
 *           • every page read is checked; a block broken only by the read cap is "couldn't check"
 * Not here: whether the facts in the card are TRUE (profiles, shows, releases, genre, place
 *           each have their own file); an unreachable home page (../honesty.test.ts).
 * Fixtures: tests/helpers/seo/page-fixture.ts (a healthy card: artist, website, one show, three albums);
 *           `graphWith` swaps or removes one node. Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import { FACTS_TESTS } from '@/lib/seo-tests/facts'
import { artistNode, evidence, expectPlainWords, graphBlock, healthyGraph, homeHtml, ldScript, page, rowOf, type Graph } from '@tests/helpers/seo/page-fixture'

const c = FACTS_TESTS.card
const withGraph = (graph: Graph) => evidence({ home: homeHtml({ ld: [graphBlock(graph)] }) })
/** The healthy card with node `i` replaced by `node`, or removed when `node` is null. */
const graphWith = (i: number, node: Record<string, unknown> | null): Graph => {
  const g = healthyGraph()
  if (node === null) g.splice(i, 1)
  else g[i] = node
  return g
}

describe('a card that reads passes', () => {
  // The one exact-wording check: no errors, and the details list the types found on the home page.
  it('passes when every block parses and has what each type needs', () => {
    const out = c(evidence())
    expect(out.status).toBe('pass')
    expect(out.sentence).toBe('Search engines can read your fact card with no errors.')
    expect(rowOf(out, '/')).toMatch(/MusicGroup · WebSite · MusicEvent · 3 MusicAlbum/)
    expectPlainWords(out)
  })

  // A card written as a top-level list of nodes (each with a context), or @graph as one object with an @vocab context, reads.
  it('reads a top-level list, and @graph as one object', () => {
    const ctx = (n: Record<string, unknown>) => ({ '@context': 'https://schema.org', ...n })
    expect(c(evidence({ home: homeHtml({ ld: [ldScript(healthyGraph().map(ctx))] }) })).status).toBe('pass')
    expect(c(evidence({ home: homeHtml({ ld: [ldScript({ '@context': { '@vocab': 'https://schema.org/' }, '@graph': artistNode() })] }) })).status).toBe('pass')
  })

  // A type we don't know ("MusicAlbun", a typo) is named in the details, since nobody reads it. (verify-found C2)
  it('names a type we don’t know in the details', () => {
    expect(rowOf(c(withGraph([...healthyGraph(), { '@type': 'MusicAlbun', name: 'x' }])), /types we don’t know/)).toMatch(/MusicAlbun/)
  })
})

describe('a broken, empty or missing card fails', () => {
  // A block that doesn't parse fails, and the details say which page and which block.
  it('fails a block that does not parse, saying which page', () => {
    const out = c(evidence({ home: homeHtml({ ld: [graphBlock(healthyGraph()), '<script type="application/ld+json">{"@context":"https://schema.org",</script>'] }) }))
    expect(out.status).toBe('fail')
    expect(rowOf(out, 'problems')).toMatch(/\/: block 2 can’t be read/)
    expectPlainWords(out)
  })

  // An empty card (the bridge writes one for an artist with no name) or a blank block fails.
  it('fails an empty card', () => {
    expect(c(evidence({ home: homeHtml({ ld: [ldScript({ '@context': 'https://schema.org', '@graph': [] })] }) })).status).toBe('fail')
    expect(c(evidence({ home: homeHtml({ ld: ['<script type="application/ld+json">   </script>'] }) })).status).toBe('fail')
  })

  // A home page with no card, or a card with no artist in it, fails.
  it('fails a home page with no card, or no artist in it', () => {
    expect(c(evidence({ home: homeHtml({ ld: [] }) })).status).toBe('fail')
    expect(c(withGraph(graphWith(0, null))).status).toBe('fail')
  })

  // A block with no schema.org context, or one whose context only MENTIONS schema.org, is not read as schema.org. (verify-found C3)
  it('fails a block without a real schema.org context', () => {
    expect(c(evidence({ home: homeHtml({ ld: [ldScript({ '@graph': healthyGraph() })] }) })).status).toBe('fail')
    expect(c(evidence({ home: homeHtml({ ld: [ldScript({ '@context': 'https://example.com/not-schema.org-really', '@graph': healthyGraph() })] }) })).status).toBe('fail')
  })

  // Every page read is checked, not only the home page: a broken block on /about fails, naming /about.
  it('checks every page read', () => {
    const about = '<html><body><script type="application/ld+json">{"@context":"https://schema.org","@type":"MusicAlbum","name":"x"}</script></body></html>'
    const out = c(evidence({ about }))
    expect(out.status).toBe('fail')
    expect(rowOf(out, 'problems')).toMatch(/\/about/)
  })
})

describe('a node missing what its type needs fails', () => {
  // An album without byArtist, or an artist without url, is missing a required field, and the details name it.
  it('fails a node missing a field its type needs, naming it', () => {
    const out = c(withGraph(graphWith(3, { '@type': 'MusicAlbum', name: 'You Were There' })))
    expect(out.status).toBe('fail')
    expect(rowOf(out, 'problems')).toMatch(/MusicAlbum.*byArtist/)
    expect(c(withGraph(graphWith(0, artistNode({ url: undefined })))).status).toBe('fail')
  })

  // A show whose place has no address fails, and a song inside an album with no name is named by its position.
  it('fails a show place with no address, and a song with no name', () => {
    expect(c(withGraph(graphWith(2, { '@type': 'MusicEvent', name: 'x', startDate: '2026-10-15', location: { '@type': 'Place', name: 'Smartbar' } }))).status).toBe('fail')
    const album = { '@type': 'MusicAlbum', name: 'A', byArtist: { '@id': 'x' }, track: [{ '@type': 'MusicRecording', byArtist: { '@id': 'x' } }] }
    expect(rowOf(c(withGraph(graphWith(4, album))), 'problems')).toMatch(/track 1.*name/)
  })

  // Values of the wrong kind (a number for a name, "not a url" for a url, a US-style date) fail. (verify-found C1)
  it('fails values of the wrong kind', () => {
    expect(c(withGraph([artistNode({ name: 12345 }), ...healthyGraph().slice(1)])).status).toBe('fail')
    expect(c(withGraph([artistNode({ url: 'not a url' }), ...healthyGraph().slice(1)])).status).toBe('fail')
    const bad = healthyGraph()
    bad[2] = { ...bad[2], startDate: '08/01/2026' }
    expect(c(withGraph(bad)).status).toBe('fail')
  })

  // A plain Event with nothing in it is missing what every event needs. (verify-found C2)
  it('fails a plain Event with nothing in it', () => {
    expect(c(withGraph([...healthyGraph(), { '@type': 'Event' }])).status).toBe('fail')
  })
})

describe('a card cut at the read cap', () => {
  // The home page was cut at the read cap and its last block breaks at the cut: that is our limit, not the site's error, so "couldn't check".
  it('is unknown when the last block breaks at the cut', () => {
    const cut = homeHtml().replace(/("@type":"MusicAlbum","@id":"[^"]*release-3").*$/, '$1')
    expect(c(evidence({ pages: [page('/', cut, 200, { truncated: true })] })).status).toBe('unknown')
  })
})
