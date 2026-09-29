// The artist facts on the SEO page: what the save gate accepts, and what the page shows.
/**
 * src/lib/seo-facts.ts — the rules for the new facts (region, country, other names, active
 * since) and the page's reading of them. STRICT (AGENTS.md): these values reach the live
 * site's fact card, so every rule was written red-first.
 *
 * The page's reading is the BRIDGE's reading (`siteFacts` / `artistPlace`): the last block
 * checks that against `jsonLdGraph` itself, so the page cannot say a fact is stated when
 * the site would drop it.
 *
 * Stryker (2026-09-29, targeted): 97.3%. The 4 survivors are equivalent mutants: the name
 * comparison's `toLowerCase` → `toUpperCase` (either folds case the same way), the
 * `?? ''` fallbacks for a null city and a null name in `factErrors` (the mutant's
 * placeholder text breaks no rule, so it reports nothing, same as ''), and `!raw.trim()` →
 * `!raw` there (a whitespace-only value cleans to '' and has no error either way).
 */
import { describe, expect, it } from 'vitest'
import { FACT_CONTENT_KEYS, MAX_ALIASES, MAX_ALIAS_LENGTH, MAX_PLACE_PART_LENGTH, jsonLdGraph } from '@samfox1/site-bridge/seo'
import type { PublicSitePayload } from '@samfox1/site-bridge/payload'
import { CITY_MAX_LENGTH, FACT_KEYS, cleanFactValue, factErrors, factTextError, isFactKey, joinAliases, readFacts, thisYearAt } from '@/lib/seo-facts'

const K = FACT_CONTENT_KEYS
const ctx = { artistName: 'Skeen', thisYear: 2026 }
const ok = (value: string) => ({ value })

describe('the keys', () => {
  it('FACT_KEYS is the bridge registry, and isFactKey knows exactly those', () => {
    expect(FACT_KEYS).toEqual(Object.values(K))
    for (const k of FACT_KEYS) expect(isFactKey(k)).toBe(true)
    for (const k of ['seo_title', 'fact_city', 'location', '', 'fact_region ']) expect(isFactKey(k)).toBe(false)
  })
})

describe('factTextError: what no fact may hold', () => {
  it('plain text, quotes, accents, emoji and RTL scripts are fine', () => {
    for (const s of ["Côte d'Ivoire", '"The" Band', 'Illinois', 'São Paulo', 'DJ 🎧', 'תל אביב', 'القاهرة', 'R&B']) expect(factTextError(s), s).toBeNull()
  })
  it('CRITICAL: markup is refused', () => {
    for (const s of ['</script>', '<b>Chicago</b>', 'a > b', '<']) expect(factTextError(s), s).toBe('Leave out < and >.')
  })
  it('control characters and lone surrogates are refused; tab and newline are only whitespace', () => {
    for (const s of ['Chi\u0000cago', 'x\u0007', 'x\u001b[31m', 'x\u007f', 'x\u0085', 'a\uD800b']) expect(factTextError(s), JSON.stringify(s)).toBe('That has hidden characters in it. Type it again.')
    expect(factTextError('Cook\tCounty\r\n')).toBeNull()
  })
})

describe('cleanFactValue: region and country', () => {
  it('one line, trimmed; blank clears', () => {
    expect(cleanFactValue(K.region, '  Cook \n County ', ctx)).toEqual(ok('Cook County'))
    expect(cleanFactValue(K.region, '   ', ctx)).toEqual(ok(''))
    expect(cleanFactValue(K.country, '', ctx)).toEqual(ok(''))
  })
  it('invisible direction marks are stripped, not stored', () => {
    expect(cleanFactValue(K.region, '\u200FIllinois\u202E', ctx)).toEqual(ok('Illinois'))
  })
  it(`at most ${MAX_PLACE_PART_LENGTH} characters, counted as characters; 10k is refused, never cut`, () => {
    expect(cleanFactValue(K.region, 'x'.repeat(MAX_PLACE_PART_LENGTH), ctx)).toEqual(ok('x'.repeat(MAX_PLACE_PART_LENGTH)))
    expect(cleanFactValue(K.region, '🎧'.repeat(MAX_PLACE_PART_LENGTH), ctx)).toEqual(ok('🎧'.repeat(MAX_PLACE_PART_LENGTH)))
    expect(cleanFactValue(K.region, 'x'.repeat(MAX_PLACE_PART_LENGTH + 1), ctx)).toEqual({ error: `Keep it under ${MAX_PLACE_PART_LENGTH} characters.` })
    expect('error' in cleanFactValue(K.country, 'x'.repeat(10_000), ctx)).toBe(true)
  })
  it('CRITICAL: markup and control characters are refused', () => {
    expect(cleanFactValue(K.region, '</script><script>alert(1)</script>', ctx)).toEqual({ error: 'Leave out < and >.' })
    expect(cleanFactValue(K.country, 'US\u0000', ctx)).toEqual({ error: 'That has hidden characters in it. Type it again.' })
  })
  it('a known country is stored in the table spelling; an unknown one as typed', () => {
    for (const s of ['USA', 'us', 'U.S.A.', 'United States of America', ' united states ']) expect(cleanFactValue(K.country, s, ctx), s).toEqual(ok('United States'))
    expect(cleanFactValue(K.country, 'uk', ctx)).toEqual(ok('United Kingdom'))
    expect(cleanFactValue(K.country, 'Narnia', ctx)).toEqual(ok('Narnia'))
    expect(cleanFactValue(K.country, 'England', ctx)).toEqual(ok('England'))
  })
  it('a region is never rewritten, even when it looks like a code', () => {
    expect(cleanFactValue(K.region, 'IL', ctx)).toEqual(ok('IL'))
    expect(cleanFactValue(K.region, 'US', ctx)).toEqual(ok('US'))
  })
})

describe('cleanFactValue: other names (one per line)', () => {
  it('stored one per line, trimmed, blank lines dropped; blank clears', () => {
    expect(cleanFactValue(K.aliases, ' DJ Skeen \r\n\n  SKN  ', ctx)).toEqual(ok('DJ Skeen\nSKN'))
    expect(cleanFactValue(K.aliases, '\n \n', ctx)).toEqual(ok(''))
    // A lone CR (an old Mac paste) separates names too, rather than folding two into one.
    expect(cleanFactValue(K.aliases, 'DJ Skeen\rSKN', ctx)).toEqual(ok('DJ Skeen\nSKN'))
  })
  it(`at most ${MAX_ALIASES}`, () => {
    const five = Array.from({ length: MAX_ALIASES }, (_, i) => `Name ${i}`)
    expect(cleanFactValue(K.aliases, five.join('\n'), ctx)).toEqual(ok(five.join('\n')))
    expect(cleanFactValue(K.aliases, [...five, 'Name 5'].join('\n'), ctx)).toEqual({ error: `Up to ${MAX_ALIASES} names.` })
  })
  it(`each at most ${MAX_ALIAS_LENGTH} characters`, () => {
    expect(cleanFactValue(K.aliases, 'x'.repeat(MAX_ALIAS_LENGTH), ctx)).toEqual(ok('x'.repeat(MAX_ALIAS_LENGTH)))
    expect(cleanFactValue(K.aliases, `ok\n${'x'.repeat(MAX_ALIAS_LENGTH + 1)}`, ctx)).toEqual({ error: `Keep each name under ${MAX_ALIAS_LENGTH} characters.` })
    expect('error' in cleanFactValue(K.aliases, 'x'.repeat(10_000), ctx)).toBe(true)
  })
  it('no repeats, ignoring case and hidden marks', () => {
    expect(cleanFactValue(K.aliases, 'DJ Skeen\ndj skeen', ctx)).toEqual({ error: '"dj skeen" is listed twice.' })
    expect(cleanFactValue(K.aliases, 'DJ Skeen\n\u200FDJ Skeen', ctx)).toEqual({ error: '"DJ Skeen" is listed twice.' })
    // Accents are a different spelling people search.
    expect(cleanFactValue(K.aliases, 'Beyoncé\nBeyonce', { ...ctx, artistName: 'B' })).toEqual(ok('Beyoncé\nBeyonce'))
  })
  it('never the artist name, ignoring case and hidden marks', () => {
    expect(cleanFactValue(K.aliases, 'SKEEN', ctx)).toEqual({ error: '"SKEEN" is the artist\'s name already.' })
    expect(cleanFactValue(K.aliases, 'DJ Skeen\n\u200E skeen ', ctx)).toEqual({ error: '"skeen" is the artist\'s name already.' })
    expect(cleanFactValue(K.aliases, 'Skeen', { ...ctx, artistName: '  Skeen  ' })).toEqual({ error: '"Skeen" is the artist\'s name already.' })
  })
  it('CRITICAL: markup and control characters in any line are refused', () => {
    expect(cleanFactValue(K.aliases, 'DJ Skeen\n</script><script>alert(1)</script>', ctx)).toEqual({ error: 'Leave out < and >.' })
    expect(cleanFactValue(K.aliases, 'DJ\u0000Skeen', ctx)).toEqual({ error: 'That has hidden characters in it. Type it again.' })
  })
  it('quotes, emoji and RTL names are kept as written; bidi overrides are stripped', () => {
    expect(cleanFactValue(K.aliases, `"Skeen" O'Neil\n🎧 SKN\nسكين\n\u202Eevil`, ctx)).toEqual(ok(`"Skeen" O'Neil\n🎧 SKN\nسكين\nevil`))
  })
  it('joinAliases writes the stored shape, and it reads back unchanged', () => {
    const stored = joinAliases(['DJ Skeen', ' SKN '])
    expect(stored).toBe('DJ Skeen\nSKN')
    expect(joinAliases(['DJ Skeen', '', '  ', '\u200F'])).toBe('DJ Skeen')
    expect(cleanFactValue(K.aliases, stored, ctx)).toEqual(ok(stored))
  })
})

describe('cleanFactValue: active since', () => {
  it('a four-digit year from 1900 to this year', () => {
    expect(cleanFactValue(K.activeSince, '2014', ctx)).toEqual(ok('2014'))
    expect(cleanFactValue(K.activeSince, ' 1900 ', ctx)).toEqual(ok('1900'))
    expect(cleanFactValue(K.activeSince, '2026', ctx)).toEqual(ok('2026'))
    expect(cleanFactValue(K.activeSince, '', ctx)).toEqual(ok(''))
  })
  it('anything else is refused, with the reason', () => {
    for (const s of ['14', '20145', '2014-05', 'since 2014', '２０１４', '2014.0', '0x7DE']) expect(cleanFactValue(K.activeSince, s, ctx), s).toEqual({ error: 'Use a four-digit year, like 2014.' })
    for (const s of ['1899', '2027', '9999']) expect(cleanFactValue(K.activeSince, s, ctx), s).toEqual({ error: 'Use a year from 1900 to 2026.' })
  })
})

describe('thisYearAt: "this year" anywhere on Earth', () => {
  it('the year at UTC+14, so a manager already in the new year is not refused it', () => {
    expect(thisYearAt(new Date('2026-06-01T00:00:00Z'))).toBe(2026)
    expect(thisYearAt(new Date('2026-12-31T09:59:59Z'))).toBe(2026)
    expect(thisYearAt(new Date('2026-12-31T10:00:00Z'))).toBe(2027)
  })
})

describe('readFacts: the facts as the page shows them', () => {
  const artist = { name: 'Skeen', location: 'Chicago', schema_type: 'MusicGroup' }

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
  it('nothing set', () => {
    expect(readFacts({}, { name: 'Skeen', location: null })).toEqual({ city: '', region: '', country: '', countryCode: null, aliases: [], activeSince: null, place: '', activeSinceStated: false })
  })
  it('city only: the place is the city', () => {
    expect(readFacts({}, artist).place).toBe('Chicago')
  })
  it('a Person keeps the year on the page, but it is not stated on the card', () => {
    const f = readFacts({ [K.activeSince]: '2014' }, { ...artist, schema_type: 'Person' })
    expect(f.activeSince).toBe('2014')
    expect(f.activeSinceStated).toBe(false)
  })
  it('null values from the table read as unset', () => {
    expect(readFacts({ [K.region]: null, [K.aliases]: undefined }, artist)).toMatchObject({ region: '', aliases: [] })
  })

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
          const p = { artist: { id: 'a', slug: 's', name: 'Skeen', bio: null, hero_image_url: null, template: 'custom', spotify_artist_id: null, location, schema_type }, tracks: [], tour_dates: [], merch: [], links: [], videos: [], media: [], site_content: content, styles: {}, fonts: [], font_slots: {} } satisfies PublicSitePayload
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

describe('factErrors: what is stored that the gate would refuse today', () => {
  const artist = { name: 'Skeen', location: 'Chicago' }
  it('clean facts: none (strictly: no field present, not even as undefined)', () => {
    expect(factErrors({ [K.region]: 'Illinois', [K.country]: 'United States', [K.aliases]: 'DJ Skeen', [K.activeSince]: '2014' }, artist, 2026)).toStrictEqual({})
    expect(factErrors({}, { name: 'Skeen', location: null }, 2026)).toStrictEqual({})
    expect(factErrors({ [K.region]: '   ' }, artist, 2026)).toStrictEqual({})
  })
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
  it('an artist with no name yet: aliases are checked for everything but the name', () => {
    expect(factErrors({ [K.aliases]: 'DJ Skeen' }, { name: null, location: null }, 2026)).toStrictEqual({})
    expect(factErrors({ [K.aliases]: 'a\nA' }, { name: null, location: null }, 2026)).toEqual({ aliases: '"A" is listed twice.' })
  })
  it('an alias that became the name after a rename is flagged (the card already drops it)', () => {
    expect(factErrors({ [K.aliases]: 'DJ Skeen' }, { name: 'DJ Skeen', location: null }, 2026)).toEqual({ aliases: '"DJ Skeen" is the artist\'s name already.' })
  })
  it(`a city over ${CITY_MAX_LENGTH} characters is flagged`, () => {
    expect(factErrors({}, { name: 'S', location: 'x'.repeat(CITY_MAX_LENGTH + 1) }, 2026)).toEqual({ city: `Keep it under ${CITY_MAX_LENGTH} characters.` })
    expect(factErrors({}, { name: 'S', location: 'x'.repeat(CITY_MAX_LENGTH) }, 2026)).toStrictEqual({})
  })
})
