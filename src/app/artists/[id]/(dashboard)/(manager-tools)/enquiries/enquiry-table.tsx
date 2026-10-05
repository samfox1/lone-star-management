'use client'

import { cx } from '@/lib/cx'
import { useState, useTransition } from 'react'
import { fileSize, type PlayableAttachment } from '@/lib/enquiries/attachments'
import {
  artistsIn,
  filterByArtist,
  filterRows,
  kindFilter,
  kindOptions,
  snippet,
  type InboxFilter,
  type InboxRow,
  type KindOption,
} from '@/lib/enquiries/inbox'
import { safeHref } from '@/lib/url'
import { clockTime, shortDay } from '@/lib/manager-tools/format'
import { Icon } from '@/components/ui/icons'
import { useConfirm } from '../../confirm-dialog'
import { toast } from '../../toast'
import { deleteEnquiryAction, setEnquiryReadAction, signEnquiryAttachmentsAction } from './actions'
import { CAPS_LABEL, CAPS_META, MONO_META } from '../_ui/styles'
import { RowIcon } from '../_ui/row-icon'

function received(iso: string): string {
  const d = new Date(iso)
  return `${shortDay(d, { locale: 'en-US' })} · ${clockTime(d, 'en-US')}`
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
  rows: allRows,
  showArtist = false,
  kinds = [],
}: {
  rows: InboxRow[]
  /** Label each row with the artist it came in for — on for the roster-wide table, off on
   *  one artist's page where it would repeat on every line. */
  showArtist?: boolean
  /** The artist's own enquiry kinds, in their order, for the filter bar. Left out on the
   *  roster inbox, where each artist has their own list: the rows' kinds are offered. */
  kinds?: KindOption[]
}) {
  const [filter, setFilter] = useState<InboxFilter>('all')
  // Deleted here and not yet gone from `allRows`: the server revalidates, but the row
  // should leave the moment the database says it went.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const rows = allRows.filter((r) => !deletedIds.has(r.id))
  const [artistId, setArtistId] = useState<string>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.read_at).map((r) => r.id)),
  )
  const [audio, setAudio] = useState<{ id: string; items: PlayableAttachment[] } | null>(null)
  const [, startTransition] = useTransition()

  const visible = filterByArtist(
    filterRows(
      rows.map((r) => ({ ...r, read_at: readIds.has(r.id) ? (r.read_at ?? 'local') : null })),
      filter,
    ),
    artistId,
  )
  // Built from the rows themselves, not the whole roster: an artist with no enquiries is
  // an option that can only ever return nothing.
  const artistOptions = artistsIn(rows)
  const unreadCount = rows.filter((r) => !readIds.has(r.id)).length
  const filters: { key: InboxFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    ...kindOptions(kinds, allRows).map((k) => ({ key: kindFilter(k.slug), label: k.label })),
  ]
  const { ask, dialog } = useConfirm()

  async function remove(row: InboxRow) {
    if (!(await ask(`Delete the enquiry from ${row.name}? This can't be undone.`))) return
    const res = await deleteEnquiryAction(row.artistId, row.id)
    if (!res.ok) {
      toast(res.error ?? 'Could not delete that enquiry.', 'error')
      return
    }
    setDeletedIds((prev) => new Set(prev).add(row.id))
    setOpenId(null)
    toast('Enquiry deleted')
  }

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
        void setEnquiryReadAction(row.artistId, row.id, true)
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
      void setEnquiryReadAction(row.artistId, row.id, false)
    })
  }

  const colSpan = showArtist ? 6 : 5

  return (
    <div>
      {/* Rendered whether or not there is anything to filter. An empty page that shows
          only "no enquiries" says nothing about what lands here or how you will find it
          once it does. */}
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <span className={cx(CAPS_META, 'text-ink-muted')}>
          {/* Three text nodes, not plural(): one string shifts the letter-spaced line a
              sub-pixel (screenshot diff, 2026-10-01). */}
          {rows.length} {rows.length === 1 ? 'enquiry' : 'enquiries'}
          {unreadCount > 0 && ` · ${unreadCount} unread`}
        </span>
        {showArtist && artistOptions.length > 1 && (
          <label className="ml-3 flex items-center gap-1.5">
            <span className="sr-only">Filter by artist</span>
            <select
              value={artistId}
              onChange={(e) => setArtistId(e.target.value)}
              className="rounded-md border border-hairline bg-paper px-2 py-1 font-space text-[11px] text-ink-muted"
            >
              <option value="all">All artists</option>
              {artistOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="ml-auto flex flex-wrap gap-1">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              // The chosen filter is bold ink, no grey box behind it (Sam, 2026-10-02).
              className={`rounded-md px-2 py-1 font-space text-[11px] transition-colors ${
                filter === f.key ? 'font-bold text-ink' : 'text-ink-muted hover:text-ink'
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
            <tr className="border-y border-hairline">
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
                  {/* Name the NARROWEST true reason. With an artist and a filter both
                      active, "nothing in Demo yet" is false — there are demos, just not
                      this artist's — and a message that is wrong about why is worse than a
                      vague one. */}
                  {rows.length === 0
                    ? 'No enquiries yet. Booking and demo messages from the site’s contact form land here.'
                    : artistId !== 'all'
                      ? `Nothing here for ${artistOptions.find((a) => a.id === artistId)?.name ?? 'this artist'}.`
                      : filter === 'unread'
                        ? 'Nothing unread.'
                        : `Nothing in ${filters.find((f) => f.key === filter)?.label ?? 'this kind'} yet.`}
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
                    onDelete={() => void remove(r)}
                  />
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {dialog}
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cx(CAPS_LABEL, 'px-4 pb-2 pt-2 font-bold text-ink-faint', align === 'right' && 'text-right')}
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
  onDelete,
}: {
  row: InboxRow
  isRead: boolean
  isOpen: boolean
  showArtist: boolean
  colSpan: number
  audio: PlayableAttachment[] | null
  onToggle: () => void
  onMarkUnread: () => void
  onDelete: () => void
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
          <td className={cx(CAPS_META, 'px-4 py-2.5 text-ink-muted')}>
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
        <td className={cx(CAPS_META, 'px-4 py-2.5 text-ink-faint')}>
          {row.purposeLabel}
        </td>
        <td className="max-w-0 px-4 py-2.5">
          <span className="block truncate font-space text-xs text-ink-muted">{snippet(row.message)}</span>
        </td>
        <td className={cx('whitespace-nowrap px-4 py-2.5 text-right', MONO_META)}>
          {received(row.created_at)}
        </td>
        <td className={cx('whitespace-nowrap px-4 py-2.5 text-right', MONO_META)}>
          {row.attachmentCount > 0 ? row.attachmentCount : ''}
          {row.demo_url && <Icon name="external" size={11} />}
          {/* Not emailed. Says so plainly, because a table of messages reads as a record of
              messages DELIVERED, and right now none of them are. */}
          {(row.status === 'unroutable' || row.status === 'failed') && (
            <span title={row.status === 'unroutable' ? 'Not emailed — nobody is set to receive it' : 'Email failed to send'}>
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
                {/* Since 2026-09-28 there is no global inbox: an enquiry is emailed only to
                    the addresses this artist's managers set, so "unroutable" almost always
                    means none were set when it arrived. */}
                {row.status === 'unroutable'
                  ? 'Not emailed — nobody was set to receive it. The message is safe here.'
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
                          <span className={MONO_META}>{fileSize(a.bytes)}</span>
                        )}
                      </div>
                      {a.expired ? (
                        <p className={cx('mt-1', MONO_META)}>
                          Attachment expired — audio is deleted after 90 days.
                        </p>
                      ) : a.neverUploaded ? (
                        <p className={cx('mt-1', MONO_META)}>
                          Upload didn&rsquo;t complete — the sender never finished sending this.
                        </p>
                      ) : (
                        <>
                          <audio controls preload="none" src={a.url ?? undefined} className="mt-1.5 w-full" />
                          {a.url ? (
                            <RowIcon icon="download" label="Download" variant="bare" glyphSize={16} href={a.url} download={a.filename} className="mt-1" />
                          ) : null}
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
              {/* Bare glyphs named on hover, no words (Sam, 2026-10-02). */}
              <span className="ml-auto flex items-center gap-3">
                {isRead && (
                  <RowIcon
                    icon="mail"
                    label="Mark unread"
                    variant="bare"
                    glyphSize={16}
                    labelAlign="end"
                    onClick={(e) => {
                      e.stopPropagation()
                      onMarkUnread()
                    }}
                  />
                )}
                <RowIcon
                  icon="trash"
                  label="Delete"
                  variant="bare"
                  tone="danger"
                  glyphSize={16}
                  labelAlign="end"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete()
                  }}
                />
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
