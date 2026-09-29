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
import { whenText } from '../test/model'
import { seoTabSeg } from '../sections'
import { PlatformMark } from '../_ui/mark'
import { TestAgain } from './test-again'
import {
  CHANGE_WORD,
  STALE_WORDS,
  TODO,
  failedWords,
  oldWords,
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

/** Moments and to-dos shown before "Show more": the lists stay short (Sam: "I dont want the
 *  pages to be cluttered"; the r2 mock shows five to-dos). */
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
  const [allTodo, setAllTodo] = useState(false)

  const h = view.headline
  const sub = headlineSub(h)
  const dot: Dot = h.kind !== 'run' ? 'hollow' : (h.run.kind === 'score' && h.fail) || h.run.kind === 'unreachable' ? 'red' : h.run.kind === 'score' ? 'ink' : 'hollow'
  const events = view.events ?? []
  const shown = all ? events : events.slice(0, FIRST)
  const latestTest = shown.find((e) => e.kind === 'test')
  // "See the tests · Test again" sit under the newest test on the line (r2); with none there
  // (never tested, an old run, the site moved), under Now.
  const actions = (
    <span className="flex flex-wrap items-center gap-x-5 gap-y-1">
      {h.kind === 'never' ? null : <GoLink href={testHref(artistId)} label="See the tests" />}
      <TestAgain artistId={artistId} can={view.test.can} cooldownEnd={view.test.cooldownEnd} label={h.kind === 'never' ? 'Test now' : 'Test again'} />
    </span>
  )
  const actionsUnderNow = h.kind !== 'off' && h.kind !== 'noSite' && h.kind !== 'error' && !latestTest

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
          {view.stale ? <div className="mt-[3px] text-[14px] text-ink-muted">{STALE_WORDS}</div> : null}
          {view.oldRun ? <div className="mt-[3px] text-[14px] text-ink-muted">{oldWords(view.oldRun)}</div> : null}
          {view.failedAt ? <div className="mt-[3px] text-[14px] text-accent-red">{failedWords(now ? whenText(view.failedAt, now) : '')}</div> : null}
          {view.todo.length ? (
            <ul className="mt-2" aria-label="What needs you">
              {(allTodo ? view.todo : view.todo.slice(0, FIRST)).map((t) => (
                <li key={t.id}>
                  <TodoRow artistId={artistId} id={t.id} value={t.value} />
                </li>
              ))}
            </ul>
          ) : null}
          {!allTodo && view.todo.length > FIRST ? (
            <button type="button" onClick={() => setAllTodo(true)} className={cx('mt-1 w-max py-1 font-space text-[12px] text-ink-muted hover:text-ink', FOCUS_RING)}>
              {`Show ${view.todo.length - FIRST} more`}
            </button>
          ) : null}
          {view.unknown.length ? (
            <ul className="mt-2" aria-label="Couldn’t check">
              {view.unknown.map((t) => (
                <li key={t.id}>
                  <UnknownRow artistId={artistId} id={t.id} why={t.why} />
                </li>
              ))}
            </ul>
          ) : null}
          {actionsUnderNow ? <div className="mt-2">{actions}</div> : null}
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
            <EventBody e={e} actions={e === latestTest ? actions : null} />
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
      {/* On a phone the value and the tag wrap under the title rather than vanish. */}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-0.5">
        <span className="min-w-0 flex-1 basis-full text-[14px] font-medium sm:basis-auto sm:truncate">{todo.title}</span>
        {value ? <span className="max-w-[220px] truncate font-space text-[12px] text-ink-faint">{value}</span> : null}
        {def?.outside ? <span className="whitespace-nowrap rounded-full border border-hairline px-[7px] py-0.5 font-space text-[10px] uppercase tracking-[0.06em] text-ink-faint">Outside Tapir</span> : null}
      </span>
      <Icon name="chevronRight" size={14} aria-hidden="true" className="flex-none text-ink-faint opacity-60 group-hover/todo:text-ink group-hover/todo:opacity-100" />
    </Link>
  )
}

/** A test that couldn't be checked: said as such, with WHY in its own words (one line; the
 *  whole of it on its row, where this links). It blames nobody, so it is never a to-do. */
function UnknownRow({ artistId, id, why }: { artistId: string; id: SeoTestId; why: string }) {
  return (
    <Link
      href={todoHref(artistId, id)}
      className={cx('group/todo -mx-3 flex items-center gap-4 rounded-xl px-3 py-[7px] text-ink-muted transition-colors duration-150 hover:bg-surface hover:text-ink', FOCUS_RING)}
    >
      <StatusMark status="unknown" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5">
          <span className="min-w-0 flex-1 basis-full text-[14px] sm:basis-auto sm:truncate">{NAME[id]}</span>
          <span className="font-space text-[12px] text-ink-faint">couldn’t check</span>
        </span>
        {why ? <span className="truncate text-[13px] text-ink-faint">{why}</span> : null}
      </span>
      <Icon name="chevronRight" size={14} aria-hidden="true" className="flex-none text-ink-faint opacity-60 group-hover/todo:text-ink group-hover/todo:opacity-100" />
    </Link>
  )
}

/** A publish, a test, or both as one moment, and what changed. */
function EventBody({ e, actions }: { e: OverviewEvent; actions: ReactNode }) {
  const changes = e.kind === 'test' ? changesShown(e.test.changes) : null
  return (
    <>
      <h3 className="text-[16px] font-semibold text-ink">{eventTitle(e)}</h3>
      <div className="mt-[3px] text-[14px] text-ink-muted">{eventLine(e)}</div>
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
      {actions ? <div className="mt-1.5">{actions}</div> : null}
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
