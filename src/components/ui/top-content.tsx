'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { CONTENT_KINDS, type ContentKind, type ContentList } from '@/lib/analytics'
import { coverThumbUrl } from '@/lib/cover-url'

/**
 * What people acted on, one list at a time: songs by plays, tour dates by ticket
 * clicks, merch by buy clicks. One number per row, because that is the one thing
 * the site records against each kind of thing. The bar is drawn against the
 * leader of the visible list.
 *
 * The line above each list says how many events named a thing and how many did
 * not, and an empty tab says which kind of empty it is — "none named a date
 * yet" is a different fact from "no ticket clicks", and both differ from "every
 * song they played has since been deleted". A manager acts on each differently.
 * The tabs are derived from CONTENT_KINDS; nothing here knows the word "song".
 */
export function TopContent({ lists, className }: { lists: Record<ContentKind['key'], ContentList>; className?: string }) {
  const [active, setActive] = useState<ContentKind['key']>(CONTENT_KINDS[0].key)
  const kind = CONTENT_KINDS.find((k) => k.key === active)!
  const list = lists[active]
  const max = Math.max(1, ...list.items.map((i) => i.count))
  const total = list.attributed + list.unattributed

  return (
    <div className={className}>
      <div className="flex items-center gap-1" role="tablist" aria-label="Content kind">
        {CONTENT_KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            role="tab"
            aria-selected={k.key === active}
            onClick={() => setActive(k.key)}
            className={cx(
              'rounded-full px-3 py-1 font-space text-[11px] uppercase tracking-[0.1em] transition-colors',
              k.key === active ? 'bg-ink text-paper' : 'text-ink-faint hover:bg-surface-hover',
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-3">
        {total === 0 ? (
          <p className="font-space text-xs text-ink-faint">No {kind.noun} yet.</p>
        ) : list.attributed === 0 ? (
          <p className="font-space text-xs text-ink-faint">
            {total.toLocaleString('en-US')} {kind.noun}, none named {kind.named} yet.
          </p>
        ) : (
          <>
            <p className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              {list.attributed.toLocaleString('en-US')} {kind.noun} named {kind.named}
              {list.unattributed > 0 && <> · {list.unattributed.toLocaleString('en-US')} did not</>}
            </p>
            {list.items.length === 0 && (
              // Every event named a thing, and every one of those things is gone.
              <p className="mt-2 font-space text-xs text-ink-faint">All of them since removed.</p>
            )}
            <ol className="mt-2">
              {list.items.map((it) => (
                <li key={it.id} className="grid grid-cols-[48px_minmax(0,1fr)_minmax(80px,1fr)_auto] items-center gap-x-4 border-b border-hairline py-2.5">
                  <span className="block h-12 w-12 overflow-hidden rounded-md bg-track">
                    {it.image && (
                      // Plain <img>, as every cover on the dashboard is: the sources serve a
                      // sized variant by URL (coverThumbUrl), so next/image would add a hop.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coverThumbUrl(it.image, 96) ?? undefined} alt="" className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{it.title}</span>
                    {it.sub && (
                      <span className="block truncate font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{it.sub}</span>
                    )}
                  </span>
                  <span className="h-[7px] overflow-hidden rounded-full bg-track">
                    <span data-bar aria-hidden className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (it.count / max) * 100)}%` }} />
                  </span>
                  <span className="font-space text-[11px] font-bold tabular-nums text-ink">
                    {it.count.toLocaleString('en-US')}<span className="sr-only"> {kind.noun}</span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  )
}
