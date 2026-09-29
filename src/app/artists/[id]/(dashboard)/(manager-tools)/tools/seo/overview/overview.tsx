'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import type { SeoTestId } from '@/lib/seo-tests/types'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { useMounted, useNow } from '../test/clock'
import { rowButtonId, StatusMark } from '../test/test-row'
import { seoTabSeg } from '../sections'
import { PlatformMark } from '../_ui/mark'
import {
  CHANGE_WORD,
  TODO,
  changesShown,
  countText,
  eventLine,
  eventTitle,
  headlineSub,
  headlineText,
  whenParts,
  type OverviewEvent,
  type OverviewView,
  type TodoMark,
} from './model'

/**
 * THE SEO / GEO OVERVIEW (Sam, 2026-09-28: round 2's "Overview 3 · Timeline",
 * prototypes/seo_variants_20260928_r2.html). One column of moments on a thin line:
 *
 *   NOW            what needs you, most important first; each row opens its test on the Test
 *                  tab with its dropdown open
 *   …then          what really happened: publishes, test runs and what changed between runs
 *   LAST 30 DAYS   visitors from search engines and from AI assistants
 *
 * Every line is a read (overview/model.ts). There is no weekly test yet, so none is drawn.
 */

/** Moments shown before "Show more": the list stays short (Sam: "I dont want the pages to be
 *  cluttered"). */
const FIRST = 5

const testHref = (artistId: string) => `/artists/${artistId}/${seoTabSeg('test')}`

/** Where a to-do goes: its own row on the Test tab, opened (`?open=`, read by test/page.tsx)
 *  and scrolled to (the row's id, test-row.tsx `rowButtonId`). */
export function todoHref(artistId: string, id: SeoTestId): string {
  return `${testHref(artistId)}?open=${id}#${rowButtonId(id)}`
}

const NAME = Object.fromEntries(SEO_TEST_DEFS.map((d) => [d.id, d.name])) as Record<SeoTestId, string>

export function SeoOverview({ artistId, view }: { artistId: string; view: OverviewView }) {
  const mounted = useMounted()
  const nowMs = useNow(false)
  const now = mounted && nowMs != null ? new Date(nowMs) : null
  const [all, setAll] = useState(false)

  const h = view.headline
  const sub = headlineSub(h)
  const dot: Dot = h.kind === 'needs' ? 'red' : h.kind === 'clear' ? 'ink' : 'hollow'
  const events = view.events ?? []
  const shown = all ? events : events.slice(0, FIRST)
  const latestTest = events.find((e) => e.kind === 'test')

  return (
    <div className="mx-auto max-w-[780px] pt-1">
      <ol className="relative mt-1.5 before:absolute before:bottom-2.5 before:left-[79px] before:top-2.5 before:w-px before:bg-hairline sm:before:left-[127px]">
        <Moment when={<>Now</>} dot={dot}>
          <h2 className="text-[17px] font-semibold tracking-[-0.005em] text-ink">{headlineText(h)}</h2>
          {sub ? <div className="mt-[3px] text-[14px] text-ink-muted">{sub}</div> : null}
          {view.running ? (
            <div className="mt-[3px] flex items-center gap-2 text-[14px] text-ink-muted" aria-live="polite">
              <span aria-hidden="true" className="inline-block h-[11px] w-[11px] flex-none rounded-full border-[1.6px] border-hairline border-t-ink motion-safe:animate-spin" />
              A test is running now.
            </div>
          ) : null}
          {view.stale ? <div className="mt-[3px] text-[14px] text-ink-muted">Your site may not have caught up with your last publish.</div> : null}
          {view.todo.length ? (
            <ul className="mt-2" aria-label="What needs you">
              {view.todo.map((t) => (
                <li key={t.id}>
                  <TodoRow artistId={artistId} id={t.id} value={t.value} />
                </li>
              ))}
            </ul>
          ) : null}
          {h.kind === 'never' ? (
            <div className="mt-2">
              <GoLink href={testHref(artistId)} label="Go to the tests" />
            </div>
          ) : null}
        </Moment>

        {view.events === null && view.lastPublishedAt ? (
          <Moment when={<When iso={view.lastPublishedAt} now={now} />} dot="ink">
            <h3 className="text-[16px] font-semibold text-ink">You published.</h3>
          </Moment>
        ) : null}
        {view.events === null && h.kind !== 'off' ? (
          <Moment when={null} dot="hollow">
            <h3 className="text-[16px] font-medium text-ink-muted">Couldn’t read what happened lately.</h3>
          </Moment>
        ) : null}

        {shown.map((e) => (
          <Moment key={`${e.kind}-${e.at}`} when={<When iso={e.at} now={now} />} dot={regressed(e) ? 'red' : 'ink'} testid={e.kind}>
            <EventBody artistId={artistId} e={e} latest={e === latestTest} />
          </Moment>
        ))}
        {!all && events.length > FIRST ? (
          <li className="grid grid-cols-[64px_30px_minmax(0,1fr)] sm:grid-cols-[112px_30px_minmax(0,1fr)]">
            <span />
            <span />
            <button type="button" onClick={() => setAll(true)} className={cx('w-max py-1 font-space text-[12px] text-ink-muted hover:text-ink', FOCUS_RING)}>
              {`Show ${events.length - FIRST} more`}
            </button>
          </li>
        ) : null}

        <Moment when={<>Last 30 days</>} dot="hollow" testid="visits">
          <h3 className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[16px] font-semibold text-ink">
            <span>
              {countText(view.visits.search)} <span className="font-normal text-ink-muted">visitors from search engines</span>
            </span>
            <span>
              {countText(view.visits.ai)} <span className="font-normal text-ink-muted">from AI assistants</span>
            </span>
          </h3>
          <div className="mt-2">
            <GoLink href={`/artists/${artistId}`} label="Analytics" icon="analytics" />
          </div>
        </Moment>
      </ol>
    </div>
  )
}

type Dot = 'red' | 'ink' | 'hollow'

/** Red only for news that needs you: a run where a test went from fine to "needs you" (r2's
 *  red dot). A run that merely still has misses is ink: the Now line already counts those. */
const regressed = (e: OverviewEvent) => e.kind === 'test' && !!e.test.changes?.some((c) => c.to === 'fail')

const DOT: Record<Dot, string> = {
  red: 'bg-accent-red',
  ink: 'bg-ink',
  hollow: 'border-[1.5px] border-ink-faint bg-paper',
}

/** One moment on the line: when · dot · what. */
function Moment({ when, dot, children, testid }: { when: ReactNode; dot: Dot; children: ReactNode; testid?: string }) {
  return (
    <li data-moment={testid} className="relative grid grid-cols-[64px_30px_minmax(0,1fr)] py-3.5 sm:grid-cols-[112px_30px_minmax(0,1fr)]">
      <div className="pt-[3px] text-right font-space text-[10px] uppercase leading-[1.5] tracking-[0.1em] text-ink-faint">{when}</div>
      <div className="flex justify-center pt-1.5">
        <i aria-hidden="true" data-dot={dot} className={cx('relative z-[1] block h-[9px] w-[9px] rounded-full shadow-[0_0_0_4px_var(--color-paper)]', DOT[dot])} />
      </div>
      <div className="min-w-0">{children}</div>
    </li>
  )
}

/** "TODAY / 9:14 PM", in the manager's own zone: nothing until the browser has mounted
 *  (clock.ts), so the server's zone never shows. */
function When({ iso, now }: { iso: string; now: Date | null }) {
  const p = now ? whenParts(iso, now) : null
  if (!p) return null
  return (
    <>
      {p.day}
      <br />
      {p.time}
    </>
  )
}

function Mark({ mark }: { mark: TodoMark }) {
  return 'icon' in mark ? <Icon name={mark.icon} size={17} /> : <PlatformMark slug={mark.platform} size={16} />
}

/** A to-do: its mark, what to do, its value, OUTSIDE TAPIR when the fix is elsewhere. The
 *  whole row is the link to its test. */
function TodoRow({ artistId, id, value }: { artistId: string; id: SeoTestId; value: string }) {
  const def = SEO_TEST_DEFS.find((d) => d.id === id)
  const todo = TODO[id]
  return (
    <Link
      href={todoHref(artistId, id)}
      className={cx(
        'group/todo -mx-3 flex items-center gap-4 rounded-xl px-3 py-[9px] text-ink transition-[background-color,transform] duration-150 hover:scale-[1.01] hover:bg-surface motion-reduce:hover:scale-100',
        FOCUS_RING,
      )}
    >
      <span aria-hidden="true" className="flex w-5 flex-none justify-center text-ink">
        <Mark mark={todo.mark} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{todo.title}</span>
      {value ? <span className="hidden max-w-[220px] truncate font-space text-[12px] text-ink-faint sm:inline">{value}</span> : null}
      {def?.outside ? (
        <span className="hidden whitespace-nowrap rounded-full border border-hairline px-[7px] py-0.5 font-space text-[10px] uppercase tracking-[0.06em] text-ink-faint sm:inline">Outside Tapir</span>
      ) : null}
      <Icon name="chevronRight" size={14} aria-hidden="true" className="flex-none text-ink-faint opacity-60 group-hover/todo:text-ink group-hover/todo:opacity-100" />
    </Link>
  )
}

/** A publish, a test, or both as one moment, and what changed. */
function EventBody({ artistId, e, latest }: { artistId: string; e: OverviewEvent; latest: boolean }) {
  const changes = e.kind === 'test' ? changesShown(e.test.changes) : null
  return (
    <>
      <h3 className="text-[16px] font-semibold text-ink">{eventTitle(e)}</h3>
      <div className="mt-[3px] text-[14px] text-ink-muted">{eventLine(e)}</div>
      {e.kind === 'test' && e.test.siteFresh === false ? <div className="text-[14px] text-ink-muted">Your site hadn’t caught up with the publish yet.</div> : null}
      {changes && changes.shown.length ? (
        <ul className="mt-1.5 flex flex-col gap-1" aria-label="What changed">
          {changes.shown.map((c) => (
            <li key={c.id} className="flex items-center gap-2.5 text-[14px] text-ink">
              <StatusMark status={c.to} />
              <span className="min-w-0 truncate">{NAME[c.id]}</span>
              <span className="whitespace-nowrap font-space text-[11px] text-ink-faint">{CHANGE_WORD[c.to]}</span>
            </li>
          ))}
          {changes.more ? <li className="pl-[30px] font-space text-[11px] text-ink-faint">{`and ${changes.more} more`}</li> : null}
        </ul>
      ) : changes ? (
        <div className="text-[14px] text-ink-muted">Nothing changed since the test before.</div>
      ) : null}
      {latest ? (
        <div className="mt-1.5">
          <GoLink href={testHref(artistId)} label="See the tests" />
        </div>
      ) : null}
    </>
  )
}

/** r2's quiet link: a small glyph and a mono word, nothing boxed. */
function GoLink({ href, label, icon = 'chevronRight' }: { href: string; label: string; icon?: 'chevronRight' | 'analytics' }) {
  return (
    <Link href={href} className={cx('inline-flex items-center gap-1.5 rounded font-space text-[12px] text-ink-muted transition-colors hover:text-accent', FOCUS_RING)}>
      <Icon name={icon} size={13} aria-hidden="true" />
      {label}
    </Link>
  )
}
