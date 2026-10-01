'use client'

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon, type IconName } from '@/components/ui/icons'
import type { StoredSeoRun } from '@/lib/seo-tests/store'
import type { SeoTestId } from '@/lib/seo-tests/types'
import { toast } from '../../../../toast'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { useSeeded } from '../../../_ui/use-seeded'
import { applySeoFixAction, runSeoTestsAction } from '../test-actions'
import { useMounted, useNow } from './clock'
import { CrawlSection } from './crawl-section'
import type { TestTabData } from './load'
import {
  classifyRunError,
  clockText,
  cooldownEnd,
  countResults,
  groupsFor,
  hostOf,
  oldRunText,
  rowsAreResults,
  runHeadline,
  secondsLeft,
  showStale,
  siteChanged,
  whenText,
  type RunRefusal,
  type TestRow,
} from './model'
import { PageScan, StartArt, VisitingAs, useReducedMotion } from './scan-art'
import { rowButtonId, TestRowItem, type RowContext } from './test-row'

/**
 * THE AI VISIBILITY TEST (Sam, 2026-09-28: "This test should be a big part of this project and
 * should be very helpful to users who dont know technology"). Round 10's page, prototypes/
 * seo_variants_20260929_r10.html: ONE centred column that swaps its top through three steps.
 *
 *   START    never tested: the title in caps, a page drawing with a magnifying glass wandering
 *            over it (scan-art.tsx), one line, and a quiet "Test my site" link. No big buttons.
 *   RUNNING  our run, or one the server says is going (a publish's, another tab's): the page
 *            being scanned beside who we visit as, and a small clock. No heading, no list, and
 *            no ticks: the drawing is decoration, never progress.
 *   DONE     a stored run: the headline (model.ts `runHeadline`),
 *            when it ran, "Test again", the quiet notices, the outside bios line (how many the
 *            Profiles tab asks to look at; never in the score), then the four groups and their rows
 *            (test-row.tsx). When a run lands in this session the rows rise in one after another
 *            and their marks pop; a page load shows them still.
 *
 * Everything shown is a READ of a stored run (lib/seo-tests/store.ts). THE OTHER STATES, each
 * real: tests not on yet (the table isn't there); couldn't read; cool-down; the run failed (now,
 * or the last attempt before a reload); no site connected, and the site didn't answer (each said
 * ONCE, in the header, with no score and no rows); none apply; a run after a publish that could
 * not confirm the site had caught up (for an hour); a run over 30 days old; a run of an address
 * the artist's site no longer has.
 */

const COPY = {
  title: 'AI visibility test',
  lede: 'See how Google, ChatGPT and other AI tools see your site.',
  go: 'Test my site',
  again: 'Test again',
  bios: (n: number) => `Outside bios · ${n} to check`,
  retry: 'Try again',
  off: 'Site tests are coming soon',
  offSub: 'Nothing for you to do.',
  readFailed: 'Couldn’t read the test results',
  testing: 'Testing your site…',
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

/** A block coming into view: up 6px and in. */
const RISE: Keyframe[] = [
  { opacity: 0, transform: 'translateY(6px)' },
  { opacity: 1, transform: 'none' },
]
/** A status mark arriving: small to full size, with a little overshoot (the easing). */
const POP: Keyframe[] = [
  { opacity: 0, transform: 'scale(0.2)' },
  { opacity: 1, transform: 'scale(1)' },
]
/** How far apart the rows rise in, one after another. */
const STAGGER_MS = 45

/** The column everything sits in, centred in the page. */
const COLUMN = 'mx-auto w-full max-w-[660px] pt-7'
/** Before and during a run, the block sits in the middle of the screen. */
const MIDDLE = 'flex min-h-[max(420px,calc(100vh-260px))] flex-col items-center justify-center text-center'
const EYEBROW = 'font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint'
const HEADLINE = 'mt-2.5 text-[30px] font-semibold leading-[1.12] tracking-[-0.025em] text-ink max-[560px]:text-[26px]'

type View = 'off' | 'error' | 'start' | 'running' | 'done'
type Notice = { key: string; text: string; tone?: 'red'; live?: boolean }

export function TestTab({
  artistId,
  data,
  currentSite,
  artistName = '',
  initialOpen = null,
  biosToCheck = 0,
}: {
  artistId: string
  data: TestTabData
  /** The artist's site as the tests would fetch it now (known.ts `seoSiteOrigin`), or null. */
  currentSite: string | null
  /** For the start drawing's page (the words under the magnifying glass). */
  artistName?: string
  /** A test to open on arrival (`?open=`). */
  initialOpen?: SeoTestId | null
  /** Outside bios the Profiles tab asks to look at (profiles/bio-rows.tsx). Not a test: it
   *  never changes the score, and 0 shows nothing. */
  biosToCheck?: number
}) {
  const router = useRouter()
  const ready = data.state === 'ready' ? data : null
  const [latest, setLatest] = useSeeded<StoredSeoRun | null>(ready ? ready.latest : null)
  const serverRun = ready?.running ?? null
  const siteConnected = !!currentSite
  const calm = useReducedMotion()

  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const [startedAt, setStartedAt] = useState(0)
  const [refusal, setRefusal] = useState<RunRefusal | null>(null)
  const [refusedUntil, setRefusedUntil] = useState<number | null>(null)
  const [openId, setOpenId] = useState<SeoTestId | null>(initialOpen)
  const [fixed, setFixed] = useState<ReadonlySet<SeoTestId>>(new Set())
  const [fixing, setFixing] = useState<SeoTestId | null>(null)
  const fixingRef = useRef(false)
  const topRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // "Already running" clears itself when a refresh shows nothing running any more (React's
  // "adjust state while rendering" pattern: no effect, no painted frame of the stale state).
  const [seenData, setSeenData] = useState(data)
  if (seenData !== data) {
    setSeenData(data)
    if (refusal?.kind === 'busy' && !serverRun) setRefusal(null)
  }

  const busy = !running && (!!serverRun || refusal?.kind === 'busy')
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
    setOpenId(null)
    try {
      const res = await runSeoTestsAction(artistId)
      if (res.ok) {
        if (res.run) setLatest(res.run)
        setFixed(new Set())
        router.refresh() // the next read, and the Publish bar
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

  /* ── which step the page is on ── */
  const results = latest?.results ?? []
  const head = latest ? runHeadline(latest) : null
  const view: View = data.state === 'off' ? 'off' : data.state === 'error' ? 'error' : running || busy ? 'running' : !latest || !head ? 'start' : 'done'
  const showRows = view === 'done' && !!head && rowsAreResults(head)

  // A run that lands while this page is open (ours, or one we waited for) is revealed: its rows
  // rise in. The run on screen when the page loaded is not.
  const [firstRunId] = useState(() => latest?.id ?? null)
  const revealId = latest && latest.id !== firstRunId ? latest.id : null
  const revealedRef = useRef<string | null>(null)
  const shownViewRef = useRef<View>(view)

  // Before paint, so nothing flashes in its final place first. Web Animations only: jsdom and
  // reduced motion simply show everything where it ends.
  useLayoutEffect(() => {
    if (shownViewRef.current !== view) {
      shownViewRef.current = view
      if (!calm) topRef.current?.animate?.(RISE, { duration: 300, easing: 'ease' })
    }
    if (!revealId || !showRows || revealedRef.current === revealId) return
    revealedRef.current = revealId
    if (calm) return
    const items = listRef.current?.querySelectorAll<HTMLElement>('[data-crawl-item], [data-test-item]') ?? []
    items.forEach((el, i) => {
      el.animate?.(RISE, { duration: 350, delay: i * STAGGER_MS, easing: 'ease', fill: 'backwards' })
      el.querySelector<HTMLElement>('[data-status-mark]')?.animate?.(POP, { duration: 400, delay: i * STAGGER_MS + 120, easing: 'cubic-bezier(.3,1.5,.5,1)', fill: 'backwards' })
    })
  }, [view, revealId, showRows, calm])

  /* ── what the header says ── */
  const counts = countResults(results)
  const nowDate = mounted && now != null ? new Date(now) : null
  const when = latest && nowDate ? whenText(latest.ranAt, nowDate) : ''
  const tested = when ? `tested ${when}${latest?.trigger === 'publish' ? ', after you published' : ''}` : null
  const title = head ? (head.kind === 'no-site' && siteConnected ? COPY.noSiteRun : head.title) : ''
  // "4 need you" in red (runHeadline puts it first when there is one), then the rest, then when.
  const detail: { text: string; red: boolean }[] = head
    ? [...head.detail.map((text, i) => ({ text, red: head.kind === 'score' && i === 0 && counts.fail > 0 })), ...(tested ? [{ text: tested, red: false }] : [])]
    : []

  // The running clock: from our click, or from when the server says the other run started.
  const runFrom = running ? startedAt : serverRun ? Date.parse(serverRun.ranAt) : NaN
  const clock = now != null && Number.isFinite(runFrom) ? clockText((now - runFrom) / 1000) : null

  /* ── the quiet lines under the header, one per thing worth saying ── */
  const nowMs = nowDate?.getTime() ?? null
  const notices: Notice[] = []
  if (busy) notices.push({ key: 'busy', text: COPY.busy, live: true })
  if (!running && refusal?.kind === 'failed') notices.push({ key: 'failed', text: refusal.error, tone: 'red', live: true })
  else if (!running && ready?.lastFailed && (!latest || Date.parse(ready.lastFailed.ranAt) > Date.parse(latest.ranAt))) {
    notices.push({ key: 'lastFailed', text: COPY.lastFailed(nowDate ? whenText(ready.lastFailed.ranAt, nowDate) : ''), tone: 'red' })
  }
  // Not a live region: it changes every second and would be read aloud every second.
  if (!running && !busy && coolS > 0) notices.push({ key: 'cool', text: COPY.cooldown(coolS) })
  if (ready && !siteConnected && head?.kind !== 'no-site') notices.push({ key: 'nosite', text: COPY.noSiteNow })
  if (latest && !running && siteChanged(latest.siteUrl, currentSite)) notices.push({ key: 'moved', text: COPY.moved(hostOf(latest.siteUrl), hostOf(currentSite)) })
  const ago = latest && nowMs != null ? oldRunText(latest.ranAt, nowMs) : null
  if (latest && !running && ago) notices.push({ key: 'old', text: COPY.old(ago) })
  else if (latest && showRows && nowMs != null && showStale(latest, nowMs)) notices.push({ key: 'stale', text: COPY.stale })
  else if (latest && showRows && latest.note) notices.push({ key: 'note', text: latest.note })

  const ctxFor = (row: TestRow): RowContext => ({
    artistId,
    site: latest?.siteUrl ?? '',
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

  // The drawings' page: the site's own address (or a stand-in when there is none) and name.
  const host = hostOf(currentSite) || 'yoursite.com'

  if (view === 'off' || view === 'error') {
    return (
      <div className={COLUMN}>
        <div ref={topRef} className={MIDDLE}>
          <div className={EYEBROW}>{COPY.title}</div>
          <h2 className={HEADLINE}>{view === 'off' ? COPY.off : COPY.readFailed}</h2>
          {view === 'off' ? (
            <p className="mt-2 font-space text-[12px] text-ink-muted">{COPY.offSub}</p>
          ) : (
            <div className="mt-[18px]">
              <QuietLink icon="refresh" label={COPY.retry} muted onClick={() => router.refresh()} />
            </div>
          )}
        </div>
      </div>
    )
  }

  if (view === 'start') {
    return (
      <div className={COLUMN}>
        <div ref={topRef} className={MIDDLE}>
          <h2 className="mb-[30px] font-space text-[26px] font-bold uppercase leading-[1.1] tracking-[0.12em] text-ink">{COPY.title}</h2>
          <StartArt host={host} name={artistName.trim() || 'Your name'} />
          <p className="mx-auto max-w-[60ch] text-[15px] leading-normal text-ink-muted">{COPY.lede}</p>
          <div className="mt-[18px] flex justify-center">
            {siteConnected ? (
              <QuietLink icon="search" label={COPY.go} chevron onClick={() => void run()} disabled={!canRun} />
            ) : (
              <p className="font-space text-[12px] text-ink-muted">{COPY.noSiteNow}</p>
            )}
          </div>
          {/* "No site" is said once, in place of the link. */}
          <Notices list={notices.filter((n) => n.key !== 'nosite')} />
        </div>
      </div>
    )
  }

  if (view === 'running') {
    return (
      <div className={COLUMN}>
        <div ref={topRef} className={MIDDLE}>
          <div className="flex flex-wrap items-center justify-center gap-14 max-[560px]:gap-7">
            <PageScan host={host} />
            <VisitingAs />
          </div>
          {clock ? <div className="mt-[22px] font-space text-[12px] text-ink-faint">{clock}</div> : null}
          {/* The drawings say nothing to a screen reader; this does. Busy says it in its line. */}
          {busy ? <Notices list={notices.filter((n) => n.key === 'busy')} /> : <p role="status" className="sr-only">{COPY.testing}</p>}
        </div>
      </div>
    )
  }

  const groups = showRows ? groupsFor(results, 'all') : []
  return (
    <div className={COLUMN}>
      <header ref={topRef} className="flex min-h-[200px] flex-col items-center justify-center text-center">
        <div className={EYEBROW}>{COPY.title}</div>
        <h2 className={HEADLINE}>{title}</h2>
        {detail.length ? (
          <div className="mt-2 font-space text-[12px] text-ink-muted">
            {detail.map((d, i) => (
              <span key={d.text}>
                {i > 0 ? ' · ' : null}
                <span className={d.red ? 'text-accent-red' : undefined}>{d.text}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-[18px] flex justify-center">
          <QuietLink icon="refresh" label={COPY.again} muted onClick={() => void run()} disabled={!canRun} />
        </div>
        <Notices list={notices} />
        {biosToCheck > 0 ? (
          <Link
            href={`/artists/${artistId}/tools/seo/profiles`}
            data-bios-line=""
            className={cx('group/bios mt-3 inline-flex items-center gap-1.5 rounded-md font-space text-[12px] text-ink-muted transition-colors hover:text-accent', FOCUS_RING, 'focus-visible:outline-offset-2')}
          >
            {COPY.bios(biosToCheck)}
            <Icon name="chevronRight" size={13} aria-hidden="true" className="transition-transform duration-200 group-hover/bios:translate-x-[3px]" />
          </Link>
        ) : null}
      </header>

      {showRows ? (
        <div ref={listRef} onKeyDown={onListKey} className="mt-2">
          {/* How crawlers see your site: first, above the four groups (round 11). */}
          <CrawlSection crawl={latest?.crawl} site={latest?.siteUrl ?? ''} />
          {groups.map((g) => (
            <section key={g.id} aria-label={g.label}>
              <div className="mb-0.5 mt-[26px] flex items-baseline justify-between gap-4">
                <h3 className={cx(EYEBROW, 'font-normal')}>{g.label}</h3>
                <span className="font-space text-[11px] text-ink-faint">{`${g.pass} of ${g.applicable}`}</span>
              </div>
              <div className="-mx-3">
                {g.rows.map((row, i) => (
                  <TestRowItem
                    key={row.def.id}
                    row={row}
                    open={openId === row.def.id}
                    // No line against an open row: it is its own grey block.
                    divider={i > 0 && openId !== row.def.id && openId !== g.rows[i - 1].def.id}
                    onToggle={() => setOpenId((o) => (o === row.def.id ? null : row.def.id))}
                    ctx={ctxFor(row)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** The quiet lines, centred under the header. */
function Notices({ list }: { list: Notice[] }) {
  if (!list.length) return null
  return (
    <div className="mt-3 flex flex-col items-center gap-1 text-center">
      {list.map((n) => (
        <p key={n.key} data-notice={n.key} role={n.live ? 'status' : undefined} className={cx('font-space text-[12px]', n.tone === 'red' ? 'text-accent-red' : 'text-ink-muted')}>
          {n.text}
        </p>
      ))}
    </div>
  )
}

/**
 * The page's only controls for a run: a plain text link in Space Mono, never a boxed button
 * (Sam, 2026-09-29). "Test my site" is ink with a chevron that nudges right on hover; "Test
 * again" and "Try again" are the same link in grey. Hover turns either blue.
 */
function QuietLink({
  icon,
  label,
  onClick,
  disabled = false,
  muted = false,
  chevron = false,
}: {
  icon: IconName
  label: string
  onClick: () => void
  disabled?: boolean
  muted?: boolean
  chevron?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'group/go inline-flex items-center gap-2 rounded-md px-0.5 py-1.5 font-space text-[13px] transition-colors hover:text-accent',
        muted ? 'text-ink-muted disabled:hover:text-ink-muted' : 'text-ink disabled:hover:text-ink',
        'disabled:cursor-default disabled:opacity-50',
        FOCUS_RING,
        'focus-visible:outline-offset-2',
      )}
    >
      <Icon name={icon} size={15} aria-hidden="true" />
      {label}
      {chevron ? <Icon name="chevronRight" size={15} aria-hidden="true" className="transition-transform duration-200 group-hover/go:translate-x-[3px] group-disabled/go:translate-x-0" /> : null}
    </button>
  )
}
