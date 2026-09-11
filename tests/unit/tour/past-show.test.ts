// Whether a show is in the past: by its DATE, with the stored flag as the override for
//   shows that have no date.
/**
 * Sam, 2026-09-11, on the Tour page: "why do these two dates have the day its on and the
 * ticket link but the rest dont. They should all say past." The row read a stored
 * `is_past` flag — set by the edit modal's "This was an old show" toggle — and a show
 * nobody had flagged kept its day block and ticket button long after the night. The date
 * is the truth; the flag exists for a show with no date, or one the manager wants marked
 * regardless. Skeen's Shows.tsx already moves a completed show to the past row by date;
 * the dashboard now agrees with the site.
 *
 * `today` is passed in (YYYY-MM-DD), never read from the clock here: the page computes it
 * once on the server so a row cannot flip between server and client, and a pure function
 * over a date is testable without faking time.
 */
import { describe, expect, it } from 'vitest'
import { COUNTRY_CODES, countryCode, isPastShow, todayIso } from '@/lib/tour'

const TODAY = '2026-09-11'

describe('isPastShow', () => {
  it('CRITICAL: a dated show before today is past, flag or no flag', () => {
    expect(isPastShow({ date: '2026-09-04', is_past: false }, TODAY)).toBe(true)
    expect(isPastShow({ date: '2026-08-15', is_past: false }, TODAY)).toBe(true)
  })
  it('CRITICAL: a show today or later is not past', () => {
    expect(isPastShow({ date: '2026-09-11', is_past: false }, TODAY)).toBe(false)
    expect(isPastShow({ date: '2026-12-01', is_past: false }, TODAY)).toBe(false)
  })
  it('the flag still marks a show past — an undated one, or one the manager insists on', () => {
    expect(isPastShow({ date: null, is_past: true }, TODAY)).toBe(true)
    expect(isPastShow({ date: '2026-12-01', is_past: true }, TODAY)).toBe(true)
  })
  it('an undated, unflagged show is not past', () => {
    expect(isPastShow({ date: null, is_past: false }, TODAY)).toBe(false)
  })
  // One Stryker survivor is EQUIVALENT and recorded here: dropping the `date !== null`
  // guard changes nothing, because `null < '2026-09-11'` is already false in JavaScript
  // (null coerces to 0, the string to NaN). The guard stays for the reader.
  it('todayIso is the UTC calendar date', () => {
    expect(todayIso(new Date('2026-09-11T23:59:00Z'))).toBe('2026-09-11')
    expect(todayIso(new Date('2026-09-12T00:00:01Z'))).toBe('2026-09-12')
  })
})

/**
 * The tour list abbreviates a country ("Amsterdam, NL") so the place column stays as
 * narrow as a US one ("Austin, TX"). Names the list has actually carried, plus the
 * common touring countries; anything unknown is left as written, never guessed.
 */
describe('countryCode', () => {
  it('abbreviates the countries a bill is likely to name', () => {
    expect(countryCode('Netherlands')).toBe('NL')
    expect(countryCode('The Netherlands')).toBe('NL')
    expect(countryCode('United Kingdom')).toBe('UK')
    expect(countryCode('Germany')).toBe('DE')
    expect(countryCode('Canada')).toBe('CA')
  })
  it('is case- and space-insensitive', () => {
    expect(countryCode('  netherlands ')).toBe('NL')
  })
  it('keeps a code that is already a code', () => {
    expect(countryCode('NL')).toBe('NL')
    expect(countryCode('uk')).toBe('UK')
  })
  it('CRITICAL: leaves an unknown country as written, and null as null', () => {
    expect(countryCode('Ruritania')).toBe('Ruritania')
    expect(countryCode(null)).toBeNull()
    expect(countryCode('')).toBeNull()
    expect(countryCode('   ')).toBeNull()
  })
  it('only a 2–3 LETTER value counts as a code already', () => {
    expect(countryCode('nld')).toBe('NLD')
    expect(countryCode('abcd')).toBe('abcd') // four letters: a word, left alone
    expect(countryCode('n1')).toBe('n1') // a digit: not a code
    expect(countryCode('a')).toBe('a')
  })
  // The map itself, derived from the registry (AGENTS.md rule 4) so every entry is
  // watched, not the handful named above: a key is a trimmed lower-case name, a value
  // is a 2–3 letter upper-case code, and looking a key up yields exactly its value.
  it('CRITICAL: every entry in the map is well-formed and reachable', () => {
    const entries = Object.entries(COUNTRY_CODES)
    expect(entries.length).toBeGreaterThan(30)
    for (const [name, code] of entries) {
      expect(name, `key "${name}"`).toMatch(/^[a-z]+( [a-z]+)*$/)
      expect(code, `value for "${name}"`).toMatch(/^[A-Z]{2,3}$/)
      expect(countryCode(name)).toBe(code)
      expect(countryCode(name.toUpperCase())).toBe(code)
      expect(countryCode(` ${name.replace(/ /g, '   ')} `)).toBe(code)
    }
  })
})
