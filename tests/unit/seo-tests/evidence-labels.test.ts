// Honesty rule 3, swept over all 24 tests: a "Show the details" row that states what TAPIR holds says so ("in Tapir: …"); a row about the site never does.
/**
 * types.ts honesty rule 3: `evidence` is what the run really observed. A row that states what
 * TAPIR holds (for a comparison) is labelled as Tapir's, never passed off as the site's.
 *
 * Not a hand-list of labels (those drift, AGENTS.md rule 4): every test in all four groups runs
 * on one site where Tapir and the site each hold values the other does not, spelled as MARKERS
 * that appear nowhere else. Then, for every evidence row of every result:
 *   • a row whose value carries a Tapir-only marker must be labelled "in Tapir: …";
 *   • a row labelled "in Tapir: …" must not carry a site-only marker.
 * A new row that quotes Tapir without the label fails here, whichever file it is in.
 */
import { describe, expect, it } from 'vitest'
import { FACTS_TESTS } from '@/lib/seo-tests/facts'
import { FOUND_TESTS } from '@/lib/seo-tests/found'
import { SHARED_TESTS } from '@/lib/seo-tests/shared'
import { WHO_TESTS } from '@/lib/seo-tests/who'
import { SEO_TEST_IDS, type SeoTest, type SeoTestId } from '@/lib/seo-tests/types'
import { ORIGIN, PROFILES, artistNode, evidence, graphBlock, healthyGraph, homeHtml, known } from './_page-fixture'

const TESTS: Record<SeoTestId, SeoTest> = { ...FOUND_TESTS, ...WHO_TESTS, ...SHARED_TESTS, ...FACTS_TESTS }

/** Only Tapir holds these. */
const TAPIR = ['Zqtapirrelease', 'zqtapirprofile', 'Zqtapirvenue', 'Zqtapirtitle', 'Zqtapirgenre', 'Zqtapirregion', 'Iceland', 'Zqtapirbio']
/** Only the site holds these. */
const SITE = ['Zqsiterelease', 'zqsiteprofile', 'Zqsitevenue', 'Zqsitetitle']

function mismatched() {
  const graph = healthyGraph()
  graph[0] = artistNode({
    genre: undefined, // so `genre` fails and names the sound Tapir has
    description: undefined,
    foundingLocation: { '@type': 'Place', name: 'Chicago', address: { '@type': 'PostalAddress', addressLocality: 'Chicago' } },
    sameAs: [...PROFILES, 'https://www.instagram.com/zqsiteprofile/'],
  })
  graph.push({ '@type': 'MusicAlbum', name: 'Zqsiterelease', byArtist: { '@id': `${ORIGIN}/#artist` }, datePublished: '2026-03-01' })
  graph.push({ '@type': 'MusicEvent', name: 'Skeen at Zqsitevenue, Chicago', startDate: '2026-11-20', location: { '@type': 'Place', name: 'Zqsitevenue', address: { '@type': 'PostalAddress', addressLocality: 'Chicago' } } })
  const base = known().published!
  return evidence({
    home: homeHtml({
      title: 'Zqsitetitle · Skeen',
      ld: [graphBlock(graph)],
      body: '<a href="https://music.apple.com/no/artist/skeen/1754431714">Apple Music</a>',
    }),
    known: known({}, {
      bio: 'Zqtapirbio is a sentence long enough to be looked for on the page.',
      genre: 'Zqtapirgenre',
      seoTitle: 'Zqtapirtitle',
      region: 'Zqtapirregion',
      country: 'Iceland',
      countryCode: 'IS',
      links: [...base.links, { label: 'Instagram 2', url: 'https://www.instagram.com/zqtapirprofile/', onSite: false }],
      tourDates: [...base.tourDates, { date: '2026-11-01', venue: 'Zqtapirvenue', city: 'Zqtapircity', isPast: false }],
      releases: [...base.releases, { title: 'Zqtapirrelease', releasedOn: '2026-06-01' }],
    }),
  })
}

const has = (text: string, markers: string[]) => markers.filter((m) => text.toLowerCase().includes(m.toLowerCase()))

describe('honesty rule 3: whose value a "Show the details" row states', () => {
  const e = mismatched()
  const results = SEO_TEST_IDS.map((id) => TESTS[id](e))

  it('the scenario really puts Tapir-only values in front of the tests (so the sweep is not vacuous)', () => {
    const quoted = results.flatMap((r) => r.evidence).filter((row) => has(row.value, TAPIR).length)
    const ids = new Set(results.filter((r) => r.evidence.some((row) => has(row.value, TAPIR).length)).map((r) => r.id))
    expect(quoted.length).toBeGreaterThanOrEqual(8)
    for (const id of ['title', 'genre', 'place', 'profiles', 'apple', 'shows', 'releases', 'words'] as SeoTestId[]) expect(ids, id).toContain(id)
  })

  it('CRITICAL: every row quoting a value only Tapir holds is labelled "in Tapir: …"', () => {
    const bad = results.flatMap((r) => r.evidence.filter((row) => has(row.value, TAPIR).length && !/^in Tapir: /.test(row.label)).map((row) => `${r.id} · ${row.label}: ${row.value}`))
    expect(bad).toEqual([])
  })

  it('CRITICAL: no row labelled "in Tapir" quotes a value only the site holds', () => {
    const bad = results.flatMap((r) => r.evidence.filter((row) => /^in Tapir/.test(row.label) && has(row.value, SITE).length).map((row) => `${r.id} · ${row.label}: ${row.value}`))
    expect(bad).toEqual([])
  })
})
