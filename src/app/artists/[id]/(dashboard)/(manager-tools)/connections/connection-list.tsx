'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { displayAddress } from '@/lib/settings'
import { Icon } from '@/components/ui/icons'
import { buttonClass, listRowClass } from '@/components/ui/ui'
import type { ConnectionRow } from '@/lib/connections'
import { publishEntityAction } from '../../actions'
import { PublishBar } from '../../publish-bar'
import { toast } from '../../toast'
import { useSeeded } from '../_ui/use-seeded'
import { ConnectModal } from './connect-modal'
import { ConnectionMark } from './connection-mark'
import { ConnectionModal } from './connection-modal'
import { pullConnectionAction, syncProfileAction } from './actions'

/**
 * THE CONNECTIONS LIST (Sam, 2026-09-13): "one organized list with all of the current
 * platform accounts hooked up". One row per platform — mark, name, handle, and on the
 * right what it pulls in. No headings: the rail names the tool.
 *
 * Rows follow the tour list: no hairlines, the rhythm is the rows' own spacing, the
 * handle truncates before it can touch the chip beside it, and THE ROW IS THE BUTTON —
 * click it to open the connection's modal (Sam: "remove the 2 dots… You click on the row
 * and then you can edit it"). The chip's own actions stop the click there.
 *
 * No on-site ring (Sam, 2026-09-28: asked where a button is switched on and off, "Only in
 * the editor"). A connection is an account; the editor's Socials makes a site button from
 * it, and that button is this same link — so an edit here changes the button.
 */
export function ConnectionList({
  artistId,
  rows: initial,
  dirty = false,
  shopifyApp = false,
}: {
  artistId: string
  rows: ConnectionRow[]
  dirty?: boolean
  /** The Shopify app is set up: Shopify connects by going to Shopify (a server-made boolean). */
  shopifyApp?: boolean
}) {
  const router = useRouter()
  // Seeded from the server's rows and RE-SEEDED when they change (a refresh after a
  // connect), so an optimistic row can't outlive the truth (useSeeded).
  const [rows, setRows] = useSeeded(initial)
  const [connect, setConnect] = useState(false)

  async function publish(password: string) {
    // Snapshot only — whether a link is a button is the editor's live toggle; publish
    // pushes the edits made here.
    const res = await publishEntityAction('link', artistId, password)
    if (res.ok) router.refresh()
    return res
  }

  return (
    // The tour list's width (Sam, 2026-09-13: "these rows can be less wide"), and room
    // at the bottom for the floating Publish.
    <div className="mx-auto max-w-3xl pb-24">
      <div className="flex items-center justify-end">
        <button type="button" onClick={() => setConnect(true)} className={buttonClass('solid')}>
          <Icon name="plus" size={12} /> Connect
        </button>
      </div>

      <div className="mt-6">
        {rows.map((r) => (
          <ConnectionRowView
            key={r.key}
            artistId={artistId}
            row={r}
            shopifyApp={shopifyApp}
            onChange={(next) => setRows((all) => (next ? all.map((x) => (x.key === r.key ? next : x)) : all.filter((x) => x.key !== r.key)))}
          />
        ))}
      </div>

      {connect && (
        <ConnectModal artistId={artistId} taken={rows.map((r) => r.key)} shopifyApp={shopifyApp} onClose={() => setConnect(false)} onDone={() => router.refresh()} />
      )}

      <PublishBar pendingCount={0} dirty={dirty} onPublish={publish} noun="connections" />
    </div>
  )
}

function ConnectionRowView({
  artistId,
  row,
  shopifyApp,
  onChange,
}: {
  artistId: string
  row: ConnectionRow
  shopifyApp: boolean
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
        className={`group ${listRowClass} gap-4 py-3`}
      >
        <span className="flex w-5 flex-none justify-center text-ink">
          <ConnectionMark def={row.def} size={16} />
        </span>
        <span className="w-28 flex-none truncate text-sm font-semibold">{row.label}</span>
        <span className={cx('block h-6 min-w-0 flex-1 truncate font-space text-[13px] leading-6 text-ink-muted group-hover:text-ink', !shown && 'text-hairline')}>
          {shown || '—'}
        </span>

        <span className="flex w-40 flex-none items-center justify-end">
          {/* Just the word (Sam, 2026-09-13: "It either says synced or connect"). */}
          {row.state === 'synced' && (
            <span className="inline-flex items-center gap-1.5 font-space text-[10.5px] text-ink-muted">
              <Icon name="refresh" size={11} className={cx(pulling && 'animate-spin')} />
              synced
            </span>
          )}
          {row.state === 'failed' && (
            <span className="inline-flex items-center gap-1.5 font-space text-[10.5px] text-accent-red">
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
              className="inline-flex items-center gap-1.5 font-space text-[10.5px] text-ink-faint hover:text-ink disabled:opacity-50"
            >
              <Icon name="refresh" size={11} className={cx(pulling && 'animate-spin')} /> {pulling ? 'Syncing…' : 'Sync'}
            </button>
          )}
        </span>
      </div>

      <ConnectionModal artistId={artistId} row={row} open={open} shopifyApp={shopifyApp} onClose={() => setOpen(false)} onChange={onChange} />
    </>
  )
}
