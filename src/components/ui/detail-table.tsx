'use client'

import { useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { firstDir, sortRows, type SortDir, type SortValue } from '@/lib/detail-table'
import { FOCUS_RING } from './map-parts'

/**
 * A full table inside a side panel (SideSheet): every row, any column a sort. Click a
 * column's name to sort by it (biggest first for numbers, A to Z for words), click it again
 * to flip; an arrow marks the column in use. The sort rule is lib/detail-table.ts.
 *
 * The first column is the row's name, in the page's sans; the rest are numbers in mono, the
 * main one bold and the quiet ones faint. A row that leads somewhere (`onRow`: a country
 * into its cities) shows a › after its name and is a button. No bars: the table is sorted
 * and shows its numbers (Sam, 2026-10-06, on the list beside the map).
 */
export type Column<T> = {
  key: string
  label: string
  /** What the column sorts by; null for "nothing here" (shown as a dash, sorted last). */
  value: (row: T) => SortValue
  /** How a cell shows, when not just its value. */
  show?: (row: T) => ReactNode
  tone?: 'strong' | 'faint'
}

export function DetailTable<T>({ label, columns, rows, rowKey, sort, onRow, leads = () => true }: {
  label: string
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** The sort it opens with. */
  sort: { key: string; dir: SortDir }
  /** Where a row leads, if anywhere. */
  onRow?: (row: T) => void
  /** Whether THIS row leads anywhere (a source with no sites behind it does not). */
  leads?: (row: T) => boolean
}) {
  const [by, setBy] = useState(sort)
  const col = columns.find((c) => c.key === by.key) ?? columns[0]
  const sorted = sortRows(rows, col.value, by.dir)
  const pick = (c: Column<T>) =>
    setBy((cur) => (cur.key === c.key ? { key: c.key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: firstDir(rows.length ? c.value(rows[0]) : null) }))

  return (
    <table aria-label={label} className="w-full border-collapse">
      <thead>
        <tr>
          {columns.map((c, i) => {
            const on = c.key === by.key
            return (
              <th
                key={c.key}
                scope="col"
                aria-sort={on ? (by.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={cx('sticky top-0 z-[1] border-b border-hairline bg-paper px-2 py-2.5 font-space text-[10px] font-bold uppercase tracking-[0.12em]', i === 0 ? 'text-left' : 'text-right')}
              >
                <button type="button" onClick={() => pick(c)} className={cx('inline-flex items-center gap-1 rounded-sm transition-colors hover:text-ink', on ? 'text-ink' : 'text-ink-faint', FOCUS_RING)}>
                  {c.label}
                  <span aria-hidden className={cx('inline-block w-2.5 transition-[opacity,transform] duration-200', on ? 'opacity-100' : 'opacity-0', on && by.dir === 'asc' && 'rotate-180')}>↓</span>
                </button>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, n) => {
          const go = onRow && leads(row) ? () => onRow(row) : undefined
          return (
            <tr
              key={rowKey(row)}
              className={cx('row-in border-b border-hairline transition-colors hover:bg-surface-hover', go && 'group cursor-pointer')}
              style={{ animationDelay: `${Math.min(n, 20) * 18}ms` }}
              onClick={go}
            >
              {columns.map((c, i) => {
                const v = c.value(row)
                const shown = c.show ? c.show(row) : v === null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : v
                if (i === 0) {
                  return (
                    <td key={c.key} className="px-2 py-[11px] text-left text-sm text-ink">
                      {go ? (
                        <button type="button" onClick={(e) => { e.stopPropagation(); go() }} className={cx('inline-flex items-center rounded-sm text-left', FOCUS_RING)}>
                          {shown}
                          <span aria-hidden className="ml-2 text-ink-faint transition-[margin,color] duration-200 group-hover:ml-3 group-hover:text-ink">›</span>
                        </button>
                      ) : shown}
                    </td>
                  )
                }
                return (
                  <td
                    key={c.key}
                    className={cx('px-2 py-[11px] text-right font-space text-xs tabular-nums', c.tone === 'strong' ? 'font-bold text-ink' : c.tone === 'faint' ? 'text-ink-faint' : 'text-ink')}
                  >
                    {shown}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
