'use client'

import Link from 'next/link'
import { cx } from '@/lib/cx'
import { Icon, type IconName } from '@/components/ui/icons'
import type { SeoTestStatus } from '@/lib/seo-tests/types'
import { HoverLabel } from '../../../_ui/row-icon'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { checkItYourself, editHref, evidenceRows, leadOf, safeHttps, sentenceOf, type TestRow } from './model'

/**
 * ONE TEST: its row, and the CARD that opens under it (Sam, 2026-09-29, round 10's "Dropdown
 * A · Card", prototypes/seo_variants_20260929_r10.html). The row: status mark · the test's name ·
 * OUTSIDE TAPIR / Tour / Music tags · its short value · chevron. Opened, the row turns grey and
 * a white card sits under it, LABEL | value rows like the Brand and modal grammar:
 *
 *   RESULT       the bold lead ("Not yet:") and the sentence, then why it matters
 *   WHAT WE SAW  the run's evidence, what the test can't see, other sites' own checkers
 *   WHAT TO DO   the to-do, ending in the result's action as a BARE glyph (Sam dislikes icons in
 *                a box): pencil to the setting, ↗ to another site, wrench for a fix Tapir makes
 *
 * A card row with nothing to say is left out. Nothing here is a history or a per-row time: the
 * header says when the run was.
 *
 * EVIDENCE IS TEXT. What a run observed can be anything a hostile site sent (`<img onerror…>`,
 * `</script>`): it is rendered as React text children only, never as html.
 */

export const rowButtonId = (id: string) => `seo-test-row-${id}`
const cardId = (id: string) => `seo-test-detail-${id}`

/** What a row needs from the tab around it. */
export type RowContext = {
  artistId: string
  /** The address the run tested, for the "check it yourself" links. */
  site: string
  /** The fix this row offers was applied in this session: "publish to finish". */
  fixed: boolean
  fixing: boolean
  onFix: (fix: 'apple-storefront') => void
}

/** The mark at the start of the row. `untested`: a plain hollow ring, so a row that has not been
 *  tested never reads as a statement of fact (review L3). */
export function StatusMark({ status, untested = false }: { status: SeoTestStatus | null; untested?: boolean }) {
  return (
    <span aria-hidden="true" data-status-mark="" className="flex w-5 flex-none justify-center">
      {untested ? (
        <span data-mark="untested" className="h-[13px] w-[13px] rounded-full border-[1.6px] border-ink-faint" />
      ) : status === 'pass' ? (
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
        <span className="whitespace-nowrap rounded-full border border-hairline px-[7px] py-0.5 font-space text-[10px] uppercase tracking-[0.06em] text-ink-faint">Outside Tapir</span>
      ) : null}
      {row.def.source ? (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-space text-[12px] text-ink-faint">
          <Icon name={row.def.source === 'Tour' ? 'tour' : 'tracks'} size={14} />
          {row.def.source}
        </span>
      ) : null}
    </>
  )
}

/**
 * The inside of a row. The NAME WRAPS, never truncates, at every width (review L6: on a phone
 * six rows read "Nothing on your site tu…"). On a phone the tags and the value drop under the
 * name; from `sm` up they sit on the right.
 */
function RowFace({ row, open }: { row: TestRow; open?: boolean }) {
  const r = row.result
  return (
    <>
      <StatusMark status={r?.status ?? null} untested={!r} />
      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3.5">
        <span data-test-name="" className={cx('min-w-0 flex-1 text-[15px] font-medium leading-[1.35] [overflow-wrap:anywhere]', r?.status === 'na' ? 'text-ink-muted' : 'text-ink')}>
          {row.def.name}
        </span>
        {r ? <span className="sr-only">, {MARK_WORD[r.status]}</span> : null}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 sm:flex-none sm:flex-nowrap sm:gap-3.5">
          <Tags row={row} />
          {r?.value ? (
            <span className={cx('min-w-0 max-w-full truncate whitespace-nowrap font-space text-[12px] sm:max-w-[200px]', r.status === 'fail' ? 'text-accent-red' : 'text-ink-faint')}>{r.value}</span>
          ) : null}
        </span>
      </span>
      {open !== undefined ? (
        <Icon
          name="chevronRight"
          size={14}
          aria-hidden="true"
          className={cx('flex-none transition-transform duration-150', open ? 'rotate-90 text-ink' : 'text-ink-faint group-hover/trow:text-ink')}
        />
      ) : null}
    </>
  )
}

/** The thin line between two closed rows (a shadow, so it takes no room). */
const DIVIDER = 'shadow-[0_-1px_0_var(--color-hairline-soft)]'

export function TestRowItem({ row, open, divider, onToggle, ctx }: { row: TestRow; open: boolean; divider: boolean; onToggle: () => void; ctx: RowContext }) {
  const id = row.def.id
  if (!row.result) {
    // A test this run has no result for (new since, or a malformed stored result): a hollow
    // ring and nothing to open. Never shown as a pass or a fail.
    return (
      <div data-test-item={id} className={cx('rounded-xl', divider && DIVIDER)}>
        <div className="flex items-center gap-3.5 p-3 opacity-60">
          <RowFace row={row} />
        </div>
      </div>
    )
  }
  return (
    <div data-test-item={id} className={cx('rounded-xl', open ? 'my-1 bg-surface' : divider && DIVIDER)}>
      <button
        id={rowButtonId(id)}
        type="button"
        data-test-row=""
        aria-expanded={open}
        aria-controls={cardId(id)}
        onClick={onToggle}
        // scroll-mt: a deep link (?open=) scrolls THIS button into view; the sticky header is 71px.
        className={cx('group/trow flex w-full scroll-mt-28 items-center gap-3.5 rounded-xl p-3 text-left transition-colors hover:bg-surface', FOCUS_RING, 'focus-visible:-outline-offset-2')}
      >
        <RowFace row={row} open={open} />
      </button>
      {open ? <Card row={row} ctx={ctx} /> : null}
    </div>
  )
}

const LEAD_TONE: Record<SeoTestStatus, string> = { pass: 'text-ink', fail: 'text-accent-red', unknown: 'text-ink-muted', na: 'text-ink-faint' }

/** A card row's label: RESULT, WHAT WE SAW, WHAT TO DO, CHECK IT YOURSELF. Beside its value from
 *  700px, above it on a phone. */
function CardLabel({ children }: { children: string }) {
  return (
    <span className="pt-3 font-space text-[10px] uppercase leading-[1.4] tracking-[0.1em] text-ink-faint first:pt-0 min-[700px]:pt-1 min-[700px]:first:pt-1">{children}</span>
  )
}

function Card({ row, ctx }: { row: TestRow; ctx: RowContext }) {
  const r = row.result!
  const id = row.def.id
  const lead = leadOf(r)
  const seen = evidenceRows(r.evidence)
  const checks = checkItYourself(id, ctx.site)
  const saw = seen.length > 0 || !!r.limits
  const todo = !!r.todo || !!r.good || !!r.action
  return (
    <div id={cardId(id)} role="region" aria-labelledby={rowButtonId(id)} className="px-3 pb-3 pt-0.5 sm:pb-[22px] sm:pl-[46px] sm:pr-3.5">
      <div className="grid grid-cols-1 gap-y-1.5 rounded-xl border border-hairline bg-paper px-5 py-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.03)] min-[700px]:grid-cols-[100px_minmax(0,1fr)] min-[700px]:gap-x-5 min-[700px]:gap-y-5">
        <CardLabel>Result</CardLabel>
        <div data-card="result" className="min-w-0">
          <p className="text-[15px] leading-[1.45] text-ink">
            {lead ? <b className={cx('font-bold', LEAD_TONE[r.status])}>{lead} </b> : null}
            {sentenceOf(r)}
          </p>
          <p className="mt-1 text-[13px] leading-normal text-ink-muted">{row.def.why}</p>
        </div>

        {saw ? (
          <>
            <CardLabel>What we saw</CardLabel>
            <div data-card="seen" className="min-w-0">
              {seen.length ? (
                // One label, then its values: a repeated label is said once (model.ts evidenceRows).
                <dl className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
                  {seen.map((e, i) => (
                    <Evidence key={i} label={e.repeat ? null : e.label} value={e.value} />
                  ))}
                </dl>
              ) : null}
              {r.limits ? <p className={cx('text-[13px] leading-[1.45] text-ink-muted', seen.length > 0 && 'mt-3')}>{r.limits}</p> : null}
            </div>
          </>
        ) : null}

        {todo ? (
          <>
            <CardLabel>What to do</CardLabel>
            <div data-card="todo" className="min-w-0">
              {r.todo || r.action ? (
                <p className="text-[14px] leading-normal text-ink">
                  {r.todo ?? r.action?.label}
                  <Action row={row} ctx={ctx} />
                </p>
              ) : null}
              {r.good ? <p className={cx('text-[13px] leading-normal text-ink-muted', (r.todo || r.action) && 'mt-1')}>{r.good}</p> : null}
            </div>
          </>
        ) : null}

        {checks.length ? (
          <>
            {/* Other sites' own checkers for this test, opened on the tested address. Last: the
                card's own answer comes first. */}
            <CardLabel>Check it yourself</CardLabel>
            <div data-card="checks" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
              {checks.map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className={cx('inline-flex items-center gap-1 rounded transition-colors hover:text-accent', FOCUS_RING)}>
                  {l.label}
                  <Icon name="external" size={12} aria-hidden="true" />
                </a>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function Evidence({ label, value }: { label: string | null; value: string }) {
  return (
    <>
      {label !== null ? <dt className="min-w-0 text-[14px] leading-[1.45] text-ink [overflow-wrap:anywhere]">{label}</dt> : null}
      <dd className="col-start-2 min-w-0 whitespace-pre-wrap font-space text-[12px] leading-[1.45] text-ink-faint [overflow-wrap:anywhere]">{value}</dd>
    </>
  )
}

/** The glyph at the end of WHAT TO DO: no border, no box, its name on hover or keyboard focus
 *  (HoverLabel, the Brand chip) and as its accessible name. */
const GLYPH = cx('relative ml-2.5 inline-flex rounded align-[-3px] text-ink transition-colors hover:text-accent', FOCUS_RING, 'focus-visible:outline-offset-2')

function Glyph({ icon, label }: { icon: IconName; label: string }) {
  return (
    <>
      <Icon name={icon} size={17} aria-hidden="true" />
      <HoverLabel label={label} align="start" />
    </>
  )
}

/** The result's own action: pencil (open the tab or tool), ↗ (another site, https only), wrench
 *  (a fix Tapir makes as a draft). None when the result offers none. */
function Action({ row, ctx }: { row: TestRow; ctx: RowContext }) {
  const a = row.result?.action
  if (!a) return null
  if (a.kind === 'edit') {
    return (
      <Link href={editHref(ctx.artistId, a.target)} aria-label={a.label} className={GLYPH}>
        <Glyph icon="edit" label={a.label} />
      </Link>
    )
  }
  if (a.kind === 'outside') {
    const href = safeHttps(a.href)
    if (!href) return null
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={a.label} className={GLYPH}>
        <Glyph icon="external" label={a.label} />
      </a>
    )
  }
  if (ctx.fixed) {
    return (
      <span role="status" className="ml-2.5 inline-flex items-center gap-1.5 align-[-1px] font-space text-[12px] text-ink">
        <Icon name="check" size={14} aria-hidden="true" />
        Fixed · publish to finish
      </span>
    )
  }
  return (
    <button type="button" aria-label={a.label} onClick={() => ctx.onFix(a.fix)} disabled={ctx.fixing} className={cx(GLYPH, 'disabled:cursor-default disabled:opacity-40 disabled:hover:text-ink')}>
      <Glyph icon="tools" label={a.label} />
    </button>
  )
}
