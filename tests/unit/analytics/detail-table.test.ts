// The Analytics side panels' tables (Every day / source / country): how a column sorts.
import { describe, expect, it } from 'vitest'
import { firstDir, shareLabel, sortRows } from '@/lib/detail-table'

type R = { name: string; n: number | null }
const rows: R[] = [
  { name: 'beta', n: 5 }, { name: 'Alpha', n: 20 }, { name: 'gamma', n: null }, { name: 'delta', n: 5 }, { name: 'Echo', n: 1 },
]
const names = (rs: R[]) => rs.map((r) => r.name)

describe('sortRows', () => {
  it('CRITICAL: numbers sort as numbers — 20 above 5 above 1, not "5" above "20"', () => {
    expect(names(sortRows(rows, (r) => r.n, 'desc'))).toEqual(['Alpha', 'beta', 'delta', 'Echo', 'gamma'])
    expect(names(sortRows(rows, (r) => r.n, 'asc'))).toEqual(['Echo', 'beta', 'delta', 'Alpha', 'gamma'])
  })

  it('CRITICAL: a row with nothing to sort by (a day before counting began) goes last BOTH ways', () => {
    expect(sortRows(rows, (r) => r.n, 'desc').at(-1)!.name).toBe('gamma')
    expect(sortRows(rows, (r) => r.n, 'asc').at(-1)!.name).toBe('gamma')
  })

  it('ties keep the order they came in (beta before delta, both 5), whichever way', () => {
    const asc = names(sortRows(rows, (r) => r.n, 'asc'))
    const desc = names(sortRows(rows, (r) => r.n, 'desc'))
    expect(asc.indexOf('beta')).toBeLessThan(asc.indexOf('delta'))
    expect(desc.indexOf('beta')).toBeLessThan(desc.indexOf('delta'))
  })

  it('words sort alphabetically, ignoring case', () => {
    expect(names(sortRows(rows, (r) => r.name, 'asc'))).toEqual(['Alpha', 'beta', 'delta', 'Echo', 'gamma'])
    expect(names(sortRows(rows, (r) => r.name, 'desc'))).toEqual(['gamma', 'Echo', 'delta', 'beta', 'Alpha'])
  })

  it('days written as 2026-09-12 sort by date as words do', () => {
    const days = [{ name: '2026-09-12', n: 1 }, { name: '2026-10-01', n: 1 }, { name: '2026-09-30', n: 1 }]
    expect(names(sortRows(days, (r) => r.name, 'desc'))).toEqual(['2026-10-01', '2026-09-30', '2026-09-12'])
  })

  it('two blank rows keep their order between them, at the bottom', () => {
    const blanks: R[] = [{ name: 'x', n: null }, { name: 'a', n: 3 }, { name: 'y', n: null }, { name: 'b', n: 9 }]
    expect(names(sortRows(blanks, (r) => r.n, 'desc'))).toEqual(['b', 'a', 'x', 'y'])
    expect(names(sortRows(blanks, (r) => r.n, 'asc'))).toEqual(['a', 'b', 'x', 'y'])
  })

  it('a word that differs only in capitals is a tie, not a reorder ("Echo" and "echo" stay as they came)', () => {
    const cased: R[] = [{ name: 'Echo', n: 0 }, { name: 'echo', n: 0 }, { name: 'ECHO', n: 0 }]
    expect(names(sortRows(cased, (r) => r.name, 'asc'))).toEqual(['Echo', 'echo', 'ECHO'])
    expect(names(sortRows(cased, (r) => r.name, 'desc'))).toEqual(['Echo', 'echo', 'ECHO'])
  })

  it('never reorders what it was given', () => {
    const before = names(rows)
    sortRows(rows, (r) => r.n, 'desc')
    expect(names(rows)).toEqual(before)
  })
})

describe('firstDir — how a column sorts when first picked', () => {
  it('biggest first for numbers, A to Z for words; a column of blanks sorts biggest first', () => {
    expect(firstDir(12)).toBe('desc')
    expect(firstDir('Chicago')).toBe('asc')
    expect(firstDir(null)).toBe('desc')
  })
})

describe('shareLabel', () => {
  it('a share of the whole, one decimal; a dash when there is no whole', () => {
    expect(shareLabel(25, 200)).toBe('12.5%')
    expect(shareLabel(200, 200)).toBe('100.0%')
    expect(shareLabel(0, 200)).toBe('0.0%')
    expect(shareLabel(3, 0)).toBe('—')
  })
})
