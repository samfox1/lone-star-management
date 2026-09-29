'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { SEO_TEST_DEFS, SEO_TEST_GROUPS } from '@/lib/seo-tests/defs'
import type { StoredSeoRun } from '@/lib/seo-tests/store'
import type { SeoTestHistory, SeoTestId } from '@/lib/seo-tests/types'
import { toast } from '../../../../toast'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { useSeeded } from '../../../_ui/use-seeded'
import { applySeoFixAction, runSeoTestsAction } from '../test-actions'
import { useMounted, useNow } from './clock'
import type { TestTabData } from './load'
import {
  EMPTY_FILTER,
  classifyRunError,
  cooldownEnd,
  countResults,
  groupsFor,
  hostOf,
  matchesFilter,
  oldRunText,
  rowsAreResults,
  runHeadline,
  secondsLeft,
  showStale,
  siteChanged,
  whenText,
  type RunRefusal,
  type TestFilter,
  type TestGroupView,
  type TestRow,
} from './model'
import { DropIcon, QuietRow, rowButtonId, TestRowItem, type RowContext } from './test-row'

/**
 * THE TEST TAB (Sam, 2026-09-28: "This test should be a big part of this project and should be
 * very helpful to users who dont know technology"). Round 2's list, prototypes/
 * seo_variants_20260928_r2.html: the header ("19 of 24 tests pass", "5 need you · tested today
 * at 9:14 PM, after you published"), the filter, TEST AGAIN, and the 24 tests in their four
 * groups; each row opens r5's dropdown under itself (test-row.tsx).
 *
 * Everything shown is a READ of a stored run (lib/seo-tests/store.ts): the counts and the words
 * come from the results (model.ts `runHeadline`, the same helper the Overview uses).
 *
 * THE STATES, each real: tests not on yet (the table isn't there); couldn't read; never tested;
 * testing now (rows keep their last result, dimmed); another run going (a publish's, or a second
 * tab: we look again every few seconds); cool-down; the run failed (now, or the last attempt
 * before a reload); no site connected, and the site didn't answer (each said ONCE, at the top,
 * with no score and no rows to open); none apply; nothing could be checked; a run after a
 * publish that could not confirm the site had caught up (for an hour); a run over 30 days old;
 * a run of an address the artist's site no longer has.
 */

const COPY = {
  off: 'Site tests are coming soon',
  offSub: 'Nothing for you to do.',
  readFailed: 'Couldn’t read the test results',
  never: 'Not tested yet',
  neverSub: `${SEO_TEST_DEFS.length} tests · about a minute`,
  testing: 'Testing your site…',
  testingSub: (s: number) => `Checking your site · ${s} s`,
  busy: 'A test is already running. It will show here when it finishes.',
  cooldown: (s: number) => `You can test again in ${s} s`,
  stale: 'Your site may not have updated yet. Test again in a minute.',
  noSiteNow: 'No site is connected, so there’s nothing to test yet.',
  noSiteRun: 'No site was connected',
  failed: 'The test couldn’t finish. Try again in a minute.',
  lastFailed: (when: string) => `Your last test${when ? `, ${when},` : ''} couldn’t finish. Test again in a minute.`,
  old: (ago: string) => `Last tested ${ago}. Test again to see where you stand now.`,
  moved: (was: string, now: string) => `These results are for ${was}, an old address. Test again to check ${now}.`,
}

/** How often a run someone else started is looked for again, and for how long at most. */
const POLL_MS = 5000
const POLL_FOR_MS = 5 * 60_000

/** The moment a click happens, read in the click's handler (never while rendering). */
const clickedAt = () => Date.now()

export function TestTab({
  artistId,
  data,
  currentSite,
  initialOpen = null,
}: {
  artistId: string
  data: TestTabData
  /** The artist's site as the tests would fetch it now (known.ts `seoSiteOrigin`), or null. */
  currentSite: string | null
  /** A test to open on arrival (the Overview's to-do rows, `?open=`). */
  initialOpen?: SeoTestId | null
}) {
  const router = useRouter()
  const ready = data.state === 'ready' ? data : null
  const [latest, setLatest] = useSeeded<StoredSeoRun | null>(ready ? ready.latest : null)
  const history = ready?.history ?? null
  const serverRunning = !!ready?.running
  const siteConnected = !!currentSite

  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const [startedAt, setStartedAt] = useState(0)
  const [refusal, setRefusal] = useState<RunRefusal | null>(null)
  const [refusedUntil, setRefusedUntil] = useState<number | null>(null)
  const [filterChoice, setFilterChoice] = useState<TestFilter>('all')
  const [openId, setOpenId] = useState<SeoTestId | null>(initialOpen)
  const [fixed, setFixed] = useState<ReadonlySet<SeoTestId>>(new Set())
  const [fixing, setFixing] = useState<SeoTestId | null>(null)
  const fixingRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  // "Already running" clears itself when a refresh shows nothing running any more (React's
  // "adjust state while rendering" pattern: no effect, no painted frame of the stale state).
  const [seenData, setSeenData] = useState(data)
  if (seenData !== data) {
    setSeenData(data)
    if (refusal?.kind === 'busy' && !serverRunning) setRefusal(null)
  }

  const busy = !running && (serverRunning || refusal?.kind === 'busy')
  const cooldownAt = Math.max(refusedUntil ?? 0, cooldownEnd(latest?.ranAt) ?? 0) || null
  const mounted = useMounted()
  // A peek at the clock (no ticking) says whether a cool-down is still on; the second read
  // ticks once a second only while something on screen counts.
  const peek = useNow(false)
  const cooling = peek != null && secondsLeft(cooldownAt, peek) > 0
  const now = useNow(running || busy || cooling)
  const coolS = now == null ? 0 : secondsLeft(cooldownAt, now)
  const canRun = ready != null && siteConnected && !running && !busy && coolS === 0

  // Someone else's run (a publish's, another tab's): look again every few seconds, for a while.
  useEffect(() => {
    if (!busy) return
    const tick = setInterval(() => router.refresh(), POLL_MS)
    const stop = setTimeout(() => clearInterval(tick), POLL_FOR_MS)
    return () => {
      clearInterval(tick)
      clearTimeout(stop)
    }
  }, [busy, router])

  // `?open=`: bring the opened row into view once, under the sticky header (scroll-mt on the row).
  useEffect(() => {
    if (initialOpen) document.getElementById(rowButtonId(initialOpen))?.scrollIntoView?.({ block: 'start' })
  }, [initialOpen])

  async function run() {
    // The latch is a ref (AGENTS.md rule 5): two fast clicks both read the pre-render state.
    if (runningRef.current || !canRun) return
    runningRef.current = true
    setRunning(true)
    setStartedAt(clickedAt())
    setRefusal(null)
    try {
      const res = await runSeoTestsAction(artistId)
      if (res.ok) {
        if (res.run) setLatest(res.run)
        setFixed(new Set())
        router.refresh() // the history dots, and the Overview's next read
      } else {
        const why = classifyRunError(res)
        if (why.kind === 'cooldown') setRefusedUntil(clickedAt() + why.retryInS * 1000)
        else setRefusal(why)
        if (why.kind === 'busy') router.refresh()
      }
    } catch {
      setRefusal({ kind: 'failed', error: COPY.failed })
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }

  async function fix(id: SeoTestId, which: 'apple-storefront') {
    if (fixingRef.current) return
    fixingRef.current = true
    setFixing(id)
    try {
      const res = await applySeoFixAction(artistId, which)
      if (res.ok) {
        setFixed((s) => new Set(s).add(id))
        router.refresh() // the Publish bar rises: the fix is a draft until published
      } else {
        toast(res.error, 'error')
      }
    } catch {
      toast('Couldn’t make that change.', 'error')
    } finally {
      fixingRef.current = false
      setFixing(null)
    }
  }

  /* ── what the header says ── */
  const results = latest?.results ?? []
  const head = latest ? runHeadline(latest) : null
  const showRows = !!head && rowsAreResults(head)
  const counts = countResults(results)
  // A filter whose count went to 0 (a new run) falls back to All rather than stranding the page.
  const filter: TestFilter = filterChoice === 'unknown' && counts.unknown === 0 ? 'all' : filterChoice
  const nowDate = mounted && now != null ? new Date(now) : null
  const when = latest && nowDate ? whenText(latest.ranAt, nowDate) : ''
  const tested = when ? `tested ${when}${latest?.trigger === 'publish' ? ', after you published' : ''}` : null

  let title: ReactNode
  let sub: string | null = null
  if (data.state === 'off') {
    title = COPY.off
    sub = COPY.offSub
  } else if (data.state === 'error') title = COPY.readFailed
  else if (running) {
    title = (
      <>
        <Spinner />
        {COPY.testing}
      </>
    )
    sub = COPY.testingSub(now == null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000)))
  } else if (!latest || !head) {
    title = COPY.never
    sub = COPY.neverSub
  } else {
    // Said ONCE, here: a run with no site, or a site that didn't answer, is one sentence, not
    // 24 rows of "couldn't check" (and never a score).
    title = head.kind === 'no-site' && siteConnected ? COPY.noSiteRun : head.title
    sub = [...head.detail, tested].filter(Boolean).join(' · ') || null
  }

  /* ── the quiet lines under the header, one per thing worth saying ── */
  const nowMs = nowDate?.getTime() ?? null
  const notices: { key: string; node: ReactNode; tone?: 'red'; live?: boolean }[] = []
  if (busy) notices.push({ key: 'busy', node: (<><Spinner small />{COPY.busy}</>), live: true })
  if (!running && refusal?.kind === 'failed') notices.push({ key: 'failed', node: refusal.error, tone: 'red', live: true })
  else if (!running && ready?.lastFailed && (!latest || Date.parse(ready.lastFailed.ranAt) > Date.parse(latest.ranAt))) {
    notices.push({ key: 'lastFailed', node: COPY.lastFailed(nowDate ? whenText(ready.lastFailed.ranAt, nowDate) : ''), tone: 'red' })
  }
  // Not a live region: it changes every second and would be read aloud every second.
  if (!running && !busy && coolS > 0) notices.push({ key: 'cool', node: COPY.cooldown(coolS) })
  if (ready && !siteConnected && head?.kind !== 'no-site') notices.push({ key: 'nosite', node: COPY.noSiteNow })
  if (latest && !running && siteChanged(latest.siteUrl, currentSite)) notices.push({ key: 'moved', node: COPY.moved(hostOf(latest.siteUrl), hostOf(currentSite)) })
  const ago = latest && nowMs != null ? oldRunText(latest.ranAt, nowMs) : null
  if (latest && !running && ago) notices.push({ key: 'old', node: COPY.old(ago) })
  else if (latest && showRows && !running && nowMs != null && showStale(latest, nowMs)) notices.push({ key: 'stale', node: COPY.stale })
  else if (latest && showRows && !running && latest.note) notices.push({ key: 'note', node: latest.note })

  const groups: TestGroupView[] = showRows
    ? groupsFor(results, filter)
    : SEO_TEST_GROUPS.map((g) => ({ id: g.id, label: g.label, pass: 0, applicable: 0, rows: SEO_TEST_DEFS.filter((d) => d.group === g.id).map((def) => ({ def, result: null })) }))

  function chooseFilter(f: TestFilter) {
    setFilterChoice(f)
    // An open row the new filter hides is closed, not left open out of sight (review N7).
    if (openId && !matchesFilter(results.find((r) => r.id === openId) ?? null, f)) setOpenId(null)
  }

  const ctxFor = (row: TestRow): RowContext => ({
    artistId,
    site: latest?.siteUrl ?? '',
    testedWhen: when,
    now: nowDate,
    history: history?.[row.def.id] ?? ([] as SeoTestHistory),
    canRunAll: canRun,
    onRunAll: () => void run(),
    fixed: fixed.has(row.def.id),
    fixing: fixing === row.def.id,
    onFix: (which) => void fix(row.def.id, which),
  })

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (e.key === 'Escape' && openId) {
      e.preventDefault()
      const id = openId
      setOpenId(null)
      document.getElementById(rowButtonId(id))?.focus()
      return
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && target.matches('[data-test-row]')) {
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-test-row]') ?? [])
      const next = rows[rows.indexOf(target) + (e.key === 'ArrowDown' ? 1 : -1)]
      if (next) {
        e.preventDefault()
        next.focus()
      }
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-4 border-b border-hairline pb-[18px]">
        <div className="min-w-0">
          <h2 className="flex items-center gap-3 text-[24px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
          {sub ? <div className="mt-1.5 font-space text-[12px] text-ink-muted">{sub}</div> : null}
        </div>
        {ready ? (
          <div className="flex flex-wrap items-center gap-2.5">
            {showRows ? <FilterSeg filter={filter} onChange={chooseFilter} need={counts.fail} pass={counts.pass} unknown={counts.unknown} /> : null}
            <button
              type="button"
              onClick={() => void run()}
              disabled={!canRun}
              className={cx(
                'inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-ink bg-ink px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-paper transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-60 disabled:hover:opacity-60',
                FOCUS_RING,
                'focus-visible:outline-offset-2',
              )}
            >
              <Icon name="refresh" size={12} aria-hidden="true" className={running ? 'motion-safe:animate-spin' : undefined} />
              {running ? 'Testing…' : latest ? 'Test again' : 'Test now'}
            </button>
          </div>
        ) : data.state === 'error' ? (
          <DropIcon icon="refresh" label="Try again" onClick={() => router.refresh()} />
        ) : null}
      </div>

      {notices.length ? (
        <div className="mt-3 flex flex-col gap-1">
          {notices.map((n) => (
            <div
              key={n.key}
              data-notice={n.key}
              role={n.live ? 'status' : undefined}
              className={cx('flex items-center gap-2 font-space text-[12px]', n.tone === 'red' ? 'text-accent-red' : 'text-ink-muted')}
            >
              {n.node}
            </div>
          ))}
        </div>
      ) : null}

      <div ref={listRef} onKeyDown={onListKey} inert={running || busy || undefined} className={cx('transition-opacity duration-150', (running || busy) && 'opacity-50')}>
        {filter !== 'all' && !groups.length ? (
          <p data-empty-filter="" className="py-8 font-space text-[12px] text-ink-muted">
            {EMPTY_FILTER[filter]}
          </p>
        ) : null}
        {groups.map((g) => (
          <section key={g.id} aria-label={g.label} className="grid grid-cols-1 gap-x-8 border-b border-hairline pb-[34px] pt-2 last:border-b-0 min-[900px]:grid-cols-[150px_minmax(0,1fr)]">
            <h3 className="pt-4 font-space text-[11px] uppercase tracking-[0.1em] text-ink-faint min-[900px]:pt-[22px]">
              {g.label}
              {showRows ? <span className="mt-1.5 block text-[11px] normal-case tracking-[0.04em] text-ink-muted">{`${g.pass} of ${g.applicable}`}</span> : null}
            </h3>
            <div className="flex min-w-0 flex-col pt-2">
              {g.rows.map((row) =>
                showRows ? (
                  <TestRowItem key={row.def.id} row={row} open={openId === row.def.id} onToggle={() => setOpenId((o) => (o === row.def.id ? null : row.def.id))} ctx={ctxFor(row)} />
                ) : (
                  <QuietRow key={row.def.id} row={row} />
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function Spinner({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx('inline-block flex-none rounded-full border-[1.6px] border-hairline border-t-ink motion-safe:animate-spin', small ? 'h-[11px] w-[11px]' : 'h-[14px] w-[14px]')}
    />
  )
}

/**
 * All / Needs you / Passing / Couldn't check, with their counts (r2's segmented control plus one).
 * Every scored row is in exactly one filter; "Couldn't check" shows only when there is one.
 */
function FilterSeg({ filter, onChange, need, pass, unknown }: { filter: TestFilter; onChange: (f: TestFilter) => void; need: number; pass: number; unknown: number }) {
  const opts: { f: TestFilter; label: string; n?: number }[] = [
    { f: 'all', label: 'All' },
    { f: 'need', label: 'Needs you', n: need },
    { f: 'pass', label: 'Passing', n: pass },
    ...(unknown ? [{ f: 'unknown' as const, label: 'Couldn’t check', n: unknown }] : []),
  ]
  return (
    <div role="group" aria-label="Show" className="flex flex-wrap gap-0.5 rounded-[10px] border border-hairline bg-surface p-[3px]">
      {opts.map((o) => (
        <button
          key={o.f}
          type="button"
          aria-pressed={filter === o.f}
          aria-label={o.n !== undefined ? `${o.label} ${o.n}` : undefined}
          onClick={() => onChange(o.f)}
          className={cx(
            'whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[12px] font-medium transition-colors',
            FOCUS_RING,
            filter === o.f ? 'bg-paper text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
          {o.n !== undefined ? <em className="ml-1 font-space text-[11px] not-italic text-ink-faint">{o.n}</em> : null}
        </button>
      ))}
    </div>
  )
}
