/**
 * Proves the "Where you're based is clear" test passes only when the artist's node in the fact
 * card gives a city, a state or region and a country as separate facts, matching Tapir's.
 *
 * Code:     src/lib/seo-tests/who.ts (`place`), with src/lib/seo-tests/apple-storefront.ts
 *           (`countryCode`: is it a real country)
 * Feature:  SEO test `place` · Test tab "Says who you are"
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads untrusted JSON-LD from the live site and
 *           compares it with what Tapir published.
 * Covers:   • city + region + country passes, for a band (foundingLocation) or a person
 *             (homeLocation), with the country as a code or an object
 *           • a city only, a missing region or country, one line ("Chicago, IL"), a bare
 *             string, blanks: each fails, softly when it is only partly there
 *           • a place that differs from Tapir's, or a country nobody knows, fails
 *           • the advice follows Tapir: "publish" when Tapir has the part, "add" when not
 * Not here: an unreachable home page, or a card cut at the read cap (../honesty.test.ts).
 * Fixtures: tests/helpers/seo/page-fixture.ts (a healthy site in Chicago, IL, US); `withPlace` swaps the
 *           artist's place. Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import { WHO_TESTS } from '@/lib/seo-tests/who'
import { artistNode, evidence, expectPlainWords, graphBlock, homeHtml, known, rowOf } from '@tests/helpers/seo/page-fixture'

const p = WHO_TESTS.place
/** The artist's node with its place set to `loc` (a band's foundingLocation, a person's homeLocation). */
const withPlace = (loc: unknown, type = 'MusicGroup', more: Parameters<typeof evidence>[0] = {}) =>
  evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ '@type': type, foundingLocation: undefined, [type === 'Person' ? 'homeLocation' : 'foundingLocation']: loc })])] }), ...more })

describe('a city, region and country pass', () => {
  // The one exact-wording check: the pass sentence names all three parts.
  it('passes city + region + country', () => {
    const r = p(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('Chicago, IL, US')
    expect(r.sentence).toBe('Your site says you’re based in Chicago, IL, US.')
    expectPlainWords(r)
  })

  // A person's homeLocation is read like a band's foundingLocation, and a Country object counts as a country.
  it('passes a person’s homeLocation with a Country object', () => {
    const oslo = known({}, { location: 'Oslo', region: 'Oslo', country: 'Norway', countryCode: 'NO' })
    const r = p(withPlace({ '@type': 'Place', address: { addressLocality: 'Oslo', addressRegion: 'Oslo', addressCountry: { '@type': 'Country', name: 'Norway' } } }, 'Person', { known: oslo }))
    expect(r.status).toBe('pass')
  })
})

describe('a place missing a part fails', () => {
  // CRITICAL: a city only (the shape skeen ships today) is a soft fail; Tapir HAS the region and country, so the advice is publish, not "add", and the details show Tapir's place.
  it('fails a city only softly, advising publish when Tapir has the rest', () => {
    const r = p(withPlace({ '@type': 'Place', name: 'Chicago' }))
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
    expect(r.value).toBe('city only')
    expect(r.action).toEqual(expect.objectContaining({ target: 'facts' }))
    expect(r.todo).toMatch(/published in Tapir/)
    expect(r.todo).not.toMatch(/^Add/)
    expect(rowOf(r, 'in Tapir: place')).toBe('city Chicago, IL · region IL · country United States')
    expectPlainWords(r)
  })

  // When Tapir has no region or country either, the advice is to add them on the Facts tab.
  it('advises adding the region and country when Tapir has neither', () => {
    const r = p(withPlace({ '@type': 'Place', name: 'Chicago' }, 'MusicGroup', { known: known({}, { region: null, country: null, countryCode: null }) }))
    expect(r.todo).toMatch(/^Add the state or region and the country on the Facts tab/)
    expect(rowOf(r, 'in Tapir: place')).toBe('city Chicago, IL · region not set · country not set')
  })

  // "Chicago, IL" in one line is not a region: search engines want separate facts, and the result says "one line", never "has Chicago, IL but not the state". (verify-found P1)
  it('fails a one-line place without reading a region out of it', () => {
    const r = p(withPlace({ '@type': 'Place', name: 'Chicago, IL' }))
    expect(r.status).toBe('fail')
    expect(r.value).toBe('one line')
    expect(rowOf(r, 'state or region')).toBe('missing')
  })

  // City + country with no region fails, and the details say the region is missing.
  it('fails city + country with no region', () => {
    const r = p(withPlace({ '@type': 'Place', address: { addressLocality: 'Chicago', addressCountry: 'US' } }))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'state or region')).toBe('missing')
  })

  // City + region with no country fails, and the details say the country is missing.
  it('fails city + region with no country', () => {
    const r = p(withPlace({ '@type': 'Place', address: { addressLocality: 'Chicago', addressRegion: 'IL' } }))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'country')).toBe('missing')
  })

  // A bare string is not a place with parts; no place at all is a hard fail.
  it('fails a place given as a bare string, and no place at all', () => {
    expect(p(withPlace('Chicago')).status).toBe('fail')
    const r = p(withPlace(undefined))
    expect(r.status).toBe('fail')
    expect(r.lead).toBeUndefined()
  })

  // A region of spaces is missing, not a region.
  it('fails blank strings as missing', () => {
    expect(p(withPlace({ '@type': 'Place', address: { addressLocality: 'Chicago', addressRegion: '  ', addressCountry: 'US' } })).status).toBe('fail')
  })
})

describe('a place that isn’t yours, or isn’t real, fails', () => {
  // Austin when Tapir says Chicago is stale or wrong; "Earth" and "n/a" are not a real country or region. (verify-found P2)
  it('fails a place that differs from Tapir’s, or a country nobody knows', () => {
    expect(p(withPlace({ '@type': 'Place', address: { addressLocality: 'Austin', addressRegion: 'Texas', addressCountry: 'US' } })).status).toBe('fail')
    expect(p(withPlace({ '@type': 'Place', address: { addressLocality: 'Chicago', addressRegion: 'n/a', addressCountry: 'Earth' } })).status).toBe('fail')
  })
})
