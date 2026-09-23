'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { CONTENT_KINDS, type ContentKind, type ContentItem, type ContentList, type EntityFacts } from '@/lib/analytics'
import { coverThumbUrl } from '@/lib/cover-url'
import { Icon } from './icons'
import { SourceGlyph } from './source-glyphs'
import { PortalModal } from './portal-modal'
import { modalCardClass } from './ui'

/** How many rows a column shows before the rest go behind View all. */
export const TOP_N = 5

/**
 * What people acted on, one ranked column per kind: songs by plays, products by
 * buy clicks. Both columns are equal width and EVERY ROW IS THE SAME SIZE.
 *
 * An earlier build drew the leader large and shrank each row with its count. It was
 * cut (Sam, 2026-09-22): size carried the ranking a second time, after the order and
 * the number had already said it, and it made the tail illegible for no gain. The
 * leader is marked with a ring instead — `ring-1`, which is a box-shadow and so costs
 * no layout, where a border would push every row below it down and knock the two
 * columns out of step.
 *
 * A column shows TOP_N rows. View all opens a window with the whole list, and it is
 * rendered ONLY where rows are actually hidden: over a list that already fits, it
 * would open a window identical to the page behind it.
 *
 * The kinds come from CONTENT_KINDS, which carries each column's own heading — there
 * is no label above the block, and no line about how many events named a thing.
 */
export function TopContent({ lists, facts, className }: {
  lists: Record<ContentKind['key'], ContentList>
  /** Per-row detail for the hover, keyed by entity id. Absent = no hover at all. */
  facts?: Record<string, EntityFacts>
  className?: string
}) {
  const [open, setOpen] = useState<ContentKind['key'] | null>(null)
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null)
  const offered = CONTENT_KINDS.filter((k) => lists[k.key].items.length > 0)
  const opened = offered.find((k) => k.key === open)

  if (offered.length === 0) {
    // Two different silences, and a manager acts on each differently. topContent keeps
    // an event ATTRIBUTED when the row it named has since been deleted, so `attributed`
    // can be in the thousands with nothing left to list — and "nothing yet" would then
    // contradict the buy-clicks tile further up the same page.
    const counted = CONTENT_KINDS.some((k) => lists[k.key].attributed > 0)
    return (
      <div className={className}>
        <p className="font-space text-xs text-ink-faint">
          {counted ? 'Everything acted on has since been deleted.' : 'Nothing played or clicked yet.'}
        </p>
      </div>
    )
  }

  return (
    <div className={cx('grid gap-x-14 gap-y-10 md:grid-cols-2', className)}>
      {offered.map((kind) => {
        const items = lists[kind.key].items
        return (
          <section key={kind.key}>
            <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-2">
              <h2 className="font-space text-[11px] uppercase tracking-[0.1em] text-ink">{kind.heading}</h2>
              {items.length > TOP_N && (
                <button
                  type="button"
                  onClick={() => setOpen(kind.key)}
                  className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint transition-colors hover:text-ink"
                >
                  View all
                </button>
              )}
            </div>
            <Rows items={items.slice(0, TOP_N)} noun={kind.noun} onTip={setTip} lit={tip?.id} />
          </section>
        )
      })}

      {opened && (
        <PortalModal ariaLabel={opened.heading} cardClass={modalCardClass} onClose={() => setOpen(null)}>
          <h2 className="font-space text-[11px] uppercase tracking-[0.1em] text-ink">{opened.heading}</h2>
          <Rows items={lists[opened.key].items} noun={opened.noun} className="mt-2" onTip={setTip} lit={tip?.id} />
        </PortalModal>
      )}

      {tip && facts?.[tip.id] && <HoverTip facts={facts[tip.id]} x={tip.x} y={tip.y} />}
    </div>
  )
}

/** How far above and right of the pointer the tip sits. */
const TIP_OFFSET = { x: 14, y: 12 }

/**
 * The detail, following the pointer and sitting above-right of it (Sam, 2026-09-22).
 *
 * It tracks the cursor rather than anchoring to the row because the rows are only 48px
 * tall: a tip pinned to a row lands under the pointer on the way down the list, and the
 * thing you are reading is the thing your hand is covering. Fixed positioning, so it is
 * measured against the viewport the pointer is reported in and no scrolled ancestor can
 * shift it.
 */
function HoverTip({ facts, x, y }: { facts: EntityFacts; x: number; y: number }) {
  return (
    <div
      role="tooltip"
      // z ABOVE the modal overlay's z-50: rows are hoverable inside the View-all window
      // too, and at the same rank the portal wins and the tip paints behind it.
      className="pointer-events-none fixed z-[60] rounded-lg border border-hairline bg-paper px-4 py-3 shadow-lg"
      style={{ left: x + TIP_OFFSET.x, top: y - TIP_OFFSET.y, transform: 'translateY(-100%)' }}
    >
      {facts.kind === 'merch' ? (
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3.5 gap-y-2">
          <Icon name="eye" size={16} className="text-ink-faint" />
          <span className="font-space text-[12px] uppercase tracking-[0.08em] text-ink-muted">Opened</span>
          <span className="justify-self-end font-space text-[15px] font-bold tabular-nums text-ink">{facts.opened}</span>
          <Icon name="merch" size={16} className="text-ink-faint" />
          <span className="font-space text-[12px] uppercase tracking-[0.08em] text-ink-muted">Added to cart</span>
          <span className="justify-self-end font-space text-[15px] font-bold tabular-nums text-ink">{facts.cart}</span>
        </div>
      ) : (
        <div className="flex items-center gap-x-4">
          {facts.services.map((s) => (
            <span key={s.key} className="flex items-center gap-2">
              <SourceGlyph source={s.key === 'apple' ? 'apple_music' : s.key} size={19} className="text-ink" />
              <span className="font-space text-[15px] font-bold tabular-nums text-ink">{s.pct}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The list itself, drawn identically on the page and inside the window — the leader
 * carries the same ring in both, so the mark means one thing wherever it is seen.
 */
/**
 * Is the second line just the title again? A SINGLE is released as an album named
 * after its one song, so `tracks.album_name` comes back equal to `tracks.title` and
 * the row printed the same words twice (Sam, 2026-09-22). Compared loosely, because
 * the two fields are typed by different hands and drift by case and padding.
 */
function echoesTitle(title: string, sub: string): boolean {
  const norm = (v: string) => v.trim().toLowerCase()
  return norm(sub) === norm(title)
}

function Rows({ items, noun, className, onTip, lit }: {
  items: ContentItem[]
  noun: string
  className?: string
  onTip?: (t: { id: string; x: number; y: number } | null) => void
  /** The id of the row the pointer is on, if any. */
  lit?: string
}) {
  return (
    <ol className={className}>
      {items.map((it, i) => (
        <li
          key={it.id}
          onMouseEnter={(e) => onTip?.({ id: it.id, x: e.clientX, y: e.clientY })}
          onMouseMove={(e) => onTip?.({ id: it.id, x: e.clientX, y: e.clientY })}
          onMouseLeave={() => onTip?.(null)}
          className={cx(
            'grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-4 border-b border-hairline px-3.5 py-2.5',
            // The leader. A ring rather than a border: box-shadow paints outside the
            // box, so rows 2..n stay level with the neighbouring column's.
            i === 0 && 'rounded-md border-transparent ring-1 ring-ink-faint',
            // Under the pointer. Driven by the same state as the tip, so the row that is
            // lit and the row the tip describes cannot drift apart.
            lit === it.id && 'rounded-md bg-surface-hover',
          )}
        >
          <span className="block h-12 w-12 overflow-hidden rounded-md bg-track">
            {it.image && (
              // Plain <img>, as every cover on the dashboard is: the sources serve a
              // sized variant by URL (coverThumbUrl), so next/image would add a hop.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverThumbUrl(it.image, 96) ?? undefined} alt="" className="h-full w-full object-cover" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {it.title}
            </span>
            {it.sub && !echoesTitle(it.title, it.sub) && (
              <span className="mt-0.5 block truncate font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                {it.sub}
              </span>
            )}
          </span>
          <span className="font-space text-[15px] font-bold tabular-nums leading-none tracking-[-0.02em] text-ink">
            {it.count.toLocaleString('en-US')}
            <span className="sr-only"> {noun}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
