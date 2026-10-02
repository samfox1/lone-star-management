/**
 * How the Facts tab reads the stored facts back: the page says exactly what the live site's fact
 * card states, and flags any stored value the save gate would refuse today.
 *
 * Code:     src/lib/seo-facts.ts (readFacts, factErrors)
 * Feature:  SEO / GEO page · Facts tab; the facts the `place`, `genre` and `card` tests check
 * Tier:     STRICT (AGENTS.md "Test depth"): the page must never say a fact is on the card when
 *           the site would drop it.
 * Covers:   • readFacts: the city, region, country (with its code), other names and the year;
 *             nothing set; the city alone; a visual artist's year kept but not stated
 *           • for every combination of type, city and stored facts (clean and broken), the page's
 *             place, other names and "year stated" match what the bridge's jsonLdGraph puts on the card
 *           • factErrors: none for clean facts; each bad value named by its field; an artist with
 *             no name yet; a name taken after a rename; a region judged against the stored
 *             country; a city over its cap
 * Not here: the save rules themselves (save-rules.test.ts); drawing the tab
 *           (tests/components/manager-tools/seo/facts-tab.test.tsx).
 * Fixtures: made-up stored facts and artist rows; the combination test builds a public-site
 *           payload for each (tests/helpers/site-data.ts) and asks the real bridge
 *           (`jsonLdGraph`) what it states.
 */
import { describe, expect, it } from 'vitest'
import { FACT_CONTENT_KEYS, MAX_PLACE_PART_LENGTH, jsonLdGraph } from '@samfox1/site-bridge/seo'
import { CITY_MAX_LENGTH, COUNTRY_NOT_LISTED, factErrors, readFacts } from '@/lib/seo-facts'
import { sitePayload } from '@tests/helpers/site-data'

const K = FACT_CONTENT_KEYS

describe('the facts as the page shows them (readFacts)', () => {
  const artist = { name: 'Skeen', location: 'Chicago', schema_type: 'MusicGroup' }

  // A full set of facts reads back as stored, with the place joined and the country's code.
  it('Skeen, Chicago / Illinois / United States', () => {
    const f = readFacts({ [K.region]: 'Illinois', [K.country]: 'United States', [K.aliases]: 'DJ Skeen', [K.activeSince]: '2014', seo_title: 'x' }, artist)
    expect(f).toEqual({
      city: 'Chicago',
      region: 'Illinois',
      country: 'United States',
      countryCode: 'US',
      aliases: ['DJ Skeen'],
      activeSince: '2014',
      place: 'Chicago, Illinois, United States',
      activeSinceStated: true,
    })
  })
  // Nothing set reads as empty, never as made-up values.
  it('nothing set', () => {
    expect(readFacts({}, { name: 'Skeen', location: null })).toEqual({ city: '', region: '', country: '', countryCode: null, aliases: [], activeSince: null, place: '', activeSinceStated: false })
  })
  // The city alone is the place.
  it('city only: the place is the city', () => {
    expect(readFacts({}, artist).place).toBe('Chicago')
  })
  // A visual artist keeps the year on the page, but it is not stated on the card.
  it('a Person keeps the year on the page, but it is not stated on the card', () => {
    const f = readFacts({ [K.activeSince]: '2014' }, { ...artist, schema_type: 'Person' })
    expect(f.activeSince).toBe('2014')
    expect(f.activeSinceStated).toBe(false)
  })
  // Null values from the table read as unset.
  it('null values from the table read as unset', () => {
    expect(readFacts({ [K.region]: null, [K.aliases]: undefined }, artist)).toMatchObject({ region: '', aliases: [] })
  })

  // The page says what the site states: for every combination, the same place, names and year as the bridge's fact card.
  it('CRITICAL: the page says what the site states, for every combination', () => {
    const contents: Record<string, string>[] = [
      {},
      { [K.region]: 'Illinois' },
      { [K.country]: 'usa' },
      { [K.region]: 'Illinois', [K.country]: 'Narnia', [K.aliases]: 'DJ Skeen\nskeen\nSKN', [K.activeSince]: '2014' },
      { [K.region]: 'r'.repeat(500), [K.activeSince]: '1850', [K.aliases]: 'x'.repeat(61) },
    ]
    for (const schema_type of ['MusicGroup', 'Person'] as const) {
      for (const location of ['Chicago', null]) {
        for (const content of contents) {
          const view = readFacts(content, { name: 'Skeen', location, schema_type })
          const p = sitePayload({ artist: { location, schema_type }, site_content: content })
          const node = jsonLdGraph(p, { origin: 'https://x.example' })['@graph'][0] as Record<string, unknown>
          const place = (node.foundingLocation ?? node.homeLocation) as { name: string } | undefined
          const where = JSON.stringify({ schema_type, location, content })
          expect(view.place, where).toBe(place?.name ?? '')
          const alt = node.alternateName
          expect(view.aliases, where).toEqual(alt === undefined ? [] : Array.isArray(alt) ? alt : [alt])
          expect(view.activeSinceStated, where).toBe(node.foundingDate !== undefined)
          if (view.activeSinceStated) expect(node.foundingDate, where).toBe(view.activeSince)
        }
      }
    }
  })
})

describe('what is stored that the gate would refuse today (factErrors)', () => {
  const artist = { name: 'Skeen', location: 'Chicago' }
  // Clean facts flag nothing (strictly: no field present at all).
  it('clean facts: none (strictly: no field present, not even as undefined)', () => {
    expect(factErrors({ [K.region]: 'Illinois', [K.country]: 'United States', [K.aliases]: 'DJ Skeen', [K.activeSince]: '2014' }, artist, 2026)).toStrictEqual({})
    expect(factErrors({}, { name: 'Skeen', location: null }, 2026)).toStrictEqual({})
    expect(factErrors({ [K.region]: '   ' }, artist, 2026)).toStrictEqual({})
  })
  // Each bad stored value is named by its field, in the gate's words.
  it('each bad value is named by its field', () => {
    expect(
      factErrors({ [K.region]: '<b>IL</b>', [K.country]: 'x'.repeat(61), [K.aliases]: 'skeen', [K.activeSince]: '2031' }, { name: 'Skeen', location: `Chicago\u0000` }, 2026),
    ).toEqual({
      city: 'That has hidden characters in it. Type it again.',
      region: 'Leave out < and >.',
      country: `Keep it under ${MAX_PLACE_PART_LENGTH} characters.`,
      aliases: '"skeen" is the artist\'s name already.',
      activeSince: 'Use a year from 1900 to 2026.',
    })
  })
  // An artist with no name yet: other names are checked for everything but the name.
  it('an artist with no name yet: aliases are checked for everything but the name', () => {
    expect(factErrors({ [K.aliases]: 'DJ Skeen' }, { name: null, location: null }, 2026)).toStrictEqual({})
    expect(factErrors({ [K.aliases]: 'a\nA' }, { name: null, location: null }, 2026)).toEqual({ aliases: '"A" is listed twice.' })
  })
  // A name taken by a rename is flagged (the card already drops it).
  it('an alias that became the name after a rename is flagged (the card already drops it)', () => {
    expect(factErrors({ [K.aliases]: 'DJ Skeen' }, { name: 'DJ Skeen', location: null }, 2026)).toEqual({ aliases: '"DJ Skeen" is the artist\'s name already.' })
  })
  // A stored region is judged against the stored country; a country off the list is flagged.
  it('a stored region is judged against the stored country; a country off the list is flagged', () => {
    expect(factErrors({ [K.region]: 'IL', [K.country]: 'United States' }, artist, 2026)).toEqual({ region: 'Pick a state from the list.' })
    expect(factErrors({ [K.region]: 'IL', [K.country]: 'Germany' }, artist, 2026)).toStrictEqual({})
    expect(factErrors({ [K.country]: 'Narnia' }, artist, 2026)).toEqual({ country: COUNTRY_NOT_LISTED })
  })
  // A city over its cap is flagged.
  it(`a city over ${CITY_MAX_LENGTH} characters is flagged`, () => {
    expect(factErrors({}, { name: 'S', location: 'x'.repeat(CITY_MAX_LENGTH + 1) }, 2026)).toEqual({ city: `Keep it under ${CITY_MAX_LENGTH} characters.` })
    expect(factErrors({}, { name: 'S', location: 'x'.repeat(CITY_MAX_LENGTH) }, 2026)).toStrictEqual({})
  })
})
