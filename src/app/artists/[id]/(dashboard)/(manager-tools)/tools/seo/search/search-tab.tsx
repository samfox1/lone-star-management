'use client'

import { useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cx } from '@/lib/cx'
import { dayLabel } from '@/lib/chart'
import { growthSize } from '@/lib/format'
import { Icon } from '@/components/ui/icons'
import { SourceGlyph } from '@/components/ui/source-glyphs'
import { ChartLegend, TimelineChart, type ChartPin, type Series } from '@/components/ui/timeline-chart'
import { FactsColumn, type Fact } from '@/components/ui/facts-column'
import { SquareCheck } from '@/components/ui/square-check'
import type { SearchStatsAnswer } from '@/lib/manager-tools/seo/search-stats-ask'
import { SEARCH_PERIODS, type SearchEngineId, type SearchPeriodKey, type SearchStats } from '@/lib/manager-tools/seo/search-stats'
import { ENGINE_NAME, ENGINE_VIEWS, LIST_SHOWN, SPOT_HINT, NAME_SEARCHES_SHOWN, bareNameWords, countWords, engineDot, engineNote, engineViewOf, enginesOf, reachIntro, reachTitle, searchIntro, searchTitle, sideBySideRows, spotWords, type EngineNote, type EngineView } from '@/lib/manager-tools/seo/search-model'
import { isBareName, nameSearches, nameSpot, searchTrend, spotFacts } from '@/lib/manager-tools/seo/search-spot'
import { reachBoard, spotBoard, weekGrowth, type BoardLine } from '@/lib/manager-tools/seo/search-board'
import type { AiVisit } from '@/lib/manager-tools/seo/ai-visits'
import { HoverLabel } from '../../../_ui/row-icon'
import { CAPS_LABEL, FOCUS_RING_OFFSET, MONO_META } from '../../../_ui/styles'
import { Segmented } from '../../../../segmented'

/**
 * SEARCH, the proof that the SEO / GEO work is working (the r12 mock, Sam 2026-10-06: "the
 * analytics here should essentially be proving that the SEO / GEO is working, not repeating
 * stuff on the main analytics page"). The Analytics page's look: one title, the same chart, its
 * numbers on the right.
 *
 *   the title     "HOW SKEEN SHOWS UP ON GOOGLE", in capitals; beside it the engines (Both ·
 *                 Google · Bing, glyphs) and the period. Both live in the address (`?e=`, `?p=`):
 *                 the engine is only a view (history.pushState, no server trip); the period is new
 *                 numbers (a navigation; the page reads `p`).
 *   your spot     where the site sits when someone searches the artist's NAME, day by day, #1 at
 *                 the top, the artist's initial riding the end of the line, a pin on the day the
 *                 site was added to each engine. Beside it: now, the average, places climbed.
 *   seen, clicks  how often the site was seen in search and clicked, Clicks a toggle.
 *   the lists     what people searched (its spot over the period as a little line) and the fans
 *                 AI assistants sent.
 *   both          each engine its own line, never added together (Sam: "Lets do both side by
 *                 side too"): Google ink, Bing grey.
 *   no numbers    never a page of zeros: "No numbers yet" (a new site) or "Couldn't ask Bing" when
 *                 the engine shown has none; beside an engine that answered, only its button's dot.
 *
 * Every word and line comes from lib/manager-tools/seo/ (search-model, search-board,
 * search-spot, ai-visits); this file only lays them out. Nothing here asks Google or Bing.
 */
export function SearchTab({ answer, answers, name, ai }: {
  answer: SearchStatsAnswer
  /** Every period's answer (the page asks for all), for the seen / clicked chart's own period. */
  answers: Record<SearchPeriodKey, SearchStatsAnswer>
  name: string
  ai: AiVisit[]
}) {
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
  // finds it new and agrees.
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
  // Side by side only when both engines have numbers; one alone reads as that engine.
  const both = answered.length > 1

  return (
    <div data-search-view={view}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-[640px]">
          <h1 className={TITLE}>{searchTitle(view, name)}</h1>
          <p data-intro className={INTRO}>{searchIntro(view, name)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div role="group" aria-label="Engine" className="flex items-center gap-1">
            {ENGINE_VIEWS.map((e) => (
              <EngineButton key={e} engine={e} on={view === e} dot={e === 'both' ? null : engineDot(answer[e])} onClick={() => chooseView(e)} />
            ))}
          </div>
          <Segmented
            label="Period"
            options={(Object.keys(SEARCH_PERIODS) as SearchPeriodKey[]).map((p) => ({ key: p, label: p }))}
            value={period}
            onChange={choosePeriod}
          />
        </div>
      </div>

      <div aria-busy={pending} className={cx('transition-opacity duration-150', pending && 'opacity-50')}>
        {answered.length === 0 ? (
          engines.map((e) => <NoteBlock key={e} engine={e} note={engineNote(answer[e], answer.added[e])!} onRetry={askAgain} busy={pending} />)
        ) : (
          <>
            {/* An engine beside one that answered, which itself has nothing, says so only by the
                dot on its button (Sam, 2026-10-06: "I also dont want seeing this row"). */}
            <SpotSection key={`spot-${view}-${answer.period.key}`} view={view} stats={stats} name={name} added={answer.added} />
            <ReachSection answers={answers} startPeriod={answer.period.key} />
            <div className="mt-14 grid gap-11 min-[1024px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-[1024px]:gap-x-12">
              <Searched view={view} stats={stats} both={both} />
              <SentByAi ai={ai} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── the charts ─────────────────────────────────────────────────────────────────────── */

/** Each chart's header and its sentence: capitals in mono, then plain words. */
const TITLE = 'font-space text-[15px] font-bold uppercase tracking-[0.12em] text-ink'
const INTRO = 'mt-2 text-[13px] leading-relaxed text-ink-muted'

const CHART_H = 380
const points = (days: string[]) => days.map((day) => ({ day, views: 0, visitors: 0 }))
const seriesOf = (lines: BoardLine[]): Series[] =>
  lines.map((l) => ({ key: l.key, label: l.label, values: l.values, color: l.tone, ...(l.thick ? { thick: true } : {}) }))
const spot = (v: number) => `#${spotWords(v)}`

/** YOUR SPOT: each engine's spot when someone searches the name, #1 at the top. */
function SpotSection({ view, stats, name, added }: { view: EngineView; stats: Partial<Record<SearchEngineId, SearchStats>>; name: string; added: SearchStatsAnswer['added'] }) {
  const board = spotBoard(view, stats, name)
  const both = board.lines.length > 1
  if (!board.lines.length) {
    return (
      <p data-no-spot className={cx(MONO_META, 'mt-10 flex items-center gap-2')}>
        <SourceGlyph source={view === 'both' ? 'google' : view} size={13} className="text-ink-faint" />
        {`No one has searched “${name}” on ${view === 'both' ? 'Google or Bing' : ENGINE_NAME[view]} yet.`}
      </p>
    )
  }
  // The day the site was added to each engine, on that engine's line, when it is in view.
  const pins: ChartPin[] = board.lines.flatMap((l) => {
    const at = added[l.engine]
    return at ? [{ day: at.slice(0, 10), series: l.key, icon: <SourceGlyph source={l.engine} size={14} />, title: `Site added to ${ENGINE_NAME[l.engine]}`, note: '' }] : []
  })
  const facts: Fact[] = board.lines.flatMap((l) => {
    const f = spotFacts(nameSpot(stats[l.engine]!.searchDays, name))
    if (!f) return []
    const dir = f.climbed === null || Math.abs(f.climbed) < 0.05 ? 'flat' : f.climbed > 0 ? 'up' : 'down'
    return [{
      key: l.key, label: both ? ENGINE_NAME[l.engine] : 'Now', value: spot(f.now),
      sub: { label: 'Average', value: spot(f.average) },
      growth: f.climbed === null ? null : { dir, size: spotWords(Math.abs(f.climbed)), tail: `places since ${dayLabel(f.since)}`, tailShort: 'places' },
    }]
  })
  const initial = name.trim().charAt(0).toUpperCase() || '·'
  return (
    <section aria-label="Your spot" className="mt-5">
      <ChartLegend series={seriesOf(board.lines)} />
      <div className="mt-1 grid gap-8 lg:grid-cols-[minmax(0,1fr)_200px]">
        <TimelineChart
          points={points(board.days)} height={CHART_H} series={seriesOf(board.lines)} scale="rank" dots
          partialFrom={board.partialFrom} format={spot} legend={false} pins={pins} className="min-w-0"
          endMark={<span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-paper shadow-[0_0_0_5px_rgba(17,17,17,0.08)]">{initial}</span>}
        />
        <FactsColumn facts={facts} label="Your spot, in numbers" />
        <NameSearches view={view} stats={stats} engines={board.lines.map((l) => l.engine)} name={name} />
      </div>
    </section>
  )
}

/** BASED ON THESE SEARCHES: what the ranking line is made of, under it, so the number is never
 *  taken on trust (Sam, 2026-10-06: "allow user to see the searches that the chart is using.
 *  Maybe the top 5"): each search naming the artist, how often the site was seen for it and its
 *  spot; and, when the bare name is not one of them, a plain line saying so. */
function NameSearches({ view, stats, engines, name }: { view: EngineView; stats: Partial<Record<SearchEngineId, SearchStats>>; engines: SearchEngineId[]; name: string }) {
  const both = engines.length > 1
  const rows = engines
    .flatMap((e) => nameSearches(stats[e]!.searchDays, name).map((r) => ({ ...r, engine: e })))
    .sort((a, b) => b.seen - a.seen || a.key.localeCompare(b.key))
  const shown = rows.slice(0, NAME_SEARCHES_SHOWN)
  const more = rows.length - shown.length
  const bare = rows.some((r) => isBareName(r.key, name))
  const cols = both ? 'grid-cols-[16px_minmax(0,1fr)_52px_52px]' : 'grid-cols-[minmax(0,1fr)_52px_52px]'
  return (
    <div data-name-searches className="max-w-[560px] lg:col-start-1">
      <div role="table" aria-label="Based on these searches">
        <div role="row" className={cx('grid items-center gap-x-3.5 border-b border-hairline pb-2', cols)}>
          {both ? <span role="columnheader"><span className="sr-only">Engine</span></span> : null}
          <span role="columnheader" className={cx(CAPS_LABEL, 'font-bold text-ink-faint')}>Based on these searches</span>
          <span role="columnheader" className={HEAD}>Seen</span>
          <span role="columnheader" className={HEAD}>Spot</span>
        </div>
        {shown.map((r) => (
          <div role="row" key={`${r.engine}:${r.key}`} data-row="name-search" className={cx('grid items-center gap-x-3.5 border-b border-hairline-soft py-2', cols)}>
            {both ? (
              <span role="cell" className="flex text-ink-faint">
                <SourceGlyph source={r.engine} size={13} />
                <span className="sr-only">{ENGINE_NAME[r.engine]}</span>
              </span>
            ) : null}
            <span role="rowheader" className="min-w-0 truncate text-[14px] text-ink">{r.key}</span>
            <span role="cell" className={cx(NUM, 'text-ink-muted')}>{countWords(r.seen)}</span>
            <span role="cell" className={cx(NUM, 'font-bold text-ink')}>{spot(r.spot)}</span>
          </div>
        ))}
      </div>
      {more > 0 ? <p className={cx(MONO_META, 'mt-2')}>{`+ ${countWords(more)} more`}</p> : null}
      {!bare ? <p data-bare-name className="mt-2.5 font-space text-[12px] text-ink-muted">{bareNameWords(name, view)}</p> : null}
    </div>
  )
}

/**
 * SEEN, CLICKS: how often the site was seen in search and clicked, with its OWN Google / Bing
 * toggles and its own period (Sam, 2026-10-06: "allow the second one to have its own google/bing
 * toggle and its own total time buttons … They both start default on. If data isnt available yet
 * for it, it can just stay at 0"). An engine on shows its lines and numbers; the last one on stays
 * on, so the chart is never empty. Clicks a toggle too.
 */
function ReachSection({ answers, startPeriod }: { answers: Record<SearchPeriodKey, SearchStatsAnswer>; startPeriod: SearchPeriodKey }) {
  const [on, setOn] = useState<SearchEngineId[]>(['google', 'bing'])
  const [period, setPeriod] = useState<SearchPeriodKey>(startPeriod)
  const [clicks, setClicks] = useState(true)
  const a = answers[period]
  const board = reachBoard(on, { google: a.google, bing: a.bing })
  const lines = board.lines.filter((l) => clicks || l.metric !== 'clicks')
  const both = new Set(board.lines.map((l) => l.engine)).size > 1
  const toggle = (e: SearchEngineId) => setOn((cur) => (cur.includes(e) ? (cur.length > 1 ? cur.filter((x) => x !== e) : cur) : [...cur, e]))
  const facts: Fact[] = lines.map((l) => {
    const readings = l.values.filter((v): v is number => v !== null)
    const total = readings.reduce((n, v) => n + v, 0)
    const g = weekGrowth(l.values)
    return {
      key: l.key, label: both ? l.label : l.metric === 'seen' ? 'Seen' : 'Clicks', value: total,
      sub: { label: 'Per day', value: perDay(readings.length ? total / readings.length : 0) },
      growth: g === null ? null : { dir: g > 0.0005 ? 'up' : g < -0.0005 ? 'down' : 'flat', size: growthSize(g), tail: `since ${dayLabel(board.days[0])}` },
    }
  })
  const clicksLabel = on.length === 1 ? `Clicks from ${ENGINE_NAME[on[0]]}` : 'Clicks'
  return (
    <section aria-label="Seen and clicked" className="mt-14">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-[640px]">
          <h2 className={TITLE}>{reachTitle(on)}</h2>
          <p className={INTRO}>{reachIntro(on)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div role="group" aria-label="Engines on this chart" className="flex items-center gap-1">
            {(['google', 'bing'] as const).map((e) => (
              <EngineButton key={e} engine={e} on={on.includes(e)} dot={engineDot(a[e])} onClick={() => toggle(e)} />
            ))}
          </div>
          <Segmented
            label="Period of this chart"
            options={(Object.keys(SEARCH_PERIODS) as SearchPeriodKey[]).map((p) => ({ key: p, label: p }))}
            value={period}
            onChange={setPeriod}
          />
        </div>
      </div>
      <div className="mt-4 flex items-center">
        <SquareCheck label={clicksLabel} on={clicks} onToggle={() => setClicks((c) => !c)} />
      </div>
      <div className="mt-4">
        <ChartLegend series={seriesOf(lines)} />
      </div>
      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_200px]">
        <TimelineChart key={`${period}-${on.join()}`} points={points(board.days)} height={CHART_H - 40} series={seriesOf(lines)} partialFrom={board.partialFrom} legend={false} className="min-w-0" />
        <FactsColumn facts={facts} label="Seen and clicked, in numbers" />
      </div>
    </section>
  )
}

/** An engine's glyph as a button (Both shows the two glyphs): ink when on, faint when off, the
 *  amber / red dot when the engine has nothing yet or couldn't be asked. */
function EngineButton({ engine, on, dot, onClick }: { engine: EngineView; on: boolean; dot: { tone: 'pending' | 'red'; label: string } | null; onClick: () => void }) {
  const name = engine === 'both' ? 'Both' : ENGINE_NAME[engine]
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={name}
      onClick={onClick}
      className={cx('relative flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 transition-colors', on ? 'text-ink' : 'text-ink-faint hover:text-ink', FOCUS_RING_OFFSET)}
    >
      {engine === 'both' ? (
        <>
          <SourceGlyph source="google" size={14} />
          <SourceGlyph source="bing" size={14} />
        </>
      ) : (
        <SourceGlyph source={engine} size={17} />
      )}
      {dot ? (
        <>
          <span aria-hidden data-dot={dot.tone} className={cx('absolute right-0.5 top-1 h-1.5 w-1.5 rounded-full', dot.tone === 'red' ? 'bg-accent-red' : 'bg-status-pending')} />
          <span className="sr-only">, {dot.label}</span>
        </>
      ) : null}
      <HoverLabel label={engine === 'both' ? 'Google and Bing' : dot ? `${name} · ${dot.label}` : name} />
    </button>
  )
}

const perDay = (n: number) => (n >= 10 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1))

/* ── the lists ──────────────────────────────────────────────────────────────────────── */

const HEAD = cx(CAPS_LABEL, 'whitespace-nowrap text-right font-bold text-ink-faint')
const NUM = 'text-right font-space text-[11px] tabular-nums'

/** WHAT PEOPLE SEARCHED: each search, its spot over the period as a little line, how often the
 *  site was seen for it and its spot. Beside both engines, each engine's own rows. */
function Searched({ view, stats, both }: { view: EngineView; stats: Partial<Record<SearchEngineId, SearchStats>>; both: boolean }) {
  const [all, setAll] = useState(false)
  const answered = enginesOf(view).filter((e) => stats[e])
  const rows = both
    ? sideBySideRows(Object.fromEntries(answered.map((e) => [e, stats[e]!.queries])))
    : (stats[answered[0]]?.queries ?? []).map((r) => ({ ...r, engine: answered[0] }))
  const shown = all ? rows : rows.slice(0, LIST_SHOWN.query)
  const cols = both ? 'grid-cols-[16px_minmax(0,1fr)_84px_44px_44px]' : 'grid-cols-[minmax(0,1fr)_84px_44px_44px]'
  return (
    <section data-list="query" className="min-w-0">
      <h2 className={cx(CAPS_LABEL, 'font-bold text-ink-faint')}>What people searched</h2>
      {rows.length ? (
        <div role="table" aria-label="What people searched" className="mt-2.5">
          <div role="row" className={cx('grid items-center gap-x-3.5 border-b border-hairline pb-2', cols)}>
            {both ? <span role="columnheader"><span className="sr-only">Engine</span></span> : null}
            <span role="columnheader"><span className="sr-only">Search</span></span>
            <span aria-hidden />
            <span role="columnheader" className={HEAD}>Seen</span>
            <span role="columnheader" tabIndex={0} className={cx(HEAD, 'relative rounded-sm', FOCUS_RING_OFFSET)}>
              Spot
              <HoverLabel label={SPOT_HINT} align="end" />
            </span>
          </div>
          {shown.map((r) => (
            <div role="row" key={`${r.engine}:${r.key}`} data-row="query" data-engine={r.engine} className={cx('grid items-center gap-x-3.5 border-b border-hairline-soft py-2.5', cols)}>
              {both ? (
                <span role="cell" className="flex text-ink-faint">
                  <SourceGlyph source={r.engine} size={13} />
                  <span className="sr-only">{ENGINE_NAME[r.engine]}</span>
                </span>
              ) : null}
              <span role="rowheader" className="min-w-0 truncate text-[14px] text-ink">{r.key}</span>
              <Spark spots={searchTrend(stats[r.engine]!.searchDays, r.key)} />
              <span role="cell" className={cx(NUM, 'text-ink-muted')}>{countWords(r.impressions)}</span>
              <span role="cell" className={cx(NUM, 'font-bold text-ink')}>{r.position === null ? '—' : spot(r.position)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className={cx(MONO_META, 'mt-3')}>No searches named yet.</p>
      )}
      {rows.length > LIST_SHOWN.query ? (
        <button type="button" onClick={() => setAll((v) => !v)} className={cx('mt-2.5 inline-flex items-center gap-1.5 font-space text-[12px] text-ink-muted transition-colors hover:text-ink', FOCUS_RING_OFFSET)}>
          {all ? 'Fewer' : `+ ${countWords(rows.length - LIST_SHOWN.query)} more`}
        </button>
      ) : null}
    </section>
  )
}

/** A search's spot over the period, #1 at the top: rising means climbing. Two readings or more. */
function Spark({ spots }: { spots: number[] }) {
  if (spots.length < 2) return <span aria-hidden />
  const lo = Math.min(...spots), hi = Math.max(...spots), span = hi - lo || 1
  const pts = spots.map((v, i) => `${((i / (spots.length - 1)) * 80 + 2).toFixed(1)},${(((v - lo) / span) * 16 + 3).toFixed(1)}`).join(' ')
  return (
    <svg aria-hidden data-spark viewBox="0 0 84 22" className="h-[22px] w-[84px]">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-ink" />
    </svg>
  )
}

/** FANS SENT BY AI: who an AI assistant sent to the site, by assistant. */
function SentByAi({ ai }: { ai: AiVisit[] }) {
  return (
    <section data-list="ai" className="min-w-0">
      <h2 className={cx(CAPS_LABEL, 'flex items-center gap-2 font-bold text-ink-faint')}>
        <SourceGlyph source="ai" size={12} />
        Fans sent by AI
      </h2>
      <div role="table" aria-label="Fans sent by AI" className="mt-2.5">
        <div role="row" className="grid grid-cols-[minmax(0,1fr)_60px] items-center gap-x-3.5 border-b border-hairline pb-2">
          <span role="columnheader"><span className="sr-only">Assistant</span></span>
          <span role="columnheader" className={HEAD}>Visits</span>
        </div>
        {ai.map((a) => (
          <div role="row" key={a.name} data-row="ai" className="grid grid-cols-[minmax(0,1fr)_60px] items-center gap-x-3.5 border-b border-hairline-soft py-2.5">
            <span role="rowheader" className={cx('truncate text-[14px]', a.visitors ? 'text-ink' : 'text-ink-faint')}>{a.name}</span>
            <span role="cell" className={cx(NUM, a.visitors ? 'font-bold text-ink' : 'text-ink-faint')}>{countWords(a.visitors)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── no numbers ─────────────────────────────────────────────────────────────────────── */

function NoteBlock({ engine, note, onRetry, busy }: { engine: SearchEngineId; note: EngineNote; onRetry: () => void; busy: boolean }) {
  return (
    <div data-note={note.kind} data-note-engine={engine} className="mt-12 flex max-w-[560px] items-start gap-4">
      <span aria-hidden className="grid h-11 w-11 flex-none place-items-center rounded-full border border-hairline text-ink-faint">
        <SourceGlyph source={engine} size={20} />
      </span>
      <div className="min-w-0">
        <h3 className="mt-0.5 text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">{note.title}</h3>
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
