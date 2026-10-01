// A show's start time: one 24h HH:MM rule, from the form to the public snapshot.
/**
 * `tour_dates.start_time` (20261001140000) is the LOCAL wall-clock time at the venue.
 * Bandsintown's bulk upload requires it as 24h `HH:MM`, and it rides the published
 * snapshot to every site, so the value is a string other systems parse: strict tier.
 *
 * One parser (`parseStartTime`, lib/tour) decides what a time is. The form path
 * (`extractUpdate` / `extractFields`) runs every posted time through it, and the
 * column's CHECK is the same pattern as a backstop.
 */
import { describe, expect, it } from 'vitest'
import { parseStartTime } from '@/lib/tour'
import { extractUpdate } from '@/lib/content-form'
import { publicSnapshot, type ContentRow } from '@/lib/content'

describe('parseStartTime', () => {
  it('accepts 24h HH:MM as written and pads a one-digit hour', () => {
    const cases: [string, string][] = [
      ['20:30', '20:30'],
      ['00:00', '00:00'],
      ['23:59', '23:59'],
      ['09:05', '09:05'],
      ['9:05', '09:05'],
      ['0:00', '00:00'],
    ]
    for (const [raw, want] of cases) expect(parseStartTime(raw), raw).toBe(want)
  })

  it('rejects everything else', () => {
    const bad = [
      '', '24:00', '12:60', '25:00', '29:00', '7:5', '123:00', '20:30:00', '2030', '20.30', '20h30',
      '8pm', '8:00 PM', ' 20:30', '20:30 ', '20:30\n', '-1:00', '٢٠:٣٠', 'javascript:alert(1)',
    ]
    for (const raw of bad) expect(parseStartTime(raw), JSON.stringify(raw)).toBeNull()
    expect(parseStartTime(null)).toBeNull()
    expect(parseStartTime(2030)).toBeNull()
  })
})

describe('the tour date save path', () => {
  it('writes the normalised time, clears it on blank, and never writes a malformed one', () => {
    const post = (v: string) => {
      const fd = new FormData()
      fd.set('start_time', v)
      return extractUpdate('tour_date', fd)
    }
    expect(post('9:05')).toEqual({ start_time: '09:05' })
    expect(post('')).toEqual({ start_time: null })
    expect(post('8pm')).toEqual({})
  })
})

describe('the published tour date', () => {
  it('CRITICAL: carries start_time, and leaves out a column the database does not have yet', () => {
    const row: ContentRow = { id: 't1', artist_id: 'a1', date: '2026-11-04', venue: 'Hall', start_time: '20:30', latitude: 30.1 }
    expect(publicSnapshot('tour_date', row).start_time).toBe('20:30')
    // Before 20261001140000 is pushed a row has no start_time key. An `undefined` in the
    // snapshot reads as null to the publish dedupe (stableJson) but never lands in the
    // stored JSON, so every publish would re-write every show. Absent stays absent.
    const { start_time: _drop, ...older } = row
    expect('start_time' in publicSnapshot('tour_date', older as ContentRow)).toBe(false)
  })
})
