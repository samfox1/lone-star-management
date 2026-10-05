'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { displayAddress } from '@/lib/settings'
import { Icon } from '@/components/ui/icons'
import type { ConnectionRow } from '@/lib/connections'
import { toast } from '../../toast'
import { AddPlus } from '../_ui/add-row'
import { RowChevron } from '../_ui/disclosure'
import { FOCUS_RING } from '../_ui/focus-ring'
import { LedgerSection } from '../_ui/ledger'
import { useSeeded } from '../_ui/use-seeded'
import { ConnectModal } from './connect-modal'
import { ConnectionMark } from './connection-mark'
import { ConnectionModal } from './connection-modal'
import { pullConnectionAction, syncProfileAction } from './actions'

/**
 * THE CONNECTIONS LIST (Sam, 2026-09-13): "one organized list with all of the current
 * platform accounts hooked up". One row per platform — mark, name, handle, and on the
 * right what it pulls in, then a chevron.
 *
 * Brand's grammar since Batch 3 (Sam, 2026-10-02, prototypes/batch3_20261002.html): one
 * ledger section, rows split by a soft hairline, and a quiet "+ Connect" ending the list
 * that opens the SAME multi-select Connect grid the solid button did. THE ROW IS THE
 * BUTTON and it still opens the connection's POP-UP (Sam: "I would like for the pop up to
 * stay for connections"); the chip's own actions stop the click there. Hover is colour
 * only: the handle and chevron darken, the row neither grows nor greys.
 *
 * No width and no Publish of its own: the tools frame sets the one page width, and the
 * page renders the shared rising Publish bar (page.tsx).
 *
 * No on-site ring (Sam, 2026-09-28: asked where a button is switched on and off, "Only in
 * the editor"). A connection is an account; the editor's Socials makes a site button from
 * it, and that button is this same link — so an edit here changes the button.
 */
export function ConnectionList({
  artistId,
  rows: initial,
  shopifyApp = false,
  youtubeApp = false,
  eventbriteApp = false,
  createPages,
}: {
  artistId: string
  rows: ConnectionRow[]
  /** The Shopify app is set up: Shopify connects by going to Shopify (a server-made boolean). */
  shopifyApp?: boolean
  /** The Google app is set up: YouTube can connect by signing in to Google (a server-made boolean). */
  youtubeApp?: boolean
  /** The Eventbrite app is set up: Eventbrite can connect by signing in (a server-made boolean). */
  eventbriteApp?: boolean
  /** Links that make a page on a platform the artist has none of yet (MusicBrainz), by key. */
  createPages?: Partial<Record<string, string>>
}) {
  const router = useRouter()
  // Seeded from the server's rows and RE-SEEDED when they change (a refresh after a
  // connect), so an optimistic row can't outlive the truth (useSeeded).
  const [rows, setRows] = useSeeded(initial)
  const [connect, setConnect] = useState(false)

  return (
    <LedgerSection label="Connected">
      {/* Pulled out 12px, so the rows' padding lines the marks up with the ledger's column. */}
      <div className="-mx-3">
        {rows.map((r) => (
          <ConnectionRowView
            key={r.key}
            artistId={artistId}
            row={r}
            shopifyApp={shopifyApp}
            eventbriteApp={eventbriteApp}
            onChange={(next) => setRows((all) => (next ? all.map((x) => (x.key === r.key ? next : x)) : all.filter((x) => x.key !== r.key)))}
          />
        ))}
      </div>

      <div className="mt-2.5 flex h-9 items-center">
        <AddPlus label="Connect" onClick={() => setConnect(true)} />
      </div>

      {connect && (
        <ConnectModal
          artistId={artistId}
          taken={rows.map((r) => r.key)}
          shopifyApp={shopifyApp}
          youtubeApp={youtubeApp}
          eventbriteApp={eventbriteApp}
          createPages={createPages}
          onClose={() => setConnect(false)}
          onDone={() => router.refresh()}
        />
      )}
    </LedgerSection>
  )
}

/** The soft line between two rows (a shadow, so it takes no room), none above the first:
 *  the disclosure rows' divider (_ui/disclosure.tsx), which never opens here. */
const ROW_DIVIDER = '[&:not(:first-child)]:shadow-[0_-1px_0_var(--color-hairline-soft)]'

function ConnectionRowView({
  artistId,
  row,
  shopifyApp,
  eventbriteApp,
  onChange,
}: {
  artistId: string
  row: ConnectionRow
  shopifyApp: boolean
  eventbriteApp: boolean
  onChange: (next: ConnectionRow | null) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pulling, setPulling] = useState(false)
  /** The latch: two fast clicks both read `pulling === false`; only the ref stops the second. */
  const pullingRef = useRef(false)

  const shown = row.url ? displayAddress(row.url) : (row.sourceId ?? '')

  /** The chip's own action: first pull for a never-synced profile (the id comes out of
   *  the link, nothing typed), or a retry for one that failed. */
  async function pull(e: React.MouseEvent) {
    e.stopPropagation()
    if (pullingRef.current) return
    pullingRef.current = true
    setPulling(true)
    try {
      const res = row.state === 'connect' ? await syncProfileAction(artistId, row.key) : await pullConnectionAction(artistId, row.key)
      if (res.ok) {
        toast(res.message ?? `${row.label} synced`)
        router.refresh()
      } else toast(res.error ?? `${row.label} didn’t sync.`, 'error')
    } finally {
      pullingRef.current = false
      setPulling(false)
    }
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={row.label}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        // `group/trow`: the chevron (RowChevron) darkens with its row, as the disclosure rows' does.
        className={cx('group/trow flex w-full cursor-pointer items-center gap-3.5 rounded-xl p-3 text-left', ROW_DIVIDER, FOCUS_RING, 'focus-visible:-outline-offset-2')}
      >
        <span className="flex w-5 flex-none justify-center text-ink">
          <ConnectionMark def={row.def} size={16} />
        </span>
        {/* On a phone the handle drops under the name; from `sm` up it is a 380px column. */}
        <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3.5">
          <span className="min-w-0 flex-1 text-[15px] font-medium leading-[1.35] text-ink [overflow-wrap:anywhere] sm:min-w-[120px]">{row.label}</span>
          <span
            className={cx(
              'block min-w-0 truncate font-space text-[12px] text-ink-muted transition-colors duration-150 group-hover/trow:text-ink sm:flex-[0_1_380px]',
              !shown && 'text-hairline',
            )}
          >
            {shown || '—'}
          </span>
        </span>

        <span className="flex min-w-[84px] flex-none items-center justify-end">
          {/* Just the word (Sam, 2026-09-13: "It either says synced or connect"). */}
          {row.state === 'synced' && (
            <span className="inline-flex items-center gap-1.5 font-space text-[11px] text-ink-muted">
              <Icon name="refresh" size={11} className={cx(pulling && 'animate-spin')} />
              synced
            </span>
          )}
          {row.state === 'failed' && (
            <span className="inline-flex items-center gap-1.5 font-space text-[11px] text-accent-red">
              <Icon name="alert" size={11} />
              Couldn’t connect ·
              <button type="button" onClick={pull} disabled={pulling} className="text-ink hover:text-accent disabled:opacity-50">
                {pulling ? 'Retrying…' : 'Retry'}
              </button>
            </span>
          )}
          {/* Not "Connect" — the check already says it is (Sam, 2026-09-13). The account is
              here; its catalog has never been pulled. */}
          {row.state === 'connect' && (
            <button
              type="button"
              onClick={pull}
              disabled={pulling}
              aria-label={`Sync ${row.label}`}
              className="inline-flex items-center gap-1.5 font-space text-[11px] text-ink-faint transition-colors hover:text-ink disabled:opacity-50"
            >
              <Icon name="refresh" size={11} className={cx(pulling && 'animate-spin')} /> {pulling ? 'Syncing…' : 'Sync'}
            </button>
          )}
        </span>
        <RowChevron open={false} />
      </div>

      <ConnectionModal
        artistId={artistId}
        row={row}
        open={open}
        shopifyApp={shopifyApp}
        eventbriteApp={eventbriteApp}
        onClose={() => setOpen(false)}
        onChange={onChange}
      />
    </>
  )
}
