'use client'

import { useState, useTransition } from 'react'
import { fileSize, type PlayableAttachment } from '@/lib/enquiry-attachments'
import { filterRows, snippet, type InboxFilter, type InboxRow } from '@/lib/enquiry-inbox'
import { safeHref } from '@/lib/url'
import { Icon } from '@/components/ui/icons'
import { markEnquiryReadAction } from '../actions'
import { markEnquiryUnreadAction, signEnquiryAttachmentsAction } from './actions'

const PURPOSE_LABEL: Record<string, string> = { booking: 'Booking', demo: 'Demo', other: 'Contact' }

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'demos', label: 'Demos' },
]

function received(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

/**
 * The enquiries table.
 *
 * A TABLE, deliberately, and not the mail client this briefly was. Nobody answers a
 * booking from in here — they reply from their own mail. This exists so a message is
 * never lost, which matters most right now because sending is not switched on yet: for
 * the moment this IS the delivery mechanism.
 *
 * That changes what good looks like. Dense and scannable beats comfortable. Nothing is
 * auto-opened, because you came to look something up rather than to read. And the table
 * with its filters renders even when there is nothing in it — an empty page that shows
 * only "no enquiries" tells you nothing about what will appear here or how you will find
 * it later.
 *
 * A row expands in place for the full message, because a snippet cannot show a message
 * and a table cannot show a paragraph.
 */
export function EnquiryTable({
  rows,
  showArtist = false,
}: {
  rows: InboxRow[]
  /** Label each row with the artist it came in for — on for the roster-wide table, off on
   *  one artist's page where it would repeat on every line. */
  showArtist?: boolean
}) {
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.read_at).map((r) => r.id)),
  )
  const [audio, setAudio] = useState<{ id: string; items: PlayableAttachment[] } | null>(null)
  const [, startTransition] = useTransition()

  const visible = filterRows(
    rows.map((r) => ({ ...r, read_at: readIds.has(r.id) ? (r.read_at ?? 'local') : null })),
    filter,
  )
  const unreadCount = rows.filter((r) => !readIds.has(r.id)).length

  function toggle(row: InboxRow) {
    const opening = openId !== row.id
    setOpenId(opening ? row.id : null)
    if (!opening) return

    if (row.attachmentCount > 0 && audio?.id !== row.id) {
      // Signed only when a row is opened: a page of rows would otherwise mint URLs that
      // mostly expire unread, and short-lived means short-lived.
      signEnquiryAttachmentsAction(row.id).then((items) => setAudio({ id: row.id, items }))
    }
    if (!readIds.has(row.id)) {
      setReadIds((prev) => new Set(prev).add(row.id))
      startTransition(() => {
        void markEnquiryReadAction(row.artistId, row.id)
      })
    }
  }

  function markUnread(row: InboxRow) {
    setReadIds((prev) => {
      const next = new Set(prev)
      next.delete(row.id)
      return next
    })
    startTransition(() => {
      void markEnquiryUnreadAction(row.artistId, row.id)
    })
  }

  const colSpan = showArtist ? 6 : 5

  return (
    <div className="overflow-hidden rounded-xl border border-hairline">
      {/* Rendered whether or not there is anything to filter. An empty page that shows
          only "no enquiries" says nothing about what lands here or how you will find it
          once it does. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2">
        <span className="font-space text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          {rows.length} {rows.length === 1 ? 'enquiry' : 'enquiries'}
          {unreadCount > 0 && ` · ${unreadCount} unread`}
        </span>
        <div className="ml-auto flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`rounded-md px-2 py-1 font-space text-[11px] transition-colors ${
                filter === f.key ? 'bg-surface font-bold text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-hairline">
              {showArtist && <Th>Artist</Th>}
              <Th>From</Th>
              <Th>Type</Th>
              <Th>Message</Th>
              <Th align="right">Received</Th>
              <Th align="right">Files</Th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center font-space text-xs text-ink-faint">
                  {rows.length === 0
                    ? 'No enquiries yet. Booking and demo messages from the site’s contact form land here.'
                    : filter === 'unread'
                      ? 'Nothing unread.'
                      : 'No demos yet.'}
                </td>
              </tr>
            ) : (
              visible.map((r) => {
                const isRead = readIds.has(r.id)
                const isOpen = openId === r.id
                return (
                  <FragmentRow
                    key={r.id}
                    row={r}
                    isRead={isRead}
                    isOpen={isOpen}
                    showArtist={showArtist}
                    colSpan={colSpan}
                    audio={audio?.id === r.id ? audio.items : null}
                    onToggle={() => toggle(r)}
                    onMarkUnread={() => markUnread(r)}
                  />
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-4 pb-2 pt-2 font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  )
}

function FragmentRow({
  row,
  isRead,
  isOpen,
  showArtist,
  colSpan,
  audio,
  onToggle,
  onMarkUnread,
}: {
  row: InboxRow
  isRead: boolean
  isOpen: boolean
  showArtist: boolean
  colSpan: number
  audio: PlayableAttachment[] | null
  onToggle: () => void
  onMarkUnread: () => void
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        aria-expanded={isOpen}
        className={`cursor-pointer border-b border-hairline-soft transition-colors hover:bg-surface-hover ${
          isOpen ? 'bg-surface' : ''
        }`}
      >
        {showArtist && (
          <td className="px-4 py-2.5 font-space text-[11px] uppercase tracking-[0.06em] text-ink-muted">
            {row.artistName}
          </td>
        )}
        <td className="px-4 py-2.5">
          <span className="flex items-center gap-1.5">
            {!isRead && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
            <span className={`text-sm ${isRead ? 'text-ink-muted' : 'font-bold'}`}>{row.name}</span>
            <span className="sr-only">{isRead ? 'read' : 'unread'}</span>
          </span>
        </td>
        <td className="px-4 py-2.5 font-space text-[11px] uppercase tracking-[0.06em] text-ink-faint">
          {PURPOSE_LABEL[row.purpose] ?? row.purpose}
        </td>
        <td className="max-w-0 px-4 py-2.5">
          <span className="block truncate font-space text-xs text-ink-muted">{snippet(row.message)}</span>
        </td>
        <td className="whitespace-nowrap px-4 py-2.5 text-right font-space text-[11px] text-ink-faint">
          {received(row.created_at)}
        </td>
        <td className="whitespace-nowrap px-4 py-2.5 text-right font-space text-[11px] text-ink-faint">
          {row.attachmentCount > 0 ? row.attachmentCount : ''}
          {row.demo_url && <Icon name="external" size={11} />}
          {/* Not emailed. Says so plainly, because a table of messages reads as a record of
              messages DELIVERED, and right now none of them are. */}
          {(row.status === 'unroutable' || row.status === 'failed') && (
            <span title={row.status === 'unroutable' ? 'Not emailed — mail is not configured' : 'Email failed to send'}>
              {' '}
              <Icon name="alert" size={11} />
            </span>
          )}
        </td>
      </tr>

      {isOpen && (
        <tr className="border-b border-hairline-soft bg-surface">
          <td colSpan={colSpan} className="px-4 pb-4 pt-1">
            {(row.status === 'unroutable' || row.status === 'failed') && (
              <p className="mb-3 font-space text-[11px] text-ink-muted">
                {row.status === 'unroutable'
                  ? 'Not emailed — no sending address is configured yet. The message is safe here.'
                  : 'The notification email failed to send. The message is safe here.'}
              </p>
            )}
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{row.message}</p>

            {/* https-only at the door and by a CHECK, but still through safeHref here:
                render-time sanitisation is the must-have guard, because a stored row can
                outlive the validator that let it in. */}
            {row.demo_url && safeHref(row.demo_url) && (
              <p className="mt-3 font-space text-xs">
                <span className="text-ink-faint">Demo: </span>
                <a
                  href={safeHref(row.demo_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-accent underline underline-offset-2"
                >
                  {row.demo_url}
                </a>
              </p>
            )}

            {row.attachmentCount > 0 && (
              <ul className="mt-3 space-y-2">
                {audio === null ? (
                  <li className="font-space text-xs text-ink-faint">Loading audio…</li>
                ) : (
                  audio.map((a) => (
                    <li key={a.id} className="rounded-lg border border-hairline bg-paper px-3 py-2">
                      <div className="flex items-baseline gap-2">
                        <span className="font-space text-xs font-medium">{a.filename}</span>
                        {fileSize(a.bytes) && (
                          <span className="font-space text-[11px] text-ink-faint">{fileSize(a.bytes)}</span>
                        )}
                      </div>
                      {a.expired ? (
                        <p className="mt-1 font-space text-[11px] text-ink-faint">
                          Attachment expired — audio is deleted after 90 days.
                        </p>
                      ) : a.neverUploaded ? (
                        <p className="mt-1 font-space text-[11px] text-ink-faint">
                          Upload didn&rsquo;t complete — the sender never finished sending this.
                        </p>
                      ) : (
                        <>
                          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                          <audio controls preload="none" src={a.url ?? undefined} className="mt-1.5 w-full" />
                          <a
                            href={a.url ?? undefined}
                            download={a.filename}
                            className="mt-1 inline-block font-space text-[11px] text-ink-muted underline underline-offset-2"
                          >
                            Download
                          </a>
                        </>
                      )}
                    </li>
                  ))
                )}
              </ul>
            )}

            <div className="mt-3 flex items-center gap-3 font-space text-[11px]">
              <a
                href={`mailto:${row.email}?subject=${encodeURIComponent('Re: your enquiry')}`}
                onClick={(e) => e.stopPropagation()}
                className="text-accent underline underline-offset-2"
              >
                {row.email}
              </a>
              {isRead && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onMarkUnread()
                  }}
                  className="text-ink-muted underline underline-offset-2 hover:text-ink"
                >
                  Mark unread
                </button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
