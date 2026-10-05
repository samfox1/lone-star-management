'use client'

import { useCallback, useState, useTransition } from 'react'
import { cx } from '@/lib/cx'
import { fileSize, type PlayableAttachment } from '@/lib/enquiries/attachments'
import {
  artistsIn,
  filterByArtist,
  filterRows,
  kindFilter,
  kindOptions,
  searchRows,
  snippet,
  type InboxFilter,
  type InboxRow,
  type KindOption,
} from '@/lib/enquiries/inbox'
import { deletionNote } from '@/lib/enquiries/retention'
import { safeHref } from '@/lib/url'
import { clockTime, mailtoHref, shortDay } from '@/lib/manager-tools/format'
import { Icon } from '@/components/ui/icons'
import { useConfirm } from '../../confirm-dialog'
import { toast } from '../../toast'
import { deleteEnquiryAction, setEnquiryReadAction, signEnquiryAttachmentsAction } from './actions'
import { copyText, useFlash } from '../_ui/copy'
import { Highlight } from '../_ui/highlight'
import { ListToolbar, QUIET, SearchLine, STICKY_TOP, TOUCH_VISIBLE, WordChoice, type Word } from '../_ui/list-toolbar'
import { HoverLabel, RowIcon } from '../_ui/row-icon'
import { CAPS_META, MONO_META } from '../_ui/styles'
import { FOCUS_RING } from '../_ui/focus-ring'

/** "Oct 1, 2026": the row's day. */
const day = (iso: string) => shortDay(new Date(iso), { locale: 'en-US' })
/** "Oct 1, 2026 · 1:39 PM": when it arrived, in full, once the row is open. */
function received(iso: string): string {
  const d = new Date(iso)
  return `${shortDay(d, { locale: 'en-US' })} · ${clockTime(d, 'en-US')}`
}

/** The subject a reply opens with. */
const REPLY_SUBJECT = encodeURIComponent('Re: your enquiry')

/** Never emailed: nobody was set to receive it, or the send failed. Said plainly, because a
 *  list of messages reads as a record of messages DELIVERED. */
const notEmailed = (status: string) => status === 'unroutable' || status === 'failed'

/**
 * THE ENQUIRIES LIST, on the Subscribers page's layout (Sam, 2026-10-05: "I want to restyle
 * enquiries. Look at subscribers, I want it to be closer to that set up", which replaced the
 * table he had kept until then). The same toolbar (_ui/list-toolbar.tsx: an underline search,
 * plain words for the filters, sticky under the header), the same rows (hairlines, a mono date
 * on the right, faint glyphs that light with their row), the same quiet empty line, the same
 * frame (the tools shell's). No title and no count line: the unread count rides on the
 * "Unread" word.
 *
 * Not a mail client. Nobody answers a booking from in here; they reply from their own mail
 * (the Reply glyph is a mailto:). The list exists so a message is never lost, and nothing is
 * opened for you on arrival: you came to look something up.
 *
 * A row opens in place for the whole message, its demo link and its audio (signed only then),
 * and opening marks it read; Mark unread puts it back.
 *
 * ONE COMPONENT, TWO PAGES: this artist's Enquiries tool, and the roster-wide inbox at
 * /artists, which passes `showArtist` (each row names its artist and an artist selector
 * appears) and its own `stickyTop` (that page's header does not stick).
 */
export function EnquiriesLedger({
  rows: allRows,
  showArtist = false,
  kinds = [],
  stickyTop = STICKY_TOP,
}: {
  rows: InboxRow[]
  /** Name the artist on each row: on for the roster-wide inbox, off on one artist's page
   *  where it would repeat on every line. */
  showArtist?: boolean
  /** The artist's own enquiry kinds, in their order, for the filter words. Left out on the
   *  roster inbox, where each artist has their own list: the rows' kinds are offered. */
  kinds?: KindOption[]
  /** Where the toolbar sticks (list-toolbar.tsx). */
  stickyTop?: readonly string[]
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<InboxFilter>('all')
  // Deleted here and not yet gone from `allRows`: the server revalidates, but the row
  // should leave the moment the database says it went.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const rows = allRows.filter((r) => !deletedIds.has(r.id))
  const [artistId, setArtistId] = useState<string>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set(rows.filter((r) => r.read_at).map((r) => r.id)))
  const [audio, setAudio] = useState<{ id: string; items: PlayableAttachment[] } | null>(null)
  const [said, setSaid] = useState('')
  const [, startTransition] = useTransition()
  // One clock for every row's "deleted in N days", read once per mount so the notes agree.
  const [now] = useState(() => Date.now())
  const { ask, dialog } = useConfirm()

  const narrowed = filterByArtist(
    filterRows(
      rows.map((r) => ({ ...r, read_at: readIds.has(r.id) ? (r.read_at ?? 'local') : null })),
      filter,
    ),
    artistId,
  )
  const visible = searchRows(narrowed, query)
  const needle = query.trim()
  // Built from the rows themselves, not the whole roster: an artist with no enquiries is
  // an option that can only ever return nothing.
  const artistOptions = artistsIn(rows)
  const unreadCount = rows.filter((r) => !readIds.has(r.id)).length
  const words: Word<InboxFilter>[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread', extra: unreadCount > 0 ? unreadCount : undefined },
    ...kindOptions(kinds, allRows).map((k) => ({ key: kindFilter(k.slug), label: k.label })),
  ]

  async function remove(row: InboxRow) {
    if (!(await ask(`Delete the enquiry from ${row.name}? This can't be undone.`))) return
    const res = await deleteEnquiryAction(row.artistId, row.id)
    if (!res.ok) {
      toast(res.error ?? 'Could not delete that enquiry.', 'error')
      return
    }
    setDeletedIds((prev) => new Set(prev).add(row.id))
    setOpenId((id) => (id === row.id ? null : id))
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

  const copied = useCallback((email: string) => setSaid(`Copied ${email}`), [])

  // Name the NARROWEST true reason. With an artist and a filter both active, "nothing in
  // Demo yet" is false — there are demos, just not this artist's — and a message that is
  // wrong about why is worse than a vague one. The search is the narrowest of all.
  const emptyReason =
    narrowed.length > 0
      ? `No enquiries match “${needle}”.`
      : artistId !== 'all'
        ? `Nothing here for ${artistOptions.find((a) => a.id === artistId)?.name ?? 'this artist'}.`
        : filter === 'unread'
          ? 'Nothing unread.'
          : `Nothing in ${words.find((w) => w.key === filter)?.label ?? 'this kind'} yet.`

  return (
    <div>
      {rows.length === 0 ? (
        <p className={QUIET}>No enquiries yet.</p>
      ) : (
        <>
          <ListToolbar data-enquiries-toolbar="" stickyTop={stickyTop}>
            <SearchLine value={query} onChange={setQuery} label="Search enquiries" />
            {showArtist && artistOptions.length > 1 ? (
              <label className="relative flex-none">
                <span className="sr-only">Filter by artist</span>
                {/* A line, not a box (Sam, 2026-10-02), like the search beside it. */}
                <select
                  value={artistId}
                  onChange={(e) => setArtistId(e.target.value)}
                  className={cx(
                    'appearance-none border-b border-hairline bg-transparent py-[9px] pl-0 pr-6 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink focus:border-ink',
                    FOCUS_RING,
                  )}
                >
                  <option value="all">All artists</option>
                  {artistOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Icon name="chevronsUpDown" size={12} className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-ink-faint" />
              </label>
            ) : null}
            <WordChoice label="Filter" words={words} value={filter} onChange={setFilter} />
          </ListToolbar>

          {visible.length ? (
            <ul aria-label="Enquiries">
              {visible.map((r) => (
                <EnquiryRow
                  key={r.id}
                  row={r}
                  isRead={readIds.has(r.id)}
                  isOpen={openId === r.id}
                  showArtist={showArtist}
                  needle={needle}
                  audio={audio?.id === r.id ? audio.items : null}
                  note={deletionNote(r.status, r.created_at, now)}
                  onToggle={() => toggle(r)}
                  onMarkUnread={() => markUnread(r)}
                  onDelete={() => void remove(r)}
                  onCopied={copied}
                />
              ))}
            </ul>
          ) : (
            <p className={QUIET}>{emptyReason}</p>
          )}
        </>
      )}
      {/* What a copy did, for a screen reader: the flashing icon only changes a label. */}
      <span role="status" className="sr-only">
        {said}
      </span>
      {dialog}
    </div>
  )
}

/**
 * One enquiry: who sent it and their address over its kind and first line, the day on the
 * right with when it will be deleted under it, then the glyphs (Copy address, Reply, Delete),
 * faint until the row is hovered, as on Subscribers. Unread: the name is bold and a small dot
 * sits in the gutter to its left. Below `sm` the day drops under the text.
 *
 * The text and the day are ONE button (it opens the row); the glyphs sit outside it, so no
 * control is nested in another and a glyph's click never opens the row.
 */
function EnquiryRow({
  row,
  isRead,
  isOpen,
  showArtist,
  needle,
  audio,
  note,
  onToggle,
  onMarkUnread,
  onDelete,
  onCopied,
}: {
  row: InboxRow
  isRead: boolean
  isOpen: boolean
  showArtist: boolean
  needle: string
  audio: PlayableAttachment[] | null
  /** "deleted in 12 days": when the nightly job removes it (src/lib/enquiries/retention.ts). */
  note: string | null
  onToggle: () => void
  onMarkUnread: () => void
  onDelete: () => void
  onCopied: (email: string) => void
}) {
  const [copied, flash] = useFlash<true>()
  const copy = async () => {
    if (await copyText(row.email)) {
      flash(true)
      onCopied(row.email)
    }
  }
  const unsent = notEmailed(row.status)
  // The small print under the day: honest about delivery, then how long it is kept.
  const meta = [unsent ? (row.status === 'failed' ? 'email failed' : 'not emailed') : null, note].filter(Boolean).join(' · ')
  const demo = row.demo_url ? safeHref(row.demo_url) : undefined

  return (
    <li data-enquiry="" className="group/ledger relative border-b border-hairline-soft last:border-b-0">
      {!isRead ? <span aria-hidden="true" className="absolute -left-3.5 top-[22px] h-1.5 w-1.5 rounded-full bg-accent" /> : null}
      <div className="flex items-center gap-x-3 py-[13px] sm:gap-x-6">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className={cx('flex min-w-0 flex-1 cursor-pointer flex-col gap-y-1.5 rounded-[3px] text-left sm:flex-row sm:items-center sm:gap-x-6', FOCUS_RING)}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-y-1">
            <span className="flex min-w-0 items-baseline gap-x-2.5">
              <span className={cx('min-w-0 max-w-[70%] flex-none truncate text-[15px] text-ink', !isRead && 'font-semibold')}>
                <Highlight text={row.name} needle={needle} />
              </span>
              <span className="sr-only">{isRead ? 'read' : 'unread'}</span>
              <span className="min-w-0 truncate text-[13px] text-ink-faint">
                <Highlight text={row.email} needle={needle} />
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-x-2.5">
              {showArtist ? <span className={cx(CAPS_META, 'flex-none text-ink-muted')}>{row.artistName}</span> : null}
              <span className={cx(CAPS_META, 'flex-none text-ink-faint')}>{row.purposeLabel}</span>
              {row.attachmentCount > 0 ? (
                <span className="relative flex flex-none items-center gap-0.5 font-space text-[11px] text-ink-faint">
                  <Icon name="tracks" size={12} />
                  {row.attachmentCount}
                  <span className="sr-only">{row.attachmentCount === 1 ? 'audio file' : 'audio files'}</span>
                  <HoverLabel label={row.attachmentCount === 1 ? '1 audio file' : `${row.attachmentCount} audio files`} />
                </span>
              ) : null}
              {demo ? (
                <span className="relative flex flex-none text-ink-faint">
                  <Icon name="external" size={12} />
                  <span className="sr-only">demo link</span>
                  <HoverLabel label="Demo link" />
                </span>
              ) : null}
              <span className="min-w-0 truncate text-[13px] text-ink-muted">
                <Highlight text={snippet(row.message)} needle={needle} />
              </span>
            </span>
          </span>
          <span className="flex-none sm:text-right">
            {/* suppressHydrationWarning: the server and the browser each read their own clock
                and zone, and a day can tick over between them. */}
            <span className="block whitespace-nowrap font-space text-[12px] text-ink-muted" suppressHydrationWarning>
              {day(row.created_at)}
            </span>
            {meta ? (
              <span className={cx('mt-0.5 block sm:whitespace-nowrap', MONO_META)} suppressHydrationWarning>
                {meta}
              </span>
            ) : null}
          </span>
        </button>
        <span className="flex flex-none gap-1 self-center">
          <RowIcon
            icon={copied ? 'check' : 'copy'}
            label={copied ? 'Copied' : 'Copy address'}
            tone="accent"
            onClick={copy}
            className={cx(TOUCH_VISIBLE, copied && 'opacity-100! text-accent!')}
          />
          <RowIcon icon="reply" label="Reply" tone="accent" labelAlign="end" href={`${mailtoHref(row.email)}?subject=${REPLY_SUBJECT}`} className={TOUCH_VISIBLE} />
          <RowIcon icon="trash" label="Delete" tone="danger" labelAlign="end" onClick={onDelete} className={TOUCH_VISIBLE} />
        </span>
      </div>

      {isOpen ? (
        <div data-enquiry-detail="" className="pb-6">
          {unsent ? (
            <p className="mb-3 font-space text-[12px] text-ink-muted">
              {/* Since 2026-09-28 there is no global inbox: an enquiry is emailed only to the
                  addresses this artist's managers set, so "unroutable" almost always means none
                  were set when it arrived. */}
              {row.status === 'unroutable'
                ? 'Not emailed: nobody was set to receive it. The message is safe here.'
                : 'The email failed to send. The message is safe here.'}
            </p>
          ) : null}
          <p className="max-w-[68ch] whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{row.message}</p>

          {/* https-only at the door and by a CHECK, but still through safeHref here:
              render-time sanitisation is the must-have guard, because a stored row can
              outlive the validator that let it in. */}
          {demo ? (
            <p className="mt-4 font-space text-[12px]">
              <span className="text-ink-faint">Demo </span>
              <a href={demo} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline underline-offset-2">
                {row.demo_url}
              </a>
            </p>
          ) : null}

          {row.attachmentCount > 0 ? (
            <ul className="mt-4 max-w-[560px]">
              {audio === null ? (
                <li className={MONO_META}>Loading audio…</li>
              ) : (
                audio.map((a) => (
                  <li key={a.id} className="border-t border-hairline-soft py-2.5 first:border-t-0 first:pt-0">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-[13px] text-ink">{a.filename}</span>
                      {fileSize(a.bytes) ? <span className={MONO_META}>{fileSize(a.bytes)}</span> : null}
                      {a.url && !a.expired && !a.neverUploaded ? (
                        <RowIcon icon="download" label="Download" variant="bare" tone="accent" glyphSize={16} labelAlign="end" href={a.url} download={a.filename} className="ml-auto" />
                      ) : null}
                    </div>
                    {a.expired ? (
                      <p className={cx('mt-1', MONO_META)}>Attachment expired: audio is deleted after 90 days.</p>
                    ) : a.neverUploaded ? (
                      <p className={cx('mt-1', MONO_META)}>Upload didn&rsquo;t complete: the sender never finished sending this.</p>
                    ) : (
                      <audio controls preload="none" src={a.url ?? undefined} className="mt-2 h-9 w-full" />
                    )}
                  </li>
                ))
              )}
            </ul>
          ) : null}

          <div className="mt-4 flex items-center gap-3">
            <span className={MONO_META} suppressHydrationWarning>
              {received(row.created_at)}
            </span>
            {/* Bare glyph, named on hover (Sam, 2026-10-02). Opening marked it read; this
                puts it back in the unread pile. */}
            {isRead ? (
              <RowIcon icon="mail" label="Mark unread" variant="bare" glyphSize={16} labelAlign="end" onClick={onMarkUnread} className="ml-auto mr-2" />
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  )
}
