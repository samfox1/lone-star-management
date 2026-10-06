import Link from 'next/link'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import type { UnpublishedDiff } from '@/lib/content'
import { toolDot, toolValue, waitingMessage, type OverviewCounts } from '@/lib/manager-tools/overview/overview'
import { dirtyBySeg } from '../../sections'
import { toolsFor } from '../_shell/tools-registry'
import { RowFace } from '../_ui/disclosure'
import { FOCUS_RING } from '../_ui/focus-ring'
import { LedgerRow, LedgerSection } from '../_ui/ledger'
import { RowIcon } from '../_ui/row-icon'
import { OverviewRiser } from './overview-riser'

/** The Overview's own seg in the registry: the rail lists it, the page does not. */
const OVERVIEW_SEG = 'tools'

/**
 * THE OVERVIEW (Sam, 2026-10-05, prototypes/overview_20261002.html), on Brand's ledger:
 *
 *   SITE    the address · N unpublished (or ✓ Live) · ↗ view · pencil to the editor
 *   TOOLS   one row per tool the rail lists (toolsFor), its count and dot where it has one
 *
 * and the rising Publish bar while something waits. No stat cards, no captions (the rail names
 * every tool), no word buttons. The preview eye shows only for a template site: for a custom
 * site /preview draws Tapir's template, not the artist's real site.
 *
 * Tool rows are NAV, so they answer the pointer as the rail does (NAV_HOVER, icon-hover.ts): the glyph and
 * the chevron turn ink and the glyph gets bolder, with no grey box behind the row.
 */
export function OverviewView({
  artistId,
  customSite,
  address,
  viewHref,
  counts,
  diff,
}: {
  artistId: string
  customSite: boolean
  address: string
  viewHref: string
  counts: OverviewCounts
  diff: UnpublishedDiff
}) {
  const dirty = dirtyBySeg(diff)
  // Waiting ROUTE segments, as the old status card counted them.
  const unpublished = Object.values(dirty).filter(Boolean).length
  const tools = toolsFor(customSite).filter((t) => t.seg !== OVERVIEW_SEG)

  return (
    <>
      <LedgerSection label="Site">
        <LedgerRow title="Site" meta={address}>
          <div className="flex min-w-0 items-center gap-[18px]">
            {unpublished ? (
              <span className="inline-flex items-center gap-[7px] whitespace-nowrap font-space text-[12px] text-ink-muted">
                <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full bg-accent" />
                {unpublished} unpublished
              </span>
            ) : (
              <span className="inline-flex items-center gap-[7px] whitespace-nowrap font-space text-[12px] text-ink">
                <Icon name="check" size={15} aria-hidden="true" />
                Live
              </span>
            )}
            <RowIcon icon="external" label="View site" variant="bare" href={viewHref} link="external" />
            {customSite ? null : <RowIcon icon="eye" label="Preview" variant="bare" href={`/artists/${artistId}/preview`} link="app" />}
            <RowIcon icon="edit" label="Edit site" variant="bare" href={`/artists/${artistId}/editor`} link="app" labelAlign="end" />
          </div>
        </LedgerRow>
      </LedgerSection>

      <LedgerSection label="Tools">
        <div className="-mx-3 flex flex-col">
          {tools.map((t, i) => {
            const value = toolValue(t.seg, counts)
            const dot = toolDot(t.seg, diff, dirty)
            return (
              <Link
                key={t.seg}
                href={`/artists/${artistId}/${t.seg}`}
                aria-label={[t.label, value?.text, dot ? 'unpublished changes' : null].filter(Boolean).join(', ')}
                className={cx(
                  'group/trow flex w-full items-center gap-3.5 rounded-xl p-3 text-left',
                  i > 0 && 'shadow-[0_-1px_0_var(--color-hairline-soft)]',
                  FOCUS_RING,
                  'focus-visible:-outline-offset-2',
                )}
              >
                <RowFace
                  mark={
                    <span
                      aria-hidden="true"
                      className="flex w-5 flex-none justify-center text-ink-muted transition-colors group-hover/trow:text-ink group-hover/trow:[&_svg]:[stroke-width:2.1]"
                    >
                      <Icon name={t.icon} size={18} />
                    </span>
                  }
                  name={
                    <span className="inline-flex items-center gap-2">
                      {t.label}
                      {dot ? <span data-unpublished-dot="" aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-accent" /> : null}
                    </span>
                  }
                  value={
                    value ? (
                      <span className={cx('whitespace-nowrap font-space text-[12px]', value.strong ? 'text-ink' : 'text-ink-faint')}>{value.text}</span>
                    ) : undefined
                  }
                  open={false}
                />
              </Link>
            )
          })}
        </div>
      </LedgerSection>

      <OverviewRiser artistId={artistId} message={waitingMessage(diff)} />
    </>
  )
}
