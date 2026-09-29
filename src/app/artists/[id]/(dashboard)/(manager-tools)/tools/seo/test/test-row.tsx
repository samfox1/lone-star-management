'use client'

import { Fragment, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { Icon, type IconName } from '@/components/ui/icons'
import type { SeoTestHistory, SeoTestStatus } from '@/lib/seo-tests/types'
import { HoverLabel } from '../../../_ui/row-icon'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { dotText, editHref, leadOf, safeHttps, sentenceOf, STATUS_WORD, type TestRow } from './model'

/**
 * ONE TEST: its row, and the DROPDOWN that opens under it (Sam, 2026-09-28: round 2's list, with
 * round 5's "inline dropdown under the row" for the detail; no modal, no side panel). The row is
 * the r2 row: status mark · the test's name · OUTSIDE TAPIR / Tour / Music tags · its short
 * value · chevron. The dropdown is r5's: the result sentence behind a bold lead, one line on why
 * it matters, "good looks like" / "what to do" for a miss, a row of ICON actions with hover
 * labels (Sam: "I dont like the white pill form buttons to take action... I like icons"), a
 * collapsed "Show the details", and the tested time + history dots on one quiet line.
 *
 * EVIDENCE IS TEXT. What a run observed can be anything a hostile site sent (`<img onerror…>`,
 * `</script>`): it is rendered as React text children only, never as html.
 */

export const rowButtonId = (id: string) => `seo-test-row-${id}`
const detailId = (id: string) => `seo-test-detail-${id}`
const rawId = (id: string) => `seo-test-raw-${id}`

/** What a row needs from the tab around it. */
export type RowContext = {
  artistId: string
  /** The run's start, for "Tested …"; '' until mounted (clock.ts). */
  testedWhen: string
  now: Date | null
  history: SeoTestHistory
  /** "Test everything again" is on offer (not running, not cooling down, a site to test). */
  canRunAll: boolean
  onRunAll: () => void
  /** The fix this row offers was applied in this session: "publish to finish". */
  fixed: boolean
  fixing: boolean
  onFix: (fix: 'apple-storefront') => void
}

/** The mark at the start of the row. */
export function StatusMark({ status }: { status: SeoTestStatus | null }) {
  return (
    <span aria-hidden="true" className="flex w-5 flex-none justify-center">
      {status === 'pass' ? (
        <Icon name="check" size={17} className="text-ink" />
      ) : status === 'fail' ? (
        <Icon name="alert" size={17} className="text-accent-red" />
      ) : status === 'na' ? (
        <Icon name="minus" size={17} className="text-ink-faint" />
      ) : status === 'unknown' ? (
        <span className="h-[13px] w-[13px] rounded-full border-[1.6px] border-dashed border-ink-faint" />
      ) : null}
    </span>
  )
}

const MARK_WORD: Record<SeoTestStatus, string> = { pass: 'passing', fail: 'needs you', unknown: 'couldn’t check', na: 'doesn’t apply' }

/** OUTSIDE TAPIR, and where the answer comes from (Tour / Music). */
function Tags({ row }: { row: TestRow }) {
  return (
    <>
      {row.def.outside ? (
        <span className="hidden whitespace-nowrap rounded-full border border-hairline px-[7px] py-0.5 font-space text-[10px] uppercase tracking-[0.06em] text-ink-faint sm:inline">Outside Tapir</span>
      ) : null}
      {row.def.source ? (
        <span className="hidden items-center gap-1.5 whitespace-nowrap font-space text-[12px] text-ink-faint sm:inline-flex">
          <Icon name={row.def.source === 'Tour' ? 'tour' : 'tracks'} size={14} />
          {row.def.source}
        </span>
      ) : null}
    </>
  )
}

const VALUE_TONE: Record<SeoTestStatus, string> = { pass: 'text-ink-muted', fail: 'text-accent-red', unknown: 'text-ink-faint', na: 'text-ink-faint' }

/** The inside of a row, shared by the clickable row and the quiet one. */
function RowFace({ row, showValue, open }: { row: TestRow; showValue: boolean; open?: boolean }) {
  const r = row.result
  return (
    <>
      <StatusMark status={showValue ? (r?.status ?? null) : null} />
      <span className={cx('min-w-0 flex-1 truncate text-[15px] font-medium', r?.status === 'na' ? 'text-ink-muted' : 'text-ink')}>{row.def.name}</span>
      {r && showValue ? <span className="sr-only">, {MARK_WORD[r.status]}</span> : null}
      <Tags row={row} />
      {r && showValue && r.value ? (
        <span className={cx('max-w-[45%] truncate whitespace-nowrap font-space text-[12px] sm:max-w-[280px]', VALUE_TONE[r.status])}>{r.value}</span>
      ) : null}
      {open !== undefined ? (
        <Icon
          name="chevronRight"
          size={14}
          aria-hidden="true"
          className={cx('flex-none transition-transform duration-150', open ? 'rotate-90 text-ink' : 'text-ink-faint opacity-60 group-hover/trow:opacity-100 group-hover/trow:text-ink')}
        />
      ) : null}
    </>
  )
}

/** A row that opens nothing: before the first test, with no site, or while testing isn't on. */
export function QuietRow({ row, showValue = false }: { row: TestRow; showValue?: boolean }) {
  return (
    <div data-test-item={row.def.id} className="-mx-3 border-b border-hairline-soft last:border-b-transparent">
      <div className="flex items-center gap-3.5 px-3 py-[13px] opacity-60">
        <RowFace row={row} showValue={showValue} />
      </div>
    </div>
  )
}

export function TestRowItem({ row, open, onToggle, ctx }: { row: TestRow; open: boolean; onToggle: () => void; ctx: RowContext }) {
  const id = row.def.id
  const r = row.result
  if (!r) return <QuietRow row={row} />
  return (
    <div data-test-item={id} className={cx('-mx-3 rounded-xl border-b', open ? 'mb-1.5 border-b-transparent bg-surface' : 'border-hairline-soft last:border-b-transparent')}>
      <button
        id={rowButtonId(id)}
        type="button"
        data-test-row=""
        aria-expanded={open}
        aria-controls={detailId(id)}
        onClick={onToggle}
        className={cx('group/trow flex w-full items-center gap-3.5 rounded-xl px-3 py-[13px] text-left transition-colors hover:bg-surface', FOCUS_RING, 'focus-visible:-outline-offset-2')}
      >
        <RowFace row={row} showValue open={open} />
      </button>
      {open ? <Dropdown row={row} ctx={ctx} /> : null}
    </div>
  )
}

const LEAD_TONE: Record<SeoTestStatus, string> = { pass: 'text-ink', fail: 'text-accent-red', unknown: 'text-ink-muted', na: 'text-ink-faint' }

function Dropdown({ row, ctx }: { row: TestRow; ctx: RowContext }) {
  const r = row.result!
  const id = row.def.id
  const [raw, setRaw] = useState(false)
  const lead = leadOf(r)
  const evidence = Array.isArray(r.evidence) ? r.evidence : []
  return (
    <div id={detailId(id)} role="region" aria-labelledby={rowButtonId(id)} className="pb-4 pl-4 pr-4 sm:pl-[46px]">
      <p className="text-[17px] font-medium leading-[1.4] tracking-[-0.01em] text-ink">
        {lead ? <b className={cx('font-bold', LEAD_TONE[r.status])}>{lead} </b> : null}
        {sentenceOf(r)}
      </p>
      <p className="mt-[3px] text-[14px] leading-[1.45] text-ink-muted">{row.def.why}</p>
      {r.good ? <Line label="Good looks like">{r.good}</Line> : null}
      {r.todo ? <Line label="What to do">{r.todo}</Line> : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="flex gap-1.5">
          <ActionIcon row={row} ctx={ctx} />
          <DropIcon icon="refresh" label="Test everything again" onClick={ctx.onRunAll} disabled={!ctx.canRunAll} />
        </div>
        <button
          type="button"
          aria-expanded={raw}
          aria-controls={rawId(id)}
          onClick={() => setRaw((o) => !o)}
          className={cx('inline-flex items-center gap-1.5 rounded-md py-1 text-[13px] text-ink-muted transition-colors hover:text-ink', FOCUS_RING)}
        >
          <Icon name="chevronRight" size={14} aria-hidden="true" className={cx('transition-transform duration-150', raw && 'rotate-90')} />
          Show the details
        </button>
        <span className="flex items-center gap-2.5 font-space text-[11px] text-ink-faint sm:ml-auto">
          {ctx.testedWhen ? <span>Tested {ctx.testedWhen}</span> : null}
          <HistoryDots history={ctx.history} now={ctx.now} />
        </span>
        {raw ? (
          <div id={rawId(id)} className="order-3 basis-full">
            <p className="mb-2 text-[14px] leading-[1.45] text-ink">{row.def.tested}</p>
            {evidence.length ? (
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-[10px] bg-paper px-3.5 py-3 font-space text-[12px] leading-[1.5]">
                {evidence.map((e, i) => (
                  <Fragment key={i}>
                    <dt className="text-ink-faint">{String(e?.label ?? '')}</dt>
                    <dd className="min-w-0 text-ink [overflow-wrap:anywhere] whitespace-pre-wrap">{String(e?.value ?? '')}</dd>
                  </Fragment>
                ))}
              </dl>
            ) : null}
            {r.limits ? (
              <p className="mt-2.5 text-[13px] leading-[1.45] text-ink-muted">
                <span className="mr-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">What this test can’t see</span>
                {r.limits}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="mt-[3px] text-[14px] leading-[1.45] text-ink">
      <span className="mr-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{label}</span>
      {children}
    </p>
  )
}

/** The result's own action, as an icon: pencil (open the tab or tool), ↗ (another site), wrench
 *  (a fix Tapir makes as a draft). None when the result offers none. */
function ActionIcon({ row, ctx }: { row: TestRow; ctx: RowContext }) {
  const a = row.result?.action
  if (!a) return null
  if (a.kind === 'edit') return <DropIcon icon="edit" label={a.label} href={editHref(ctx.artistId, a.target)} primary />
  if (a.kind === 'outside') {
    const href = safeHttps(a.href)
    return href ? <DropIcon icon="external" label={a.label} href={href} external primary /> : null
  }
  if (ctx.fixed) {
    return (
      <span role="status" className="inline-flex h-[34px] items-center gap-1.5 pr-1 font-space text-[12px] text-ink">
        <Icon name="check" size={14} aria-hidden="true" />
        Fixed · publish to finish
      </span>
    )
  }
  return <DropIcon icon="tools" label={a.label} onClick={() => ctx.onFix(a.fix)} disabled={ctx.fixing} primary />
}

/** r5's action button: a 34px bordered square on the dropdown's grey, glyph only, the label on
 *  hover / keyboard focus (HoverLabel, the Brand chip) and as its accessible name. */
export function DropIcon({
  icon,
  label,
  href,
  external = false,
  onClick,
  disabled = false,
  primary = false,
  expanded,
}: {
  icon: IconName
  label: string
  href?: string
  external?: boolean
  onClick?: () => void
  disabled?: boolean
  primary?: boolean
  /** A button that opens something beside it (the "Test with" list). */
  expanded?: boolean
}) {
  const cls = cx(
    'relative inline-flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-paper transition-colors',
    FOCUS_RING,
    'focus-visible:outline-offset-2',
    primary ? 'text-ink hover:text-accent' : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
    'disabled:cursor-default disabled:opacity-40 disabled:hover:bg-paper disabled:hover:text-ink-muted',
  )
  const inner = (
    <>
      <Icon name={icon} size={17} aria-hidden="true" />
      <HoverLabel label={label} align="start" />
    </>
  )
  if (href && external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={cls}>
        {inner}
      </a>
    )
  }
  if (href) {
    return (
      <Link href={href} aria-label={label} className={cls}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" aria-label={label} aria-expanded={expanded} onClick={onClick} disabled={disabled} className={cls}>
      {inner}
    </button>
  )
}

const DOT: Record<SeoTestStatus, string> = {
  pass: 'bg-ink opacity-80',
  fail: 'bg-accent-red',
  unknown: 'border border-ink-faint',
  na: 'bg-hairline',
}

/** The test's last results, oldest first (store.ts historyFor), each dated on hover. */
function HistoryDots({ history, now }: { history: SeoTestHistory; now: Date | null }) {
  if (!history.length || !now) return null
  const said = history.map((h) => dotText(h.ranAt, h.status, now)).join('; ')
  return (
    <span role="img" aria-label={`Last ${history.length} ${history.length === 1 ? 'result' : 'results'}: ${said}`} className="flex items-center gap-[1px]">
      {history.map((h, i) => (
        <span key={`${h.ranAt}-${i}`} data-dot={h.status} className="relative flex h-[11px] w-[11px] items-center justify-center">
          <span aria-hidden="true" className={cx('block h-[7px] w-[7px] rounded-full', DOT[h.status])} />
          <HoverLabel label={dotText(h.ranAt, h.status, now) || STATUS_WORD[h.status]} side="top" align="end" />
        </span>
      ))}
    </span>
  )
}
