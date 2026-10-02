// The artist's extra facts on the fact card (bridge 0.43.0): aliases, active since, a full place.
/**
 * Bridge 0.43.0 — the facts that tell this artist from others with the same name
 * (AI_VISIBILITY_AUDIT.md §2 item 7, code pass F13). They ride `site_content` under the
 * `FACT_CONTENT_KEYS`; the CITY stays `artist.location` ("Based in").
 *
 * What the live site receives is STRICT (AGENTS.md "Test depth"): written red-first, and
 * the backwards-compatibility pin is a SAVED 0.42.0 output, not one recomputed by the code
 * under test (tests/helpers/seo-jsonld-cases.ts says how it was made).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PublicSitePayload } from '@samfox1/site-bridge/payload'
import {
  COUNTRIES,
  EARLIEST_ACTIVE_YEAR,
  FACT_CONTENT_KEYS,
  MAX_ALIASES,
  MAX_ALIAS_LENGTH,
  MAX_PLACE_PART_LENGTH,
  artistPlace,
  countryOf,
  factText,
  jsonLdGraph,
  jsonLdScript,
  parseAliases,
  siteFacts,
} from '@samfox1/site-bridge/seo'
import { CASE_ORIGIN, JSON_LD_CASES } from '@tests/helpers/seo-jsonld-cases'
import { sitePayload } from '@tests/helpers/site-data'

const K = FACT_CONTENT_KEYS
const ORIGIN = CASE_ORIGIN

const payload = (content: Record<string, string> = {}, artist: Partial<PublicSitePayload['artist']> = {}): PublicSitePayload =>
  sitePayload({ artist: { bio: 'Chicago DJ.', genre: 'House', location: 'Chicago', ...artist }, site_content: content })

const artistNode = (p: PublicSitePayload) => jsonLdGraph(p, { origin: ORIGIN })['@graph'][0] as Record<string, unknown>

describe('backwards compatible: no fact keys = exactly what 0.42.0 emitted', () => {
  const saved = JSON.parse(readFileSync(new URL('../../fixtures/seo-jsonld-0.42.json', import.meta.url), 'utf8')) as { bridge: string; cases: Record<string, string> }

  it('the fixture really is the 0.42.0 output, one entry per case', () => {
    expect(saved.bridge).toBe('0.42.0')
    expect(Object.keys(saved.cases).sort()).toEqual(JSON_LD_CASES.map((c) => c.name).sort())
  })

  for (const c of JSON_LD_CASES) {
    it(`byte for byte: ${c.name}`, () => {
      expect(jsonLdScript(jsonLdGraph(c.payload, c.opts))).toBe(saved.cases[c.name])
    })
  }
})

describe('the fact keys', () => {
  it('are four reserved site_content keys, all fact_*', () => {
    expect(K).toEqual({ region: 'fact_region', country: 'fact_country', aliases: 'fact_aliases', activeSince: 'fact_active_since' })
  })
})

describe('factText: one line of plain text, whatever arrives', () => {
  it('collapses whitespace and control characters to single spaces', () => {
    expect(factText('  Cook \n\t County\r\n')).toBe('Cook County')
    expect(factText('Ill\u0000inois')).toBe('Ill inois')
    expect(factText('a\u2028b\u2029c')).toBe('a b c')
  })
  it('strips invisible direction marks, zero-width spaces and a BOM, keeps ZWJ/ZWNJ', () => {
    expect(factText('\u200FSkeen\u200E')).toBe('Skeen')
    expect(factText('\u202Eneeks\u202C')).toBe('neeks')
    expect(factText('Sk\u200Been\uFEFF')).toBe('Skeen')
    expect(factText('\u2067x\u2069')).toBe('x')
    // An emoji family is joined by ZWJ; Persian spelling needs ZWNJ.
    expect(factText('👨\u200D👩\u200D👧')).toBe('👨\u200D👩\u200D👧')
    expect(factText('می\u200Cخواهم')).toBe('می\u200Cخواهم')
  })
  it('drops a lone surrogate (it cannot be stored or read back)', () => {
    expect(factText('a\uD800b')).toBe('ab')
    expect(factText('🎧')).toBe('🎧')
  })
  it('NFC, so two spellings of é are one', () => {
    expect(factText('Mexico City, Me\u0301xico')).toBe('Mexico City, M\u00E9xico')
  })
  it('anything that is not a string is empty', () => {
    for (const v of [null, undefined, 42, {}, ['x']]) expect(factText(v)).toBe('')
  })
})

describe('parseAliases', () => {
  it('one per line, trimmed, blank lines dropped', () => {
    expect(parseAliases('DJ Skeen\n\n  Skeen Music \r\nSKN')).toEqual(['DJ Skeen', 'Skeen Music', 'SKN'])
  })
  it('never the artist name, and no duplicates, compared case-insensitively and past hidden marks', () => {
    expect(parseAliases('SKEEN\nDJ Skeen\ndj skeen\n\u200FDJ Skeen', 'Skeen')).toEqual(['DJ Skeen'])
    expect(parseAliases(' skeen ', '  Skeen  ')).toEqual([])
  })
  it(`at most ${MAX_ALIASES}, each at most ${MAX_ALIAS_LENGTH} characters (an overlong one is dropped, never cut)`, () => {
    expect(parseAliases(Array.from({ length: 8 }, (_, i) => `n${i}`).join('\n'))).toEqual(['n0', 'n1', 'n2', 'n3', 'n4'])
    expect(parseAliases(`${'x'.repeat(MAX_ALIAS_LENGTH + 1)}\nok`)).toEqual(['ok'])
    expect(parseAliases('x'.repeat(MAX_ALIAS_LENGTH))).toEqual(['x'.repeat(MAX_ALIAS_LENGTH)])
    // Counted in characters, not UTF-16 units: 60 emoji are 60 characters.
    expect(parseAliases('🎧'.repeat(MAX_ALIAS_LENGTH))).toEqual(['🎧'.repeat(MAX_ALIAS_LENGTH)])
  })
  it('not a string = none', () => {
    expect(parseAliases(null)).toEqual([])
    expect(parseAliases(['DJ Skeen'])).toEqual([])
  })
})

describe('countryOf: a small ISO 3166-1 table', () => {
  it('United States, USA, US, U.S.A. and friends are all US', () => {
    for (const s of ['United States', 'USA', 'US', 'us', 'U.S.', 'U.S.A.', '  united   states ', 'United States of America', 'The United States']) {
      expect(countryOf(s), s).toEqual({ code: 'US', name: 'United States' })
    }
  })
  it('names, codes and accents all resolve', () => {
    expect(countryOf('UK')).toEqual({ code: 'GB', name: 'United Kingdom' })
    expect(countryOf('gb')?.code).toBe('GB')
    expect(countryOf('Mexico')?.code).toBe('MX')
    expect(countryOf('México')?.code).toBe('MX')
    expect(countryOf('Deutschland')).toEqual({ code: 'DE', name: 'Germany' })
    expect(countryOf('the Netherlands')?.code).toBe('NL')
    // In the COUNTRY field, Georgia is the country.
    expect(countryOf('Georgia')?.code).toBe('GE')
  })
  it('unknown, ambiguous or empty = null (the caller keeps what was typed)', () => {
    for (const s of ['Narnia', 'Korea', 'England', 'America', '', '   ', 'ZZ']) expect(countryOf(s), s).toBeNull()
    expect(countryOf(42)).toBeNull()
  })
  it('the table is sound: two-letter codes, each once, and no spelling claimed by two countries', () => {
    const codes = COUNTRIES.map((c) => c.code)
    for (const c of codes) expect(c).toMatch(/^[A-Z]{2}$/)
    expect(new Set(codes).size).toBe(codes.length)
    for (const c of COUNTRIES) {
      for (const spelling of [c.code, c.name, ...(c.aliases ?? [])]) expect(countryOf(spelling)?.code, spelling).toBe(c.code)
    }
  })
})

describe('siteFacts: the facts as the site reads them', () => {
  it('reads every key, the city from artist.location', () => {
    const f = siteFacts(payload({ [K.region]: 'Illinois', [K.country]: 'USA', [K.aliases]: 'DJ Skeen\nSKN', [K.activeSince]: '2014' }))
    expect(f).toEqual({ city: 'Chicago', region: 'Illinois', country: 'United States', countryCode: 'US', aliases: ['DJ Skeen', 'SKN'], activeSince: '2014' })
  })
  it('nothing set = nothing', () => {
    expect(siteFacts(payload({}, { location: null }))).toEqual({ city: '', region: '', country: '', countryCode: null, aliases: [], activeSince: null })
  })
  it('an unknown country is kept as typed, with no code', () => {
    expect(siteFacts(payload({ [K.country]: 'Narnia' }))).toMatchObject({ country: 'Narnia', countryCode: null })
  })
  it('a year that is not a four-digit year from 1900 on is not a year', () => {
    for (const bad of ['abc', '14', '20145', '1899', '2014-05', '२०१४', '２０１４', ' ']) expect(siteFacts(payload({ [K.activeSince]: bad })).activeSince, bad).toBeNull()
    expect(siteFacts(payload({ [K.activeSince]: String(EARLIEST_ACTIVE_YEAR) })).activeSince).toBe('1900')
    expect(siteFacts(payload({ [K.activeSince]: ' 2014 ' })).activeSince).toBe('2014')
  })
  it(`a region or country over ${MAX_PLACE_PART_LENGTH} characters (only a script could store one) is dropped, never cut`, () => {
    const f = siteFacts(payload({ [K.region]: 'x'.repeat(10_000), [K.country]: 'y'.repeat(MAX_PLACE_PART_LENGTH + 1) }))
    expect(f.region).toBe('')
    expect(f.country).toBe('')
  })
  it('no site_content at all (an older door) reads as nothing set', () => {
    const p = payload()
    expect(siteFacts({ artist: p.artist, site_content: undefined as unknown as Record<string, string> })).toMatchObject({ region: '', country: '', aliases: [], activeSince: null })
  })
})

describe('the fact card (JSON-LD)', () => {
  it('nothing set: no place, no alternateName, no foundingDate', () => {
    const a = artistNode(payload({}, { location: null }))
    expect(a.foundingLocation).toBeUndefined()
    expect(a.homeLocation).toBeUndefined()
    expect(a.alternateName).toBeUndefined()
    expect(a.foundingDate).toBeUndefined()
  })

  it('city only: the 0.42 place, exactly (no address block)', () => {
    expect(artistNode(payload()).foundingLocation).toEqual({ '@type': 'Place', name: 'Chicago' })
  })

  it('Skeen with Chicago / Illinois / United States: a Place with a PostalAddress, the country as its ISO code', () => {
    const a = artistNode(payload({ [K.region]: 'Illinois', [K.country]: 'United States' }))
    expect(a.foundingLocation).toEqual({
      '@type': 'Place',
      name: 'Chicago, Illinois, United States',
      address: { '@type': 'PostalAddress', addressLocality: 'Chicago', addressRegion: 'Illinois', addressCountry: 'US' },
    })
  })

  it('only the parts that exist: nothing guessed from a city', () => {
    expect(artistNode(payload({ [K.country]: 'United States' })).foundingLocation).toEqual({
      '@type': 'Place',
      name: 'Chicago, United States',
      address: { '@type': 'PostalAddress', addressLocality: 'Chicago', addressCountry: 'US' },
    })
    expect(artistNode(payload({ [K.region]: 'Illinois' }, { location: null })).foundingLocation).toEqual({
      '@type': 'Place',
      name: 'Illinois',
      address: { '@type': 'PostalAddress', addressRegion: 'Illinois' },
    })
    // An unknown country is stated as typed rather than dropped or guessed.
    expect(artistNode(payload({ [K.country]: 'Narnia' })).foundingLocation).toMatchObject({ address: { addressCountry: 'Narnia' } })
  })

  it('all set, MusicGroup: alternateName, foundingDate and the full place', () => {
    const a = artistNode(payload({ [K.region]: 'Illinois', [K.country]: 'USA', [K.aliases]: 'DJ Skeen\nSKN', [K.activeSince]: '2014' }))
    expect(a['@type']).toBe('MusicGroup')
    expect(a.alternateName).toEqual(['DJ Skeen', 'SKN'])
    expect(a.foundingDate).toBe('2014')
    expect((a.foundingLocation as Record<string, unknown>).name).toBe('Chicago, Illinois, United States')
  })

  it('one alias is a plain string, like one genre', () => {
    expect(artistNode(payload({ [K.aliases]: 'DJ Skeen' })).alternateName).toBe('DJ Skeen')
  })

  it('an alias equal to the name is not stated (the artist may have been renamed since it was saved)', () => {
    expect(artistNode(payload({ [K.aliases]: 'skeen' })).alternateName).toBeUndefined()
  })

  it('Person: the same place as homeLocation, alternateName too, but NO foundingDate (schema.org has none for a person)', () => {
    const p = artistNode(payload({ [K.region]: 'Illinois', [K.country]: 'US', [K.aliases]: 'DJ Skeen', [K.activeSince]: '2014' }, { schema_type: 'Person' }))
    expect(p['@type']).toBe('Person')
    expect(p.homeLocation).toEqual({
      '@type': 'Place',
      name: 'Chicago, Illinois, United States',
      address: { '@type': 'PostalAddress', addressLocality: 'Chicago', addressRegion: 'Illinois', addressCountry: 'US' },
    })
    expect(p.foundingLocation).toBeUndefined()
    expect(p.alternateName).toBe('DJ Skeen')
    expect(p.foundingDate).toBeUndefined()
    expect(p.birthDate).toBeUndefined()
  })

  it('a year the site cannot trust is not stated', () => {
    expect(artistNode(payload({ [K.activeSince]: 'since forever' })).foundingDate).toBeUndefined()
  })

  it('artistPlace is the one place builder the node uses', () => {
    const p = payload({ [K.region]: 'Illinois', [K.country]: 'United States' })
    expect(artistPlace(p)).toEqual(artistNode(p).foundingLocation)
    expect(artistPlace(payload({}, { location: '  ' }))).toBeNull()
  })

  it('CRITICAL: hostile facts cannot close the script tag, and survive as data', () => {
    const evil = '</script><script>alert(1)</script>'
    const p = payload(
      {
        [K.region]: `${evil}"'`,
        [K.country]: '"},{"@type":"Thing',
        [K.aliases]: `${evil}\n"quoted" 'alias'\n\u202ERTL\n🎧 Skeen`,
        [K.activeSince]: '2014',
      },
      { location: `${evil}\u0000` },
    )
    const script = jsonLdScript(jsonLdGraph(p, { origin: ORIGIN }))
    expect(script).not.toMatch(/<\/script/i)
    expect(script).not.toContain('<')
    const back = JSON.parse(script) as { '@graph': Record<string, unknown>[] }
    const a = back['@graph'][0]
    expect(a.alternateName).toEqual([evil, `"quoted" 'alias'`, 'RTL', '🎧 Skeen'])
    const place = a.foundingLocation as { name: string; address: Record<string, string> }
    expect(place.address.addressRegion).toBe(`${evil}"'`)
    expect(place.address.addressCountry).toBe('"},{"@type":"Thing')
    expect(place.address.addressLocality).toBe(`${evil}`)
    // The injected "node" stayed a string: still one artist node, then the website.
    expect(back['@graph'].map((n) => n['@type'])).toEqual(['MusicGroup', 'WebSite'])
  })

  it('10k characters from a script: the alias and the region are dropped, the rest still stated', () => {
    const a = artistNode(payload({ [K.region]: 'r'.repeat(10_000), [K.aliases]: `${'a'.repeat(10_000)}\nDJ Skeen`, [K.country]: 'US' }))
    expect(a.alternateName).toBe('DJ Skeen')
    expect(a.foundingLocation).toEqual({ '@type': 'Place', name: 'Chicago, United States', address: { '@type': 'PostalAddress', addressLocality: 'Chicago', addressCountry: 'US' } })
  })

  it('no name, no fact sheet: the facts do not bring the empty graph back to life', () => {
    expect(jsonLdGraph(payload({ [K.aliases]: 'DJ Skeen', [K.region]: 'Illinois' }, { name: ' ' }), { origin: ORIGIN })['@graph']).toEqual([])
  })
})
