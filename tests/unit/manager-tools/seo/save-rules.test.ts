/**
 * What each SEO / GEO field may store: the one save gate for the page-head words, the answers
 * and the artist facts, what each rule refuses, and the paths that must NOT be able to write a fact.
 *
 * Code:     src/lib/site-editor/save.ts (seoValueError, saveSeoField, SEO_LIMITS, saveEditorField),
 *           src/lib/seo-facts.ts (FACT_KEYS, isFactKey, factTextError, cleanFactValue, joinAliases,
 *           thisYearAt), src/lib/seo-regions.ts (REGIONS), src/lib/artist-facts.ts (artistFactUpdate)
 * Feature:  SEO / GEO page · the save rules behind the Listing, Facts and Answers tabs; they feed
 *           the `title`, `desc`, `share`, `place`, `genre` and `card` tests
 * Tier:     STRICT (AGENTS.md "Test depth"): every value here reaches the live site's <head> or
 *           its fact card, and they are validators (markup, control characters, links).
 * Covers:   • every SEO_FIELDS key has a rule (a new key without one is refused); og_image is
 *             https only; about_placement is the registry; every string has its cap
 *           • saveSeoField keeps an answer's paragraphs, keeps the page head on one line, clears
 *             on blank, and measures the cap on what is stored
 *           • the fact keys are the bridge's, and are SEO keys; no fact may hold markup, control
 *             characters or hidden marks
 *           • region and country: one line; the country is a pick from the bridge's table, stored
 *             in its spelling; where the country has a region list, the region is one of its names
 *           • other names: one per line, at most five, each capped, no repeats, never the artist's own name
 *           • active since: a four-digit year from 1900 to this year (at UTC+14)
 *           • saveSeoField stores the CLEANED fact, reads the artist's name and the stored country
 *             itself, refuses when that read fails, and writes nothing for hostile input
 *           • no custom site field or built-in template can write a fact key
 *           • the artist-row facts (city, genre, type): only those columns, each with its rule
 * Not here: how Profile reads the stored facts back (seo-facts.test.ts); the pages that call
 *           these (tests/components/manager-tools/seo/*-tab.test.tsx, profile/profile-view.test.tsx).
 * Fixtures: a fake Supabase client that records what reaches each table (site_content upserts
 *           and deletes, the artist-name and country reads) and throws if a fact ever writes the
 *           artists row. No database.
 *
 * Stryker (2026-09-29, targeted, seo-facts.ts): 97.3%. The 4 survivors are equivalent mutants:
 * the name comparison's `toLowerCase` → `toUpperCase` (either folds case the same way), the
 * `?? ''` fallbacks for a null city and a null name in `factErrors` (the mutant's placeholder
 * text breaks no rule, so it reports nothing, same as ''), and `!raw.trim()` → `!raw` there (a
 * whitespace-only value cleans to '' and has no error either way).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { ABOUT_PLACEMENTS, COUNTRIES, FACT_CONTENT_KEYS, MAX_ALIASES, MAX_ALIAS_LENGTH, MAX_PLACE_PART_LENGTH } from '@samfox1/site-bridge/seo'
import { ARTIST_FACT_COLUMNS, SCHEMA_TYPES, artistFactUpdate } from '@/lib/artist-facts'
import { FAQ_EXTRA, FAQ_KEYS, SEO_FIELDS } from '@/lib/site-content-schema'
import { COUNTRY_NOT_LISTED, FACT_KEYS, cleanFactValue, factTextError, isFactKey, joinAliases, thisYearAt } from '@/lib/seo-facts'
import { REGIONS } from '@/lib/seo-regions'
import { SEO_LIMITS, saveEditorField, saveSeoField, seoValueError } from '@/lib/site-editor/save'

const K = FACT_CONTENT_KEYS
const NOW = new Date('2026-09-28T12:00:00Z')
const ctx = { artistName: 'Skeen', thisYear: 2026 }
const ok = (value: string) => ({ value })

/** A fake client: records what the gate stores, and answers the artist-name and country reads. */
function fake(
  artist: { data: { name: string | null } | null; error: { message: string } | null } = { data: { name: 'Skeen' }, error: null },
  /** The stored country row, as the gate's own read finds it. */
  country: { data: { value: string | null } | null; error: { message: string } | null } = { data: null, error: null },
) {
  const upserts: { key: string; value: string }[] = []
  const deletes: string[] = []
  const artistReads: string[] = []
  const countryReads: string[] = []
  const client = {
    from: (table: string) => {
      if (table === 'artists') {
        return {
          select: (cols: string) => ({
            eq: (_c: string, id: string) => ({
              maybeSingle: () => {
                artistReads.push(`${cols}:${id}`)
                return Promise.resolve(artist)
              },
            }),
          }),
          update: () => {
            throw new Error('a fact must never write the artists row')
          },
        }
      }
      if (table !== 'site_content') throw new Error(`unexpected table ${table}`)
      return {
        select: (cols: string) => {
          const filters: string[] = []
          const chain = {
            eq: (col: string, val: string) => {
              filters.push(`${col}=${val}`)
              return chain
            },
            maybeSingle: () => {
              countryReads.push(`${cols}:${filters.join('&')}`)
              return Promise.resolve(country)
            },
          }
          return chain
        },
        upsert: (row: { key: string; value: string }) => {
          upserts.push({ key: row.key, value: row.value })
          return Promise.resolve({ error: null })
        },
        delete: () => {
          const chain: Record<string, unknown> = {
            eq: (col: string, val: string) => {
              if (col === 'key') deletes.push(val)
              return chain
            },
            then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
          }
          return chain
        },
      }
    },
  } as unknown as SupabaseClient
  return { client, upserts, deletes, artistReads, countryReads }
}


describe('every SEO key has a rule (seoValueError)', () => {
  // A key with no rule is refused: a field added to the schema can never be stored unchecked.
  it('every SEO_FIELDS key has a rule (blank is always fine)', () => {
    for (const f of SEO_FIELDS) expect(seoValueError(f.key, ''), f.key).toBeNull()
    expect(seoValueError('not_a_seo_key', 'x')).toBe('Unknown SEO field.')
  })
  // The share picture's address: https only, so a javascript: or data: link never reaches og:image.
  it('CRITICAL: og_image is https only — a javascript: URL never reaches og:image', () => {
    expect(seoValueError('og_image', 'https://cdn.example.com/card.png')).toBeNull()
    expect(seoValueError('og_image', 'javascript:alert(1)')).toBeTruthy()
    // http:// is a mixed-content preview image on an https site — most scrapers drop it.
    expect(seoValueError('og_image', 'http://cdn.example.com/card.png')).toBeTruthy()
    expect(seoValueError('og_image', 'data:image/png;base64,AAAA')).toBeTruthy()
  })
  // Where the bio shows: only a placement the bridge knows.
  it('about_placement must be in the registry', () => {
    for (const p of ABOUT_PLACEMENTS) expect(seoValueError('about_placement', p)).toBeNull()
    expect(seoValueError('about_placement', 'sidebar')).toBe('Unknown about placement.')
  })
  // Every capped string: refused one over its cap, kept at it (the country is a pick, so tested apart).
  it('strings are capped by SEO_LIMITS', () => {
    for (const [key, max] of Object.entries(SEO_LIMITS)) {
      expect(seoValueError(key, 'x'.repeat(max + 1)), key).toBeTruthy()
      // The country is a pick from the bridge's table, not free text (seo-facts.test.ts pins
      // it): any string at the cap is refused for that, not for its length.
      if (key === FACT_CONTENT_KEYS.country) continue
      expect(seoValueError(key, 'x'.repeat(max)), key).toBeNull()
    }
  })
  // The five answers: gated and capped at 1200, in order.
  it('FAQ answers are SEO keys too: gated, capped, five of them in order', () => {
    expect(FAQ_KEYS).toEqual([1, 2, 3, 4, 5].map((n) => `faq_answer_${n}`))
    for (const k of FAQ_KEYS) {
      expect(seoValueError(k, 'x'.repeat(1200))).toBeNull()
      expect(seoValueError(k, 'x'.repeat(1201))).toBeTruthy()
    }
  })
  // The manager's own questions: five slots, a question capped at 200, an answer at 1200.
  it('extra questions: five slots, question capped at 200, answer at 1200', () => {
    expect(FAQ_EXTRA).toHaveLength(5)
    expect(seoValueError(FAQ_EXTRA[0].q, 'x'.repeat(201))).toBeTruthy()
    expect(seoValueError(FAQ_EXTRA[0].a, 'x'.repeat(1200))).toBeNull()
  })
})

describe('the fact keys are SEO keys', () => {
  // The fact keys are exactly the bridge's, so the site and the gate agree on what a fact is.
  it('FACT_KEYS is the bridge registry, and isFactKey knows exactly those', () => {
    expect(FACT_KEYS).toEqual(Object.values(K))
    for (const k of FACT_KEYS) expect(isFactKey(k)).toBe(true)
    for (const k of ['seo_title', 'fact_city', 'location', '', 'fact_region ']) expect(isFactKey(k)).toBe(false)
  })
  // Every fact key is an SEO key: reserved from other paths, and published with the site text.
  it('every fact key is in SEO_FIELDS (so it is reserved and publishes with the site text)', () => {
    for (const k of FACT_KEYS) expect(SEO_FIELDS.map((f) => f.key), k).toContain(k)
  })
  // Region and country share the page counter's cap (60).
  it('region and country are capped in SEO_LIMITS (the page counter reads the same table)', () => {
    expect(SEO_LIMITS[K.region]).toBe(60)
    expect(SEO_LIMITS[K.country]).toBe(60)
  })
})

describe('seoValueError on the fact keys', () => {
  // Each fact's rule applies through seoValueError too (region, country, other names, year).
  it('each rule applies', () => {
    expect(seoValueError(K.region, '<b>IL</b>', ctx)).toBe('Leave out < and >.')
    expect(seoValueError(K.country, 'x'.repeat(61), ctx)).toBe('Keep it under 60 characters.')
    expect(seoValueError(K.aliases, 'skeen', ctx)).toBe('"skeen" is the artist\'s name already.')
    expect(seoValueError(K.activeSince, '2027', ctx)).toBe('Use a year from 1900 to 2026.')
    expect(seoValueError(K.activeSince, '2014', ctx)).toBeNull()
  })
})

/**
 * What saveSeoField STORES (review 2026-09-03, M8). The gate collapsed every run of
 * whitespace, which is right for a one-line <head> string and destroys a manager's
 * two-paragraph FAQ answer — a value the fact sheet renders as prose. The sets below are
 * derived from the registry (AGENTS.md rule 4): a sixth probe answer or a sixth extra
 * slot joins the right one the day it is added to SEO_FIELDS.
 */
describe('saveSeoField keeps prose readable and <head> on one line', () => {
  /** The prose answers: rendered as paragraphs on /faqsheet, edited in a textarea. */
  const PROSE = [...FAQ_KEYS, ...FAQ_EXTRA.map((e) => e.a)]
  /** Every other length-capped SEO string. og_image / about_placement are shape-validated
   *  rather than length-capped, so they are not in SEO_LIMITS and not in this loop. The
   *  country is a pick from a list (no free text to collapse): it has its own tests. */
  const ONE_LINE = Object.keys(SEO_LIMITS).filter((k) => !PROSE.includes(k) && k !== FACT_CONTENT_KEYS.country)

  // An answer keeps its paragraph break: the fact sheet renders answers as paragraphs (review 2026-09-03, M8).
  it('CRITICAL: a prose answer keeps its paragraph break', async () => {
    for (const key of PROSE) {
      const { client, upserts } = fake()
      const r = await saveSeoField(client, 'a1', key, 'We play house.\n\nMostly in Chicago.')
      expect(r.ok, key).toBe(true)
      expect(upserts.at(-1), key).toEqual({ key, value: 'We play house.\n\nMostly in Chicago.' })
    }
  })

  // An answer is still tidied: line endings, runs of spaces, piles of blank lines.
  it('a prose answer is still tidied: CRLF, runs of spaces, and blank-line pileups', async () => {
    const { client, upserts } = fake()
    await saveSeoField(client, 'a1', FAQ_KEYS[0], '  One.\r\n\r\n\r\n\r\n  Two   words.  \n  ')
    expect(upserts.at(-1)!.value).toBe('One.\n\nTwo words.')
  })

  // A page-head field collapses to one line: <head> takes no breaks.
  it('CRITICAL: a one-line field still collapses newlines — <head> takes no breaks', async () => {
    for (const key of ONE_LINE) {
      const { client, upserts } = fake()
      const r = await saveSeoField(client, 'a1', key, 'One.\n\nTwo.')
      expect(r.ok, key).toBe(true)
      expect(upserts.at(-1), key).toEqual({ key, value: 'One. Two.' })
    }
  })

  // Blank clears the row (back to automatic), for answers and page-head fields alike.
  it('blank still clears the row, on both sides of the rule', async () => {
    for (const key of [FAQ_KEYS[0], 'seo_title']) {
      const { client, upserts, deletes } = fake()
      expect((await saveSeoField(client, 'a1', key, '  \n\n  ')).ok).toBe(true)
      expect(upserts).toEqual([])
      expect(deletes).toEqual([key])
    }
  })

  // The cap is measured on what is stored, so kept paragraph breaks count.
  it('the length cap is measured on what gets stored', async () => {
    const { client, upserts } = fake()
    // Exactly the 1200-char cap, paragraph breaks included: they survive, so they count.
    const long = `${'x'.repeat(599)}\n\n${'y'.repeat(599)}`
    expect(long).toHaveLength(SEO_LIMITS[FAQ_KEYS[0]])
    expect((await saveSeoField(client, 'a1', FAQ_KEYS[0], long)).ok).toBe(true)
    expect(upserts.at(-1)!.value).toBe(long)
    expect((await saveSeoField(client, 'a1', FAQ_KEYS[0], `${long}z`)).ok).toBe(false)
  })
})

describe('factTextError: what no fact may hold', () => {
  // Real names pass: quotes, accents, emoji and right-to-left scripts are fine.
  it('plain text, quotes, accents, emoji and RTL scripts are fine', () => {
    for (const s of ["Côte d'Ivoire", '"The" Band', 'Illinois', 'São Paulo', 'DJ 🎧', 'תל אביב', 'القاهرة', 'R&B']) expect(factTextError(s), s).toBeNull()
  })
  // No markup in a fact: < and > are refused (the fact card is inside a <script> tag).
  it('CRITICAL: markup is refused', () => {
    for (const s of ['</script>', '<b>Chicago</b>', 'a > b', '<']) expect(factTextError(s), s).toBe('Leave out < and >.')
  })
  // No hidden characters: control characters and half-emoji are refused; tab and newline are just spaces.
  it('control characters and lone surrogates are refused; tab and newline are only whitespace', () => {
    for (const s of ['Chi\u0000cago', 'x\u0007', 'x\u001b[31m', 'x\u007f', 'x\u0085', 'a\uD800b']) expect(factTextError(s), JSON.stringify(s)).toBe('That has hidden characters in it. Type it again.')
    expect(factTextError('Cook\tCounty\r\n')).toBeNull()
  })
})

describe('cleanFactValue: region and country', () => {
  // Region and country: one line, trimmed; blank clears.
  it('one line, trimmed; blank clears', () => {
    expect(cleanFactValue(K.region, '  Cook \n County ', ctx)).toEqual(ok('Cook County'))
    expect(cleanFactValue(K.region, '   ', ctx)).toEqual(ok(''))
    expect(cleanFactValue(K.country, '', ctx)).toEqual(ok(''))
  })
  // Invisible direction marks are stripped, not stored.
  it('invisible direction marks are stripped, not stored', () => {
    expect(cleanFactValue(K.region, '\u200FIllinois\u202E', ctx)).toEqual(ok('Illinois'))
  })
  // The place cap counts characters (an emoji is one); 10,000 characters are refused, never cut.
  it(`at most ${MAX_PLACE_PART_LENGTH} characters, counted as characters; 10k is refused, never cut`, () => {
    expect(cleanFactValue(K.region, 'x'.repeat(MAX_PLACE_PART_LENGTH), ctx)).toEqual(ok('x'.repeat(MAX_PLACE_PART_LENGTH)))
    expect(cleanFactValue(K.region, '🎧'.repeat(MAX_PLACE_PART_LENGTH), ctx)).toEqual(ok('🎧'.repeat(MAX_PLACE_PART_LENGTH)))
    expect(cleanFactValue(K.region, 'x'.repeat(MAX_PLACE_PART_LENGTH + 1), ctx)).toEqual({ error: `Keep it under ${MAX_PLACE_PART_LENGTH} characters.` })
    expect('error' in cleanFactValue(K.country, 'x'.repeat(10_000), ctx)).toBe(true)
  })
  // Hostile region or country: markup and control characters are refused.
  it('CRITICAL: markup and control characters are refused', () => {
    expect(cleanFactValue(K.region, '</script><script>alert(1)</script>', ctx)).toEqual({ error: 'Leave out < and >.' })
    expect(cleanFactValue(K.country, 'US\u0000', ctx)).toEqual({ error: 'That has hidden characters in it. Type it again.' })
  })
  // A known country in any spelling is stored in the table's spelling ("USA" → United States).
  it('a known country is stored in the table spelling', () => {
    for (const s of ['USA', 'us', 'U.S.A.', 'United States of America', ' united states ']) expect(cleanFactValue(K.country, s, ctx), s).toEqual(ok('United States'))
    expect(cleanFactValue(K.country, 'uk', ctx)).toEqual(ok('United Kingdom'))
  })
  // The country dropdown and the gate agree: every listed country is accepted as itself, and nothing else.
  it('CRITICAL: every country in the dropdown is accepted as itself, and nothing else is (Sam, 2026-09-29)', () => {
    for (const c of COUNTRIES) expect(cleanFactValue(K.country, c.name, ctx), c.name).toEqual(ok(c.name))
    for (const s of ['Narnia', 'England', 'Korea', 'America', 'ZZ']) expect(cleanFactValue(K.country, s, ctx), s).toEqual({ error: COUNTRY_NOT_LISTED })
  })
  // No country, or one without a region list: the region is typed text, kept as written.
  it('with no country, or one without a list, a region is typed text, never rewritten', () => {
    for (const country of [undefined, null, '', 'Germany', 'Japan']) {
      expect(cleanFactValue(K.region, 'IL', { ...ctx, country }), String(country)).toEqual(ok('IL'))
      expect(cleanFactValue(K.region, 'Bavaria', { ...ctx, country })).toEqual(ok('Bavaria'))
    }
  })
  // A country with a region list: the region must be one of its names, stored in the list's spelling.
  it('CRITICAL: where the country has a list, the region is exactly one of its names, in the list’s spelling', () => {
    for (const [country, list] of [['United States', REGIONS.US], ['usa', REGIONS.US], ['Canada', REGIONS.CA], ['Australia', REGIONS.AU], ['United Kingdom', REGIONS.GB]] as const) {
      for (const n of list.names) expect(cleanFactValue(K.region, n, { ...ctx, country }), `${country}/${n}`).toEqual(ok(n))
      expect(cleanFactValue(K.region, 'Atlantis', { ...ctx, country })).toEqual({ error: `Pick a ${list.noun} from the list.` })
    }
    expect(cleanFactValue(K.region, '  illinois ', { ...ctx, country: 'United States' })).toEqual(ok('Illinois'))
    expect(cleanFactValue(K.region, 'québec', { ...ctx, country: 'Canada' })).toEqual(ok('Quebec'))
    // A code or a neighbour's name is not a name on the list.
    expect(cleanFactValue(K.region, 'IL', { ...ctx, country: 'United States' })).toEqual({ error: 'Pick a state from the list.' })
    expect(cleanFactValue(K.region, 'Ontario', { ...ctx, country: 'United States' })).toEqual({ error: 'Pick a state from the list.' })
    expect(cleanFactValue(K.region, 'Scotland', { ...ctx, country: 'United Kingdom' })).toEqual(ok('Scotland'))
    // The markup rule still comes first.
    expect(cleanFactValue(K.region, '<b>Illinois</b>', { ...ctx, country: 'United States' })).toEqual({ error: 'Leave out < and >.' })
  })
})

describe('cleanFactValue: other names (one per line)', () => {
  // Other names: stored one per line, trimmed, blank lines dropped (a lone CR separates too).
  it('stored one per line, trimmed, blank lines dropped; blank clears', () => {
    expect(cleanFactValue(K.aliases, ' DJ Skeen \r\n\n  SKN  ', ctx)).toEqual(ok('DJ Skeen\nSKN'))
    expect(cleanFactValue(K.aliases, '\n \n', ctx)).toEqual(ok(''))
    // A lone CR (an old Mac paste) separates names too, rather than folding two into one.
    expect(cleanFactValue(K.aliases, 'DJ Skeen\rSKN', ctx)).toEqual(ok('DJ Skeen\nSKN'))
  })
  // At most five other names.
  it(`at most ${MAX_ALIASES}`, () => {
    const five = Array.from({ length: MAX_ALIASES }, (_, i) => `Name ${i}`)
    expect(cleanFactValue(K.aliases, five.join('\n'), ctx)).toEqual(ok(five.join('\n')))
    expect(cleanFactValue(K.aliases, [...five, 'Name 5'].join('\n'), ctx)).toEqual({ error: `Up to ${MAX_ALIASES} names.` })
  })
  // Each other name has its own cap; 10,000 characters are refused.
  it(`each at most ${MAX_ALIAS_LENGTH} characters`, () => {
    expect(cleanFactValue(K.aliases, 'x'.repeat(MAX_ALIAS_LENGTH), ctx)).toEqual(ok('x'.repeat(MAX_ALIAS_LENGTH)))
    expect(cleanFactValue(K.aliases, `ok\n${'x'.repeat(MAX_ALIAS_LENGTH + 1)}`, ctx)).toEqual({ error: `Keep each name under ${MAX_ALIAS_LENGTH} characters.` })
    expect('error' in cleanFactValue(K.aliases, 'x'.repeat(10_000), ctx)).toBe(true)
  })
  // No repeats, ignoring case and hidden marks; an accented spelling is a different name.
  it('no repeats, ignoring case and hidden marks', () => {
    expect(cleanFactValue(K.aliases, 'DJ Skeen\ndj skeen', ctx)).toEqual({ error: '"dj skeen" is listed twice.' })
    expect(cleanFactValue(K.aliases, 'DJ Skeen\n\u200FDJ Skeen', ctx)).toEqual({ error: '"DJ Skeen" is listed twice.' })
    // Accents are a different spelling people search.
    expect(cleanFactValue(K.aliases, 'Beyoncé\nBeyonce', { ...ctx, artistName: 'B' })).toEqual(ok('Beyoncé\nBeyonce'))
  })
  // Never the artist's own name, ignoring case and hidden marks.
  it('never the artist name, ignoring case and hidden marks', () => {
    expect(cleanFactValue(K.aliases, 'SKEEN', ctx)).toEqual({ error: '"SKEEN" is the artist\'s name already.' })
    expect(cleanFactValue(K.aliases, 'DJ Skeen\n\u200E skeen ', ctx)).toEqual({ error: '"skeen" is the artist\'s name already.' })
    expect(cleanFactValue(K.aliases, 'Skeen', { ...ctx, artistName: '  Skeen  ' })).toEqual({ error: '"Skeen" is the artist\'s name already.' })
  })
  // Hostile other names: markup or control characters in any line are refused.
  it('CRITICAL: markup and control characters in any line are refused', () => {
    expect(cleanFactValue(K.aliases, 'DJ Skeen\n</script><script>alert(1)</script>', ctx)).toEqual({ error: 'Leave out < and >.' })
    expect(cleanFactValue(K.aliases, 'DJ\u0000Skeen', ctx)).toEqual({ error: 'That has hidden characters in it. Type it again.' })
  })
  // Real names are kept as written; bidi overrides are stripped.
  it('quotes, emoji and RTL names are kept as written; bidi overrides are stripped', () => {
    expect(cleanFactValue(K.aliases, `"Skeen" O'Neil\n🎧 SKN\nسكين\n\u202Eevil`, ctx)).toEqual(ok(`"Skeen" O'Neil\n🎧 SKN\nسكين\nevil`))
  })
  // joinAliases writes the stored shape, and it reads back unchanged.
  it('joinAliases writes the stored shape, and it reads back unchanged', () => {
    const stored = joinAliases(['DJ Skeen', ' SKN '])
    expect(stored).toBe('DJ Skeen\nSKN')
    expect(joinAliases(['DJ Skeen', '', '  ', '\u200F'])).toBe('DJ Skeen')
    expect(cleanFactValue(K.aliases, stored, ctx)).toEqual(ok(stored))
  })
})

describe('cleanFactValue: active since', () => {
  // Active since: a four-digit year from 1900 to this year.
  it('a four-digit year from 1900 to this year', () => {
    expect(cleanFactValue(K.activeSince, '2014', ctx)).toEqual(ok('2014'))
    expect(cleanFactValue(K.activeSince, ' 1900 ', ctx)).toEqual(ok('1900'))
    expect(cleanFactValue(K.activeSince, '2026', ctx)).toEqual(ok('2026'))
    expect(cleanFactValue(K.activeSince, '', ctx)).toEqual(ok(''))
  })
  // Anything else is refused, with the reason (short, long, dated, full-width digits, hex).
  it('anything else is refused, with the reason', () => {
    for (const s of ['14', '20145', '2014-05', 'since 2014', '２０１４', '2014.0', '0x7DE']) expect(cleanFactValue(K.activeSince, s, ctx), s).toEqual({ error: 'Use a four-digit year, like 2014.' })
    for (const s of ['1899', '2027', '9999']) expect(cleanFactValue(K.activeSince, s, ctx), s).toEqual({ error: 'Use a year from 1900 to 2026.' })
  })
})

describe('thisYearAt: "this year" anywhere on Earth', () => {
  // "This year" is the year at UTC+14, so a manager already in the new year is not refused it.
  it('the year at UTC+14, so a manager already in the new year is not refused it', () => {
    expect(thisYearAt(new Date('2026-06-01T00:00:00Z'))).toBe(2026)
    expect(thisYearAt(new Date('2026-12-31T09:59:59Z'))).toBe(2026)
    expect(thisYearAt(new Date('2026-12-31T10:00:00Z'))).toBe(2027)
  })
})

describe('saveSeoField stores the cleaned fact', () => {
  // The region is stored cleaned: one line, hidden marks gone.
  it('region: one line', async () => {
    const f = fake()
    expect(await saveSeoField(f.client, 'a1', K.region, '  Cook\n\nCounty \u200F', NOW)).toEqual({ ok: true })
    expect(f.upserts).toEqual([{ key: K.region, value: 'Cook County' }])
  })

  // The country is stored in the table's spelling; one off the list is refused and nothing is written.
  it('CRITICAL: country: the table spelling; a country off the list is refused and nothing is written', async () => {
    const f = fake()
    expect(await saveSeoField(f.client, 'a1', K.country, 'usa', NOW)).toEqual({ ok: true })
    expect(await saveSeoField(f.client, 'a1', K.country, 'Narnia', NOW)).toEqual({ ok: false, error: 'Pick a country from the list.' })
    expect(f.upserts).toEqual([{ key: K.country, value: 'United States' }])
  })

  // The region is judged against the country the gate reads itself (a caller's could be stale).
  it('CRITICAL: region: judged against the country the gate reads itself, stored in the list’s spelling', async () => {
    const us = fake(undefined, { data: { value: 'United States' }, error: null })
    expect(await saveSeoField(us.client, 'a1', K.region, 'illinois', NOW)).toEqual({ ok: true })
    expect(await saveSeoField(us.client, 'a1', K.region, 'Ontario', NOW)).toEqual({ ok: false, error: 'Pick a state from the list.' })
    expect(us.upserts).toEqual([{ key: K.region, value: 'Illinois' }])
    expect(us.countryReads).toEqual([`value:artist_id=a1&key=${K.country}`, `value:artist_id=a1&key=${K.country}`])
    // A country with no list (or none stored): the region is typed text.
    const de = fake(undefined, { data: { value: 'Germany' }, error: null })
    expect(await saveSeoField(de.client, 'a1', K.region, 'Bavaria', NOW)).toEqual({ ok: true })
    const none = fake()
    expect(await saveSeoField(none.client, 'a1', K.region, 'IL', NOW)).toEqual({ ok: true })
  })

  // A failed country read refuses the region: an unchecked region is never stored (clearing needs no read).
  it('CRITICAL: a failed country read refuses the region: an unchecked region is never stored', async () => {
    const f = fake(undefined, { data: null, error: { message: 'boom' } })
    expect((await saveSeoField(f.client, 'a1', K.region, 'Illinois', NOW)).ok).toBe(false)
    expect(f.upserts).toEqual([])
    // Clearing needs no read.
    expect(await saveSeoField(f.client, 'a1', K.region, '  ', NOW)).toEqual({ ok: true })
    expect(f.deletes).toEqual([K.region])
  })

  // Other names keep one per line through the gate (the page-head rule would merge them into one).
  it('CRITICAL: other names keep one per line (the one-line rule would merge them into one name)', async () => {
    const f = fake()
    expect(await saveSeoField(f.client, 'a1', K.aliases, ' DJ Skeen \r\n\nSKN ', NOW)).toEqual({ ok: true })
    expect(f.upserts).toEqual([{ key: K.aliases, value: 'DJ Skeen\nSKN' }])
  })

  // Other names are checked against the name the gate reads itself.
  it('CRITICAL: other names are checked against the artist name the gate reads itself', async () => {
    const f = fake({ data: { name: 'Skeen' }, error: null })
    expect(await saveSeoField(f.client, 'a1', K.aliases, 'DJ Skeen\nSKEEN', NOW)).toEqual({ ok: false, error: '"SKEEN" is the artist\'s name already.' })
    expect(f.artistReads).toEqual(['name:a1'])
    expect(f.upserts).toEqual([])
  })

  // A failed name read refuses: an unchecked list is never stored.
  it('a failed name read refuses: an unchecked list is never stored', async () => {
    for (const artist of [{ data: null, error: { message: 'boom' } }, { data: null, error: null }]) {
      const f = fake(artist)
      const r = await saveSeoField(f.client, 'a1', K.aliases, 'DJ Skeen', NOW)
      expect(r.ok).toBe(false)
      expect(f.upserts).toEqual([])
    }
  })

  // Clearing other names deletes the row without needing the name.
  it('clearing other names deletes the row without needing the name', async () => {
    const f = fake({ data: null, error: { message: 'unreachable' } })
    expect(await saveSeoField(f.client, 'a1', K.aliases, ' \n ', NOW)).toEqual({ ok: true })
    expect(f.deletes).toEqual([K.aliases])
    expect(f.artistReads).toEqual([])
  })

  // "This year" comes from the clock the gate is given.
  it('active since: "this year" comes from the clock it is given', async () => {
    const f = fake()
    expect(await saveSeoField(f.client, 'a1', K.activeSince, '2027', NOW)).toEqual({ ok: false, error: 'Use a year from 1900 to 2026.' })
    expect(await saveSeoField(f.client, 'a1', K.activeSince, '2027', new Date('2027-01-02T00:00:00Z'))).toEqual({ ok: true })
    expect(f.upserts).toEqual([{ key: K.activeSince, value: '2027' }])
  })

  // Hostile input through the gate: every one refused, and nothing is written or deleted.
  it('CRITICAL: hostile input is refused and nothing is written', async () => {
    const f = fake()
    for (const [k, v] of [
      [K.region, '</script><script>alert(1)</script>'],
      [K.country, 'US\u0000'],
      [K.aliases, 'DJ Skeen\n<img src=x onerror=alert(1)>'],
      [K.activeSince, '2014<'],
      [K.region, 'x'.repeat(10_000)],
      [K.aliases, Array.from({ length: 6 }, (_, i) => `n${i}`).join('\n')],
    ] as const) {
      const r = await saveSeoField(f.client, 'a1', k, v, NOW)
      expect(r.ok, `${k}: ${v.slice(0, 40)}`).toBe(false)
    }
    expect(f.upserts).toEqual([])
    expect(f.deletes).toEqual([])
  })
})

describe('no other editor path can write a fact key', () => {
  // A custom site field named like a fact is reserved, so the editor can't write a fact.
  it('a custom site field named like a fact is reserved', async () => {
    for (const k of FACT_KEYS) {
      const f = fake()
      expect(await saveEditorField(f.client, 'a1', null, k, 'Illinois'), k).toEqual({ ok: false, error: 'That field name is reserved.' })
      expect(f.upserts).toEqual([])
      expect(f.deletes).toEqual([])
    }
  })
  // No built-in template declares a fact key.
  it('a built-in template declares none of them', async () => {
    for (const template of ['cinematic', 'classic']) {
      for (const k of FACT_KEYS) {
        const f = fake()
        expect(await saveEditorField(f.client, 'a1', template, k, 'Illinois'), `${template} ${k}`).toEqual({ ok: false, error: 'Unknown field.' })
        expect(f.upserts).toEqual([])
      }
    }
  })
})

describe('the artist-row facts: city, genre, type (artistFactUpdate)', () => {
  // Only the fact columns: never slug, template, or any column a caller names.
  it('CRITICAL: only the fact columns — never slug, template, or anything a caller names', () => {
    for (const col of ['slug', 'template', 'name', 'id', 'manager_id', '']) expect(artistFactUpdate(col, 'x')).toEqual({ error: 'Unknown field.' })
    for (const col of ARTIST_FACT_COLUMNS) expect('error' in artistFactUpdate(col, col === 'schema_type' ? SCHEMA_TYPES[0] : 'x')).toBe(false)
  })
  // The type is the registry only; genre and city are trimmed, capped at 120, blank clears.
  it('schema_type is the registry only; text facts trim, cap at 120, blank clears', () => {
    for (const t of SCHEMA_TYPES) expect(artistFactUpdate('schema_type', ` ${t} `)).toEqual({ column: 'schema_type', value: t })
    expect(artistFactUpdate('schema_type', 'Band')).toEqual({ error: 'Unknown artist type.' })
    expect(artistFactUpdate('genre', '  House,   Techno ')).toEqual({ column: 'genre', value: 'House, Techno' })
    expect(artistFactUpdate('location', '')).toEqual({ column: 'location', value: null })
    expect('error' in artistFactUpdate('location', 'x'.repeat(121))).toBe(true)
    // Both text facts are capped at 120 exactly, each on its own path (the city has its own
    // rule since the place facts, so it can no longer stand in for genre's cap).
    for (const col of ['genre', 'location'] as const) {
      expect(artistFactUpdate(col, 'x'.repeat(120)), col).toEqual({ column: col, value: 'x'.repeat(120) })
      expect(artistFactUpdate(col, 'x'.repeat(121)), col).toEqual({ error: 'Keep it under 120 characters.' })
    }
  })
  // The city follows the fact text rule: no markup, no control characters, no hidden marks.
  it('CRITICAL: the city ("Based in") follows the fact text rule: no markup, no control characters, no hidden marks', () => {
    expect(artistFactUpdate('location', '</script><script>alert(1)</script>')).toEqual({ error: 'Leave out < and >.' })
    expect(artistFactUpdate('location', 'Chi\u0000cago')).toEqual({ error: 'That has hidden characters in it. Type it again.' })
    expect(artistFactUpdate('location', '\u200FChicago\u202E')).toEqual({ column: 'location', value: 'Chicago' })
    expect(artistFactUpdate('location', "Côte d'Ivoire")).toEqual({ column: 'location', value: "Côte d'Ivoire" })
    expect(artistFactUpdate('location', 'São Paulo 🎧')).toEqual({ column: 'location', value: 'São Paulo 🎧' })
  })
})
