'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { SourceGlyph } from '@/components/ui/source-glyphs'
import { DeviceGlyph } from '@/components/ui/device-glyphs'
import type { SearchStatsAnswer } from '@/lib/manager-tools/seo/search-stats-ask'
import { SEARCH_PERIODS, type SearchEngineId, type SearchPeriodKey, type SearchRow, type SearchStats } from '@/lib/manager-tools/seo/search-stats'
import {
  ENGINE_NAME,
  ENGINE_VIEWS,
  LIST_SHOWN,
  PERIOD_WORDS,
  SPOT_HINT,
  barOf,
  chartOf,
  countWords,
  countryWords,
  deviceWords,
  engineDot,
  engineNote,
  engineViewOf,
  enginesOf,
  oneInWords,
  pageWords,
  rareWords,
  rateWords,
  sideBySideRows,
  sinceWords,
  spotWords,
  type EngineNote,
  type EngineRow,
  type EngineView,
} from '@/lib/manager-tools/seo/search-model'
import { HoverLabel } from '../../../_ui/row-icon'
import { CAPS_LABEL, CAPS_SECTION, FOCUS_RING_OFFSET, MONO_META } from '../../../_ui/styles'
import { SearchChart } from './search-chart'

/**
 * SEARCH, "How fans find you" (Sam, 2026-10-02, prototypes/search_tab_20261002.html): Google's
 * and Bing's own numbers for the artist's site. Built as the mock, with Sam's two changes:
 * "Both" puts the engines SIDE BY SIDE (each its own four numbers, one line each on the daily
 * chart, an engine column in the lists), never added together; and Bing's empty answer for a new
 * site says it USUALLY takes up to two weeks.
 *
 *   the switches   Both · Google · Bing and 28 days · 3 months, quiet mono words, the current one
 *                  bold. Both live in the address (`?e=`, `?p=`), so a view can be shared and the
 *                  back button undoes a switch. The engine is only a view (history.pushState, no
 *                  server trip); the period is new numbers (a navigation; the page reads `p`).
 *   the numbers    Clicks · Seen in search · Click rate ("1 in 4 clicked") · Average spot
 *                  ("1 = top result"); Seen says it includes Google's AI answers (Google only).
 *   the line       Clicks and Seen by day; days still being counted dashed (search-chart.tsx).
 *   the lists      what people searched (with the spot), the pages they landed on, and, Google
 *                  only, where and on what; "+ N clicks · M seen from rare searches" under them.
 *   no numbers     never a page of zeros: "No numbers yet" (a new site) or "Couldn't ask Bing".
 *
 * Every word comes from lib/manager-tools/seo/search-model.ts; this file only lays them out. The
 * numbers come from the page (search/page.tsx → search/load.ts); nothing here asks Google
 * or Bing. "Try again" re-renders the page, which asks again only after a refusal, an error or
 * a timeout (those are never cached).
 */
export function SearchTab({ answer }: { answer: SearchStatsAnswer }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // The engine is the address's `?e=`. A click shows it at once and pushes the address; the back
  // button changes the address, and the view follows it (state adjusted during render).
  const fromUrl = engineViewOf(params.get('e'))
  const [view, setView] = useState<EngineView>(fromUrl)
  const [seenUrl, setSeenUrl] = useState<EngineView>(fromUrl)
  if (fromUrl !== seenUrl) {
    setSeenUrl(fromUrl)
    setView(fromUrl)
  }

  const [pending, startTransition] = useTransition()
  const [wantPeriod, setWantPeriod] = useState<SearchPeriodKey>(answer.period.key)
  const period = pending ? wantPeriod : answer.period.key

  const href = (e: EngineView, p: SearchPeriodKey) => {
    const q = new URLSearchParams(params.toString())
    if (e === 'both') q.delete('e')
    else q.set('e', e)
    if (p === '28d') q.delete('p')
    else q.set('p', p)
    const s = q.toString()
    return s ? `${pathname}?${s}` : pathname
  }
  // Only the view changes here: when the pushed address reaches useSearchParams, the check above
  // finds it new and agrees (setting `seenUrl` here too would undo the click wherever the address
  // lags behind).
  const chooseView = (e: EngineView) => {
    if (e === view) return
    setView(e)
    window.history.pushState(null, '', href(e, answer.period.key))
  }
  const choosePeriod = (p: SearchPeriodKey) => {
    if (p === period) return
    setWantPeriod(p)
    startTransition(() => router.push(href(view, p), { scroll: false }))
  }
  const askAgain = () => startTransition(() => router.refresh())

  const engines = enginesOf(view)
  const stats: Partial<Record<SearchEngineId, SearchStats>> = {}
  for (const e of engines) {
    const s = answer[e]
    if (s.state === 'ok') stats[e] = s.stats
  }
  const answered = engines.filter((e) => stats[e])
  const both = view === 'both'

  return (
    <div data-search-view={view}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div role="group" aria-label="Engine" className="flex flex-wrap items-center gap-x-[18px] gap-y-1">
          {ENGINE_VIEWS.map((e) => {
            const dot = e === 'both' ? null : engineDot(answer[e])
            return (
              <button key={e} type="button" aria-pressed={view === e} onClick={() => chooseView(e)} className={cx(SWITCH, 'relative', view === e && SWITCH_ON)}>
                {e === 'both' ? null : <SourceGlyph source={e} size={13} />}
                {e === 'both' ? 'Both' : ENGINE_NAME[e]}
                {dot ? (
                  <>
                    <span aria-hidden data-dot={dot.tone} className={cx('h-1.5 w-1.5 flex-none rounded-full', dot.tone === 'red' ? 'bg-accent-red' : 'bg-status-pending')} />
                    <span className="sr-only">, {dot.label}</span>
                    <HoverLabel label={dot.label} />
                  </>
                ) : null}
              </button>
            )
          })}
        </div>
        <div role="group" aria-label="Period" className="flex flex-wrap items-center gap-x-[18px] gap-y-1">
          {(Object.keys(SEARCH_PERIODS) as SearchPeriodKey[]).map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => choosePeriod(p)} className={cx(SWITCH, period === p && SWITCH_ON)}>
              {PERIOD_WORDS[p]}
            </button>
          ))}
        </div>
      </div>

      <div aria-busy={pending} className={cx('transition-opacity duration-150', pending && 'opacity-50')}>
        {answered.length === 0 ? (
          engines.map((e) => <NoteBlock key={e} engine={e} note={engineNote(answer[e], answer.added[e])!} onRetry={askAgain} busy={pending} />)
        ) : (
          <>
            {both ? (
              <div className="mt-7 grid gap-x-12 gap-y-10 min-[900px]:grid-cols-2">
                {engines.map((e) => (
                  <section key={e} aria-label={ENGINE_NAME[e]} data-engine-column={e} className="min-w-0">
                    <h2 className={cx(CAPS_SECTION, 'flex items-center gap-2 text-ink-faint')}>
                      <SourceGlyph source={e} size={12} />
                      {ENGINE_NAME[e]}
                    </h2>
                    {stats[e] ? (
                      <Numbers stats={stats[e]!} className="mt-5 grid grid-cols-2 gap-x-6 gap-y-7" />
                    ) : (
                      <NoteBlock engine={e} note={engineNote(answer[e], answer.added[e])!} onRetry={askAgain} busy={pending} small />
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <Numbers stats={stats[engines[0]]!} className="mt-7 grid grid-cols-2 gap-x-4 gap-y-6 min-[900px]:grid-cols-4 min-[900px]:gap-x-8" />
            )}

            <div className="mt-9">
              <SearchChart
                chart={chartOf(view, stats)}
                both={both}
                since={sinceWords(firstCoverage(answered.map((e) => stats[e]!)), answer.period)}
              />
            </div>

            <Lists view={view} stats={stats} />
          </>
        )}
      </div>
    </div>
  )
}

/** The switches: quiet mono words, the current one bold ink; hover is colour only (NAV_HOVER's
 *  rule for navigation: no box behind). */
const SWITCH = cx('inline-flex items-center gap-[7px] whitespace-nowrap py-1.5 font-space text-[12px] tracking-[0.02em] text-ink-muted transition-colors hover:text-ink', FOCUS_RING_OFFSET)
const SWITCH_ON = 'font-bold text-ink'

/** The earliest first day among the engines shown (for "Since Sep 29"). */
function firstCoverage(stats: SearchStats[]): { from: string } | null {
  const froms = stats.flatMap((s) => (s.coverage ? [s.coverage.from] : [])).sort()
  return froms.length ? { from: froms[0] } : null
}

/* ── the four numbers ───────────────────────────────────────────────────────────────── */

function Numbers({ stats, className }: { stats: SearchStats; className: string }) {
  const t = stats.totals
  const oneIn = oneInWords(t.ctr)
  return (
    <dl className={className} data-numbers={stats.engine}>
      <Num label="Clicks" value={countWords(t.clicks)} />
      <Num
        label="Seen in search"
        value={countWords(t.impressions)}
        meta={
          stats.engine === 'google' ? (
            <span data-ai-note="">
              <SourceGlyph source="ai" size={11} className="mr-[5px] inline-block align-[-1px]" />
              incl. Google&apos;s AI answers
            </span>
          ) : null
        }
      />
      <Num label="Click rate" value={rateWords(t.ctr)} meta={oneIn} />
      <Num label="Average spot" value={spotWords(t.position)} meta={SPOT_HINT} />
    </dl>
  )
}

function Num({ label, value, meta }: { label: string; value: string; meta?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={cx(CAPS_LABEL, 'font-bold text-ink-faint')}>{label}</dt>
      <dd className="mt-2 font-space text-[44px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">{value}</dd>
      {meta ? <dd className={cx(MONO_META, 'mt-2')}>{meta}</dd> : null}
    </div>
  )
}

/* ── no numbers ─────────────────────────────────────────────────────────────────────── */

function NoteBlock({ engine, note, onRetry, busy, small = false }: { engine: SearchEngineId; note: EngineNote; onRetry: () => void; busy: boolean; small?: boolean }) {
  return (
    <div data-note={note.kind} data-note-engine={engine} className={cx('flex max-w-[560px] items-start gap-4', small ? 'mt-5' : 'mt-12')}>
      <span aria-hidden className={cx('grid flex-none place-items-center rounded-full border border-hairline text-ink-faint', small ? 'h-9 w-9' : 'h-11 w-11')}>
        <SourceGlyph source={engine} size={small ? 16 : 20} />
      </span>
      <div className="min-w-0">
        <h3 className={cx('font-semibold leading-tight tracking-[-0.015em] text-ink', small ? 'mt-1 text-[17px]' : 'mt-0.5 text-[22px]')}>{note.title}</h3>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-space text-[12px] text-ink-muted">
          {note.bits.map((b, i) => (
            <span key={b} className="contents">
              {i > 0 ? <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-ink-faint" /> : null}
              <span>{b}</span>
            </span>
          ))}
        </p>
        {note.retry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            className={cx('mt-3.5 inline-flex items-center gap-2 py-1.5 font-space text-[13px] text-ink transition-colors hover:text-accent disabled:opacity-50', FOCUS_RING_OFFSET)}
          >
            <Icon name="refresh" size={15} />
            Try again
          </button>
        ) : null}
      </div>
    </div>
  )
}

/* ── the lists ──────────────────────────────────────────────────────────────────────── */

type ListKind = 'query' | 'page' | 'country' | 'device'

/** Each list's columns: [engine] · name · bar · clicks · seen · [spot]. Literal strings, so
 *  Tailwind sees every class. Narrower on a small phone. */
const COLS: Record<ListKind, Record<'one' | 'both', string>> = {
  query: {
    one: 'grid-cols-[minmax(0,1fr)_minmax(56px,200px)_46px_40px_40px] max-[480px]:grid-cols-[minmax(0,1fr)_44px_34px_34px_32px]',
    both: 'grid-cols-[14px_minmax(0,1fr)_minmax(56px,200px)_46px_40px_40px] max-[480px]:grid-cols-[14px_minmax(0,1fr)_40px_34px_34px_32px]',
  },
  page: {
    one: 'grid-cols-[minmax(0,1fr)_minmax(56px,200px)_46px_40px] max-[480px]:grid-cols-[minmax(0,1fr)_44px_34px_34px]',
    both: 'grid-cols-[14px_minmax(0,1fr)_minmax(56px,200px)_46px_40px] max-[480px]:grid-cols-[14px_minmax(0,1fr)_40px_34px_34px]',
  },
  country: {
    one: 'grid-cols-[minmax(0,1fr)_minmax(48px,140px)_46px_40px] max-[480px]:grid-cols-[minmax(0,1fr)_44px_34px_34px]',
    both: 'grid-cols-[minmax(0,1fr)_minmax(48px,140px)_46px_40px] max-[480px]:grid-cols-[minmax(0,1fr)_44px_34px_34px]',
  },
  device: {
    one: 'grid-cols-[minmax(0,1fr)_minmax(48px,140px)_46px_40px] max-[480px]:grid-cols-[minmax(0,1fr)_44px_34px_34px]',
    both: 'grid-cols-[minmax(0,1fr)_minmax(48px,140px)_46px_40px] max-[480px]:grid-cols-[minmax(0,1fr)_44px_34px_34px]',
  },
}

function Lists({ view, stats }: { view: EngineView; stats: Partial<Record<SearchEngineId, SearchStats>> }) {
  const both = view === 'both'
  const answered = enginesOf(view).filter((e) => stats[e])
  const rowsOf = (pick: (s: SearchStats) => readonly SearchRow[] | null) =>
    both ? sideBySideRows(Object.fromEntries(answered.map((e) => [e, pick(stats[e]!)]))) : (pick(stats[answered[0]]!) ?? []).map((r) => ({ ...r, engine: answered[0] }))
  const queries = rowsOf((s) => s.queries)
  const pages = rowsOf((s) => s.pages)
  // Where and on what: Google only (Bing doesn't say). Beside Bing alone there is no such list.
  const google = stats.google
  const countries = google?.countries ?? []
  const devices = google?.devices ?? []
  const googleOnly = both
  const right = countries.length > 0 || devices.length > 0

  const rare = answered.flatMap((e) => {
    const words = rareWords(stats[e]!.unlisted)
    return words ? [{ engine: e, words }] : []
  })

  return (
    <div className={cx('mt-[52px] grid gap-11', right && 'min-[1024px]:grid-cols-[minmax(0,1fr)_400px] min-[1024px]:gap-x-12')}>
      <div className="flex min-w-0 flex-col gap-11">
        <StatList kind="query" title="What people searched" rows={queries} both={both}>
          {rare.map((r) => (
            <div key={r.engine} data-rare={r.engine} tabIndex={0} className={cx(MONO_META, 'relative mt-2.5 flex w-fit items-center gap-[7px] rounded-sm', FOCUS_RING_OFFSET)}>
              {both ? <SourceGlyph source={r.engine} size={11} /> : null}
              <HiddenGlyph />
              {r.words}
              <HoverLabel label={`Searches ${ENGINE_NAME[r.engine]} doesn't name`} align="start" />
            </div>
          ))}
        </StatList>
        <StatList kind="page" title="Pages they landed on" rows={pages} both={both} />
      </div>
      {right ? (
        <div className="flex min-w-0 flex-col gap-11">
          {countries.length ? <StatList kind="country" title="Where" rows={countries.map((r) => ({ ...r, engine: 'google' as const }))} both={both} googleOnly={googleOnly} /> : null}
          {devices.length ? <StatList kind="device" title="Phone or computer" rows={devices.map((r) => ({ ...r, engine: 'google' as const }))} both={both} googleOnly={googleOnly} /> : null}
        </div>
      ) : null}
    </div>
  )
}

function StatList({ kind, title, rows, both, googleOnly = false, children }: { kind: ListKind; title: string; rows: EngineRow[]; both: boolean; googleOnly?: boolean; children?: ReactNode }) {
  const [all, setAll] = useState(false)
  const engineCol = both && (kind === 'query' || kind === 'page')
  const cols = COLS[kind][engineCol ? 'both' : 'one']
  const limit = LIST_SHOWN[kind]
  const shown = all ? rows : rows.slice(0, limit)
  const maxSeen = Math.max(0, ...rows.map((r) => Math.max(r.impressions, r.clicks)))
  if (!rows.length && !children) return null
  return (
    <section data-list={kind} className="min-w-0">
      <h2 className={cx(CAPS_SECTION, 'flex items-center gap-2 text-ink-faint')}>
        {title}
        {googleOnly ? (
          <span tabIndex={0} className={cx('relative inline-flex rounded-sm', FOCUS_RING_OFFSET)}>
            <SourceGlyph source="google" size={12} />
            <span className="sr-only">Google only</span>
            <HoverLabel label="Google only · Bing doesn't say" align="start" />
          </span>
        ) : null}
      </h2>
      {rows.length ? (
        <div role="table" aria-label={title} className="mt-2.5">
          <div role="row" className={cx('grid items-center gap-x-3.5 border-b border-hairline pb-2 max-[480px]:gap-x-2', cols)}>
            {/* Empty in the grid, named for a screen reader (sr-only is absolute, so it can't be
                the grid item itself: it would leave the column and shift every head left). */}
            {engineCol ? (
              <span role="columnheader">
                <span className="sr-only">Engine</span>
              </span>
            ) : null}
            <span role="columnheader">
              <span className="sr-only">{kind === 'query' ? 'Search' : kind === 'page' ? 'Page' : kind === 'country' ? 'Country' : 'Device'}</span>
            </span>
            <span aria-hidden />
            <span role="columnheader" className={HEAD}>
              <i aria-hidden className="h-[7px] w-[7px] rounded-[2px] bg-accent max-[480px]:hidden" />
              Clicks
            </span>
            <span role="columnheader" className={HEAD}>
              <i aria-hidden className={cx('h-[7px] w-[7px] rounded-[2px] max-[480px]:hidden', SEEN_BG)} />
              Seen
            </span>
            {kind === 'query' ? (
              <span role="columnheader" tabIndex={0} className={cx(HEAD, 'relative rounded-sm', FOCUS_RING_OFFSET)}>
                Spot
                <HoverLabel label={SPOT_HINT} align="end" />
              </span>
            ) : null}
          </div>
          {shown.map((r) => (
            <div role="row" key={`${r.engine}:${r.key}`} data-row={kind} data-engine={r.engine} className={cx('group/srow grid items-center gap-x-3.5 border-b border-hairline-soft py-2 max-[480px]:gap-x-2', cols)}>
              {engineCol ? (
                <span role="cell" className="flex text-ink-faint">
                  <SourceGlyph source={r.engine} size={13} />
                  <span className="sr-only">{ENGINE_NAME[r.engine]}</span>
                </span>
              ) : null}
              <span role="rowheader" className="min-w-0">
                <RowName kind={kind} rowKey={r.key} />
              </span>
              <Bar row={r} maxSeen={maxSeen} />
              <span role="cell" className={cx(NUM, 'font-bold text-ink')}>
                {countWords(r.clicks)}
              </span>
              <span role="cell" className={cx(NUM, 'text-ink-muted')}>
                {countWords(r.impressions)}
              </span>
              {kind === 'query' ? (
                <span role="cell" className={cx(NUM, 'text-ink-muted')}>
                  {spotWords(r.position)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {rows.length > limit ? (
        <button type="button" onClick={() => setAll((v) => !v)} className={cx('mt-2.5 inline-flex items-center gap-1.5 font-space text-[12px] text-ink-muted transition-colors hover:text-ink', FOCUS_RING_OFFSET)}>
          {all ? 'Fewer' : `+ ${countWords(rows.length - limit)} more`}
        </button>
      ) : null}
      {children}
    </section>
  )
}

const HEAD = cx(CAPS_LABEL, 'inline-flex items-center justify-end gap-[5px] whitespace-nowrap text-right font-bold text-ink-faint')
const NUM = 'text-right font-space text-[11px] tabular-nums'
/** The grey of the "seen" run (the mock's --seen): darker than the track it sits in. */
const SEEN_BG = 'bg-[#d9dade]'

function RowName({ kind, rowKey }: { kind: ListKind; rowKey: string }) {
  if (kind === 'page') {
    const p = pageWords(rowKey)
    const inner = (
      <>
        <span className="min-w-0">
          <span className="block truncate text-[14px] text-ink">{p.name}</span>
          <span className="block truncate font-space text-[11px] text-ink-faint">{p.sub}</span>
        </span>
        {p.href ? <Icon name="external" size={14} className="flex-none text-ink-faint opacity-0 transition-opacity group-hover/srow:opacity-100" /> : null}
      </>
    )
    return p.href ? (
      <a href={p.href} target="_blank" rel="noopener noreferrer" className={cx('flex min-w-0 items-center gap-2.5 rounded-sm', FOCUS_RING_OFFSET)}>
        {inner}
      </a>
    ) : (
      <span className="flex min-w-0 items-center gap-2.5">{inner}</span>
    )
  }
  if (kind === 'device') {
    return (
      <span className="flex min-w-0 items-center gap-2.5 text-ink">
        <DeviceGlyph device={rowKey} size={19} />
        <span className="truncate text-[14px]">{deviceWords(rowKey)}</span>
      </span>
    )
  }
  return <span className="block truncate text-[14px] text-ink">{kind === 'country' ? countryWords(rowKey) : rowKey}</span>
}

/** The bar: the grey run is how often it was SEEN, the blue inside it the CLICKS, both on the
 *  list's own scale (search-model.ts `barOf`). */
function Bar({ row, maxSeen }: { row: { clicks: number; impressions: number }; maxSeen: number }) {
  const b = barOf(row, maxSeen)
  return (
    <span aria-hidden className="relative block h-[7px] rounded-full bg-track">
      <i className={cx('absolute inset-y-0 left-0 rounded-full', SEEN_BG)} style={{ width: `${b.seen}%` }} />
      <i className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${b.clicks}%` }} />
    </span>
  )
}

/** An eye struck through: searches the engine keeps to itself. */
function HiddenGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden="true" className="flex-none">
      <path
        d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.7 4.2 9.8 7-.4 1-1.2 2.3-2.3 3.5M6.6 6.6C4.5 8 3 10 2.2 12c1.1 2.8 4.8 7 9.8 7 1.9 0 3.6-.6 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
