'use client'

import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import type { SeoTestStatus } from '@/lib/seo-tests/types'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { CAPS_VALUE } from '../../../_ui/styles'
import { CardField, DisclosureCard, DisclosureItem, QuietItem, RowFace as Face, RowMark, RowValue, SentenceAction, type RowMarkKind } from '../../../_ui/disclosure'
import { checkItYourself, editHref, evidenceRows, leadOf, safeHttps, sentenceOf, type TestRow } from '@/lib/manager-tools/seo/test-model'

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

const MARK_KIND: Record<SeoTestStatus, RowMarkKind> = { pass: 'check', fail: 'alert', na: 'minus', unknown: 'dashed' }

/** The mark at the start of the row. `untested`: a plain hollow ring, so a row that has not been
 *  tested never reads as a statement of fact (review L3). */
export function StatusMark({ status, untested = false }: { status: SeoTestStatus | null; untested?: boolean }) {
  return <RowMark kind={untested ? 'faint-ring' : status ? MARK_KIND[status] : null} data={{ 'data-status-mark': '' }} />
}

const MARK_WORD: Record<SeoTestStatus, string> = { pass: 'passing', fail: 'needs you', unknown: 'couldn’t check', na: 'doesn’t apply' }

/** OUTSIDE TAPIR, and where the answer comes from (Tour / Music). */
function Tags({ row }: { row: TestRow }) {
  return (
    <>
      {row.def.outside ? (
        <span className={cx(CAPS_VALUE, 'whitespace-nowrap rounded-full border border-hairline px-[7px] py-0.5 text-ink-faint')}>Outside Digital Tapir</span>
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

/** The inside of a row (disclosure.tsx's RowFace): the tags and the value sit on the right. */
function RowFace({ row, open }: { row: TestRow; open?: boolean }) {
  const r = row.result
  return (
    <Face
      mark={<StatusMark status={r?.status ?? null} untested={!r} />}
      name={row.def.name}
      nameData={{ 'data-test-name': '' }}
      tone={r?.status === 'na' ? 'muted' : 'ink'}
      srWord={r ? MARK_WORD[r.status] : undefined}
      extra={<Tags row={row} />}
      value={r?.value ? <RowValue bad={r.status === 'fail'}>{r.value}</RowValue> : null}
      open={open}
    />
  )
}

export function TestRowItem({ row, open, onToggle, ctx }: { row: TestRow; open: boolean; onToggle: () => void; ctx: RowContext }) {
  const id = row.def.id
  if (!row.result) {
    // A test this run has no result for (new since, or a malformed stored result): a hollow
    // ring and nothing to open. Never shown as a pass or a fail.
    return (
      <QuietItem itemData={{ 'data-test-item': id }} className="opacity-60">
        <RowFace row={row} />
      </QuietItem>
    )
  }
  return (
    <DisclosureItem
      buttonId={rowButtonId(id)}
      cardId={cardId(id)}
      open={open}
      onToggle={onToggle}
      itemData={{ 'data-test-item': id }}
      rowData={{ 'data-test-row': '' }}
      // scroll-mt: a deep link (?open=) scrolls THIS button into view; the sticky header is 71px.
      rowClassName="scroll-mt-28"
      face={<RowFace row={row} open={open} />}
    >
      <Card row={row} ctx={ctx} />
    </DisclosureItem>
  )
}

const LEAD_TONE: Record<SeoTestStatus, string> = { pass: 'text-ink', fail: 'text-accent-red', unknown: 'text-ink-muted', na: 'text-ink-faint' }

function Card({ row, ctx }: { row: TestRow; ctx: RowContext }) {
  const r = row.result!
  const id = row.def.id
  const lead = leadOf(r)
  const seen = evidenceRows(r.evidence)
  const checks = checkItYourself(id, ctx.site)
  const saw = seen.length > 0 || !!r.limits
  const todo = !!r.todo || !!r.good || !!r.action
  return (
    <DisclosureCard id={cardId(id)} labelledBy={rowButtonId(id)}>
      <CardField label="Result" name="result">
        <p className="text-[15px] leading-[1.45] text-ink">
          {lead ? <b className={cx('font-bold', LEAD_TONE[r.status])}>{lead} </b> : null}
          {sentenceOf(r)}
        </p>
        <p className="mt-1 text-[13px] leading-normal text-ink-muted">{row.def.why}</p>
      </CardField>

      {saw ? (
        <CardField label="What we saw" name="seen">
          {seen.length ? (
            // One label, then its values: a repeated label is said once (test-model.ts evidenceRows).
            <dl className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
              {seen.map((e, i) => (
                <Evidence key={i} label={e.repeat ? null : e.label} value={e.value} />
              ))}
            </dl>
          ) : null}
          {r.limits ? <p className={cx('text-[13px] leading-[1.45] text-ink-muted', seen.length > 0 && 'mt-3')}>{r.limits}</p> : null}
        </CardField>
      ) : null}

      {todo ? (
        <CardField label="What to do" name="todo">
          {r.todo || r.action ? (
            <p className="text-[14px] leading-normal text-ink">
              {r.todo ?? r.action?.label}
              <Action row={row} ctx={ctx} />
            </p>
          ) : null}
          {r.good ? <p className={cx('text-[13px] leading-normal text-ink-muted', (r.todo || r.action) && 'mt-1')}>{r.good}</p> : null}
        </CardField>
      ) : null}

      {checks.length ? (
        // Other sites' own checkers for this test, opened on the tested address. Last: the
        // card's own answer comes first.
        <CardField label="Check it yourself" name="checks" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
          {checks.map((l) => (
            <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className={cx('inline-flex items-center gap-1 rounded transition-colors hover:text-accent', FOCUS_RING)}>
              {l.label}
              <Icon name="external" size={12} aria-hidden="true" />
            </a>
          ))}
        </CardField>
      ) : null}
    </DisclosureCard>
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

/** The result's own action, a bare glyph at the end of WHAT TO DO (no border, no box; its name
 *  on hover or keyboard focus and as its accessible name): pencil (open the tab or tool), ↗
 *  (another site, https only), wrench (a fix Tapir makes as a draft). None when the result
 *  offers none. */
function Action({ row, ctx }: { row: TestRow; ctx: RowContext }) {
  const a = row.result?.action
  if (!a) return null
  if (a.kind === 'edit') return <SentenceAction icon="edit" label={a.label} href={editHref(ctx.artistId, a.target)} link="app" />
  if (a.kind === 'outside') {
    const href = safeHttps(a.href)
    if (!href) return null
    return <SentenceAction icon="external" label={a.label} href={href} link="external" />
  }
  if (ctx.fixed) {
    return (
      <span role="status" className="ml-2.5 inline-flex items-center gap-1.5 align-[-1px] font-space text-[12px] text-ink">
        <Icon name="check" size={14} aria-hidden="true" />
        Fixed · publish to finish
      </span>
    )
  }
  return <SentenceAction icon="tools" label={a.label} onClick={() => ctx.onFix(a.fix)} disabled={ctx.fixing} />
}
