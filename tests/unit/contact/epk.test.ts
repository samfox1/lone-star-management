// The two press-kit fields a manager types: the one-line pitch and the press quotes.
/**
 * Press-kit fields: the two EPK-only values a manager fills in by hand
 * (a one-line pitch and a list of press quotes).
 *
 * Both are read back out of a PUBLISHED revision, which is why parsing is
 * separate from cleaning: `cleanPressQuotes` guards the WRITE, but
 * `parsePressQuotes` has to cope with every revision published before this
 * feature existed (the key is simply absent) and with anything a future
 * migration leaves behind. A press kit that throws on an old revision would
 * take the whole EPK page down.
 */
import { describe, expect, it } from 'vitest'
import {
  PITCH_MAX,
  QUOTES_MAX,
  cleanPressPitch,
  cleanPressQuotes,
  parsePressQuotes,
  readPressQuotesFromForm,
} from '@/lib/epk'

describe('parsePressQuotes (read path — must never throw)', () => {
  it('returns [] for a revision that predates the feature', () => {
    expect(parsePressQuotes(undefined)).toEqual([])
    expect(parsePressQuotes(null)).toEqual([])
  })

  it('returns [] for junk of the wrong shape', () => {
    expect(parsePressQuotes('not an array')).toEqual([])
    expect(parsePressQuotes(42)).toEqual([])
    expect(parsePressQuotes({ quote: 'lonely object' })).toEqual([])
  })

  it('keeps well-formed quotes', () => {
    expect(
      parsePressQuotes([{ quote: 'A blistering live act.', source: 'NME', url: 'https://nme.com/x' }]),
    ).toEqual([{ quote: 'A blistering live act.', source: 'NME', url: 'https://nme.com/x' }])
  })

  it('drops entries with no quote text, and non-objects', () => {
    expect(parsePressQuotes([{ quote: '', source: 'NME' }, null, 'x', { source: 'no quote here' }])).toEqual([])
  })

  it('fills a missing source and url rather than dropping the quote', () => {
    expect(parsePressQuotes([{ quote: 'Great.' }])).toEqual([{ quote: 'Great.', source: '', url: null }])
  })

  it('nulls a dangerous url but keeps the quote', () => {
    expect(parsePressQuotes([{ quote: 'Great.', source: 'NME', url: 'javascript:alert(1)' }])).toEqual([
      { quote: 'Great.', source: 'NME', url: null },
    ])
  })
})

describe('cleanPressQuotes (write path)', () => {
  it('trims and preserves order', () => {
    expect(
      cleanPressQuotes([
        { quote: '  first  ', source: '  Pitchfork ', url: '  https://p4k.com/a  ' },
        { quote: 'second', source: '', url: '' },
      ]),
    ).toEqual([
      { quote: 'first', source: 'Pitchfork', url: 'https://p4k.com/a' },
      { quote: 'second', source: '', url: null },
    ])
  })

  it('drops rows that are blank once trimmed', () => {
    expect(cleanPressQuotes([{ quote: '   ', source: 'NME', url: '' }])).toEqual([])
  })

  it('caps how many quotes are stored', () => {
    const many = Array.from({ length: QUOTES_MAX + 5 }, (_, i) => ({ quote: `q${i}`, source: '', url: '' }))
    expect(cleanPressQuotes(many)).toHaveLength(QUOTES_MAX)
  })

  it('caps the length of a single quote', () => {
    const [only] = cleanPressQuotes([{ quote: 'x'.repeat(5000), source: '', url: '' }])
    expect(only.quote.length).toBeLessThanOrEqual(300)
  })
})

describe('readPressQuotesFromForm', () => {
  const form = (rows: [string, string, string][]) => {
    const fd = new FormData()
    for (const [q, s, u] of rows) {
      fd.append('quote', q)
      fd.append('source', s)
      fd.append('quote_url', u)
    }
    return fd
  }

  it('zips the three lists by row, keeping source with its own quote', () => {
    expect(
      readPressQuotesFromForm(
        form([
          ['first', 'NME', 'https://nme.com/a'],
          ['second', 'Pitchfork', ''],
        ]),
      ),
    ).toEqual([
      { quote: 'first', source: 'NME', url: 'https://nme.com/a' },
      { quote: 'second', source: 'Pitchfork', url: null },
    ])
  })

  it('a row blanked out by the manager simply disappears', () => {
    expect(readPressQuotesFromForm(form([['', 'NME', ''], ['kept', '', '']]))).toEqual([
      { quote: 'kept', source: '', url: null },
    ])
  })

  it('is empty when the form carries no rows at all', () => {
    expect(readPressQuotesFromForm(new FormData())).toEqual([])
  })
})

describe('cleanPressPitch', () => {
  it('trims, and treats blank as cleared', () => {
    expect(cleanPressPitch('  Austin four-piece.  ')).toBe('Austin four-piece.')
    expect(cleanPressPitch('   ')).toBeNull()
    expect(cleanPressPitch(null)).toBeNull()
  })

  it('caps length', () => {
    expect(cleanPressPitch('x'.repeat(1000))?.length).toBe(PITCH_MAX)
  })

  it('collapses newlines — it is a ONE-line pitch', () => {
    expect(cleanPressPitch('two\nlines')).toBe('two lines')
  })
})
