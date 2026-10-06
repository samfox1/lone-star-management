'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { cx } from '@/lib/cx'
import { fileSize, type PlayableAttachment } from '@/lib/enquiries/attachments'
import {
  ENQUIRY_SORTS,
  artistsIn,
  filterByArtist,
  filterRows,
  kindFilter,
  kindOptions,
  notEmailed,
  searchRows,
  snippet,
  sortRows,
  type EnquirySort,
  type InboxRow,
  type KindOption,
} from '@/lib/enquiries/inbox'
import { deletionNote } from '@/lib/enquiries/retention'
import { safeHref } from '@/lib/url'
import { clockTime, mailtoHref, shortDay } from '@/lib/manager-tools/format'
import { Icon } from '@/components/ui/icons'
import { CardModal } from '../../card-modal'
import { useConfirm } from '../../confirm-dialog'
import { KvRow } from '../../modal-kit'
import { toast } from '../../toast'
import { deleteEnquiryAction, setEnquiryReadAction, signEnquiryAttachmentsAction } from './actions'
import { ChoiceMenu } from '../_ui/choice-menu'
import { copyText, useFlash } from '../_ui/copy'
import { Highlight } from '../_ui/highlight'
import { LIST_COLUMN, ListToolbar, QUIET, SearchLine, STICKY_TOP, TOUCH_VISIBLE, WordChoice, type Word } from '../_ui/list-toolbar'
import { HoverLabel, RowIcon } from '../_ui/row-icon'
import { CAPS_META, MONO_META } from '../_ui/styles'
import { FOCUS_RING } from '../_ui/focus-ring'

/** "Oct 1, 2026": the row's day. */
const day = (iso: string) => shortDay(new Date(iso), { locale: 'en-US' })
/** "Oct 1, 2026 · 1:39 PM": when it arrived, in full, in the open enquiry. */
function received(iso: string): string {
  const d = new Date(iso)
  return `${shortDay(d, { locale: 'en-US' })} · ${clockTime(d, 'en-US')}`
}

/** A reply: a mailto: to the sender (each side of the @ encoded), with a subject. */
const replyHref = (email: string) => `${mailtoHref(email)}?subject=${encodeURIComponent('Re: your enquiry')}`

type ReadFilter = 'all' | 'unread'
/** The Type menu's "every kind". Not a slug: a kind's slug is never empty. */
const ALL_TYPES = ''

/**
 * THE ENQUIRIES LIST, on the Subscribers page's layout (Sam, 2026-10-05: "I want to restyle
 * enquiries. Look at subscribers, I want it to be closer to that set up", which replaced the
 * table he had kept until then). The same toolbar (_ui/list-toolbar.tsx: an underline search,
 * plain words, sticky under the header), the same rows (hairlines, a mono date on the right,
 * faint glyphs that light with their row), the same quiet empty line, the same 960px column.
 *
 * Same day, Sam again: the kind is not on the rows ("We can sort for those") but in a Type
 * menu; a Sort menu (Newest, Oldest, Unread first, Not emailed first, Name A–Z); and an enquiry opens in a
 * MODAL ("instead of a dropdown"), which
 * is also where it says when it will be deleted and whether it was ever emailed.
 *
 * Not a mail client. Nobody answers a booking from in here; they reply from their own mail
 * (Reply is a mailto:). The list exists so a message is never lost, and nothing is opened for
 * you on arrival: you came to look something up. Opening one marks it read (only if it was
 * unread: a read one writes nothing); Mark unread puts it back.
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
  /** The artist's own enquiry kinds, in their order, for the Type menu. Left out on the
   *  roster inbox, where each artist has their own list: the rows' kinds are offered. */
  kinds?: KindOption[]
  /** Where the toolbar sticks (list-toolbar.tsx). */
  stickyTop?: readonly string[]
}) {
  const [query, setQuery] = useState('')
  const [readFilter, setReadFilter] = useState<ReadFilter>('all')
  const [type, setType] = useState<string>(ALL_TYPES)
  const [sort, setSort] = useState<EnquirySort>('new')
  // Deleted here and not yet gone from `allRows`: the server revalidates, but the row
  // should leave the moment the database says it went.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const rows = allRows.filter((r) => !deletedIds.has(r.id))
  const [artistId, setArtistId] = useState<string>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set(rows.filter((r) => r.read_at).map((r) => r.id)))
  /** Each opened enquiry's signed audio, by enquiry id. Filed by id, not "the last one", so an
   *  answer that arrives after another enquiry was opened lands on its own enquiry. */
  const [audio, setAudio] = useState<Record<string, PlayableAttachment[]>>({})
  const [said, setSaid] = useState('')
  const [, startTransition] = useTransition()
  // One clock for every "deleted in N days", read once per mount so they agree.
  const [now] = useState(() => Date.now())
  const { ask, dialog } = useConfirm()
  // The row that opened the modal: focus goes back to it when the modal closes.
  const opener = useRef<HTMLElement | null>(null)

  // The read state ON SCREEN (opening marks read before the server says so).
  const seen = rows.map((r) => ({ ...r, read_at: readIds.has(r.id) ? (r.read_at ?? 'local') : null }))
  const typeOptions = kindOptions(kinds, allRows)
  const narrowed = filterByArtist(filterRows(type ? filterRows(seen, kindFilter(type)) : seen, readFilter), artistId)
  const visible = sortRows(searchRows(narrowed, query), sort)
  const needle = query.trim()
  // Built from the rows themselves, not the whole roster: an artist with no enquiries is
  // an option that can only ever return nothing.
  const artistOptions = artistsIn(rows)
  const unreadCount = rows.filter((r) => !readIds.has(r.id)).length
  const words: Word<ReadFilter>[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread', extra: unreadCount > 0 ? unreadCount : undefined },
  ]
  const open = openId ? (seen.find((r) => r.id === openId) ?? null) : null

  const close = useCallback(() => {
    setOpenId(null)
    opener.current?.focus()
  }, [])

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

  function openRow(row: InboxRow, el: HTMLElement) {
    opener.current = el
    setOpenId(row.id)
    if (row.attachmentCount > 0) {
      // Signed only when one is opened, and again on every open: a page of rows would otherwise
      // mint URLs that mostly expire unread, and short-lived means short-lived. A failed sign
      // files an empty list, so "Loading audio…" never stays up for good.
      signEnquiryAttachmentsAction(row.id)
        .then((items) => setAudio((prev) => ({ ...prev, [row.id]: items })))
        .catch(() => setAudio((prev) => ({ ...prev, [row.id]: prev[row.id] ?? [] })))
    }
    // Only an UNREAD one is written: opening a read one changes nothing anywhere.
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
    close()
  }

  const copy = useCallback(async (email: string) => {
    if (!(await copyText(email))) return false
    setSaid(`Copied ${email}`)
    return true
  }, [])

  // Name the NARROWEST true reason. With an artist and a type both chosen, "nothing in Demo
  // yet" is false — there are demos, just not this artist's — and a message that is wrong
  // about why is worse than a vague one. The search is the narrowest of all.
  const typeLabel = typeOptions.find((k) => k.slug === type)?.label ?? 'this type'
  const emptyReason =
    narrowed.length > 0
      ? `No enquiries match “${needle}”.`
      : artistId !== 'all'
        ? `Nothing here for ${artistOptions.find((a) => a.id === artistId)?.name ?? 'this artist'}.`
        : readFilter === 'unread'
          ? type
            ? `Nothing unread in ${typeLabel}.`
            : 'Nothing unread.'
          : `Nothing in ${typeLabel} yet.`

  return (
    <div className={LIST_COLUMN}>
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
            <WordChoice label="Show" words={words} value={readFilter} onChange={setReadFilter} />
            <div className="flex flex-none items-center gap-4 px-1">
              <ChoiceMenu
                label="Type"
                size="panel"
                value={type}
                options={[{ value: ALL_TYPES, label: 'All types' }, ...typeOptions.map((k) => ({ value: k.slug, label: k.label }))]}
                onChange={setType}
              />
              <ChoiceMenu label="Sort" size="panel" value={sort} options={ENQUIRY_SORTS.map((s) => ({ value: s.key, label: s.label }))} onChange={(v) => setSort(v as EnquirySort)} />
            </div>
          </ListToolbar>

          {visible.length ? (
            <ul aria-label="Enquiries">
              {visible.map((r) => (
                <EnquiryRow
                  key={r.id}
                  row={r}
                  isRead={readIds.has(r.id)}
                  showArtist={showArtist}
                  needle={needle}
                  onOpen={(el) => openRow(r, el)}
                  onCopy={copy}
                  onDelete={() => void remove(r)}
                />
              ))}
            </ul>
          ) : (
            <p className={QUIET}>{emptyReason}</p>
          )}
        </>
      )}
      {open ? (
        <EnquiryModal
          row={open}
          isRead={readIds.has(open.id)}
          showArtist={showArtist}
          audio={audio[open.id] ?? null}
          note={deletionNote(open.status, open.created_at, now)}
          onClose={close}
          onCopy={copy}
          onMarkUnread={() => markUnread(open)}
          onDelete={() => void remove(open)}
        />
      ) : null}
      {/* What a copy did, for a screen reader: the flashing icon only changes a label. */}
      <span role="status" className="sr-only">
        {said}
      </span>
      {dialog}
    </div>
  )
}

/**
 * One enquiry: who sent it and their address over its first line, the day on the right, then
 * the glyphs (Copy address, Reply, Delete), faint until the row is hovered, as on Subscribers.
 * The name is semibold, the address faint and regular; unread: the name goes bold and a small
 * dot sits in the gutter to its left. Below `sm` the day
 * drops under the text.
 *
 * The text and the day are ONE button (Enter or a click opens the enquiry); the glyphs sit
 * outside it, so no control is nested in another and a glyph's click never opens it.
 */
function EnquiryRow({
  row,
  isRead,
  showArtist,
  needle,
  onOpen,
  onCopy,
  onDelete,
}: {
  row: InboxRow
  isRead: boolean
  showArtist: boolean
  needle: string
  onOpen: (el: HTMLElement) => void
  onCopy: (email: string) => Promise<boolean>
  onDelete: () => void
}) {
  const [copied, flash] = useFlash<true>()
  const demo = row.demo_url ? safeHref(row.demo_url) : undefined
  return (
    <li data-enquiry="" className="group/ledger relative border-b border-hairline-soft last:border-b-0">
      {!isRead ? <span aria-hidden="true" className="absolute -left-3.5 top-[22px] h-1.5 w-1.5 rounded-full bg-accent" /> : null}
      <div className="flex items-center gap-x-3 py-[13px] sm:gap-x-6">
        <button
          type="button"
          onClick={(e) => onOpen(e.currentTarget)}
          aria-haspopup="dialog"
          className={cx('flex min-w-0 flex-1 cursor-pointer flex-col gap-y-1.5 rounded-[3px] text-left sm:flex-row sm:items-center sm:gap-x-6', FOCUS_RING)}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-y-1">
            <span className="flex min-w-0 items-baseline gap-x-2.5">
              {/* The name stands apart from the address (Sam, 2026-10-05: "bolden the name more"):
                  semibold ink against the faint regular email; unread goes bold, with its dot. */}
              <span className={cx('min-w-0 max-w-[70%] flex-none truncate text-[15px] text-ink', isRead ? 'font-semibold' : 'font-bold')}>
                <Highlight text={row.name} needle={needle} />
              </span>
              <span className="sr-only">{isRead ? 'read' : 'unread'}</span>
              <span className="min-w-0 truncate text-[13px] text-ink-faint">
                <Highlight text={row.email} needle={needle} />
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-x-2.5">
              {showArtist ? <span className={cx(CAPS_META, 'flex-none text-ink-muted')}>{row.artistName}</span> : null}
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
          {/* suppressHydrationWarning: the server and the browser each read their own zone,
              and a day can tick over between them. */}
          <span className="flex-none whitespace-nowrap font-space text-[12px] text-ink-muted sm:text-right" suppressHydrationWarning>
            {day(row.created_at)}
          </span>
        </button>
        <span className="flex flex-none gap-1 self-center">
          <RowIcon
            icon={copied ? 'check' : 'copy'}
            label={copied ? 'Copied' : 'Copy address'}
            tone="accent"
            onClick={async () => {
              if (await onCopy(row.email)) flash(true)
            }}
            className={cx(TOUCH_VISIBLE, copied && 'opacity-100! text-accent!')}
          />
          <RowIcon icon="reply" label="Reply" tone="accent" labelAlign="end" href={replyHref(row.email)} className={TOUCH_VISIBLE} />
          <RowIcon icon="trash" label="Delete" tone="danger" labelAlign="end" onClick={onDelete} className={TOUCH_VISIBLE} />
        </span>
      </div>
    </li>
  )
}

/**
 * THE OPEN ENQUIRY, in the dashboard's one modal (CardModal; Sam, 2026-10-05: "instead of a
 * dropdown we can do a modal for the detailed inquiry"). The facts come FIRST (Sam: "Maybe the
 * from, type, received should be at the top"), as modal-kit's LABEL/value rows. Then the
 * message, its demo link and audio. The footer: on the left, the quiet line that says whether it
 * was ever emailed and when it will be deleted (Sam: "that is where we show the message of when
 * it will be deleted", then "Put the deleted in in the bottom left"); the glyphs on the right. No title: the From row names the sender, and the header rule
 * (card-modal.tsx) drops a title the content already says; the dialog keeps its name (`label`).
 *
 * Focus moves into it on open and back to the row on close (Escape, ×, a click outside).
 */
function EnquiryModal({
  row,
  isRead,
  showArtist,
  audio,
  note,
  onClose,
  onCopy,
  onMarkUnread,
  onDelete,
}: {
  row: InboxRow
  isRead: boolean
  showArtist: boolean
  audio: PlayableAttachment[] | null
  /** "deleted in 12 days": when the nightly job removes it (src/lib/enquiries/retention.ts). */
  note: string | null
  onClose: () => void
  onCopy: (email: string) => Promise<boolean>
  onMarkUnread: () => void
  onDelete: () => void
}) {
  const body = useRef<HTMLDivElement>(null)
  const [copied, flash] = useFlash<true>()
  useEffect(() => body.current?.focus({ preventScroll: true }), [])
  const demo = row.demo_url ? safeHref(row.demo_url) : undefined
  // Never emailed: said plainly, because a list of messages reads as a record of messages
  // DELIVERED. Since 2026-09-28 there is no global inbox, so "unroutable" almost always means
  // no address was set for this kind when it arrived.
  const delivery = notEmailed(row.status)
    ? row.status === 'unroutable'
      ? 'Not emailed: nobody was set to receive it'
      : 'The email failed to send'
    : null
  const quiet = [delivery, note].filter(Boolean).join(' · ')

  return (
    <CardModal
      open
      onClose={onClose}
      label={`Enquiry from ${row.name}`}
      footer={
        <div className="flex items-center gap-1">
          {/* Bottom left (Sam, 2026-10-05: "Put the deleted in in the bottom left"). */}
          {quiet ? (
            <p data-deletion-note="" className={cx('mr-auto min-w-0 pr-3', MONO_META)} suppressHydrationWarning>
              {quiet}
            </p>
          ) : (
            <span className="mr-auto" />
          )}
          <RowIcon variant="boxed" size="sm" tone="accent" labelSide="top" icon="reply" label="Reply" href={replyHref(row.email)} />
          <RowIcon
            variant="boxed"
            size="sm"
            tone="accent"
            labelSide="top"
            icon={copied ? 'check' : 'copy'}
            label={copied ? 'Copied' : 'Copy address'}
            onClick={async () => {
              if (await onCopy(row.email)) flash(true)
            }}
            className={copied ? 'text-accent!' : undefined}
          />
          {/* Opening marked it read; this puts it back in the unread pile and closes. */}
          {isRead ? <RowIcon variant="boxed" size="sm" labelSide="top" icon="mail" label="Mark unread" onClick={onMarkUnread} /> : null}
          <RowIcon variant="boxed" size="sm" tone="danger" labelSide="top" labelAlign="end" icon="trash" label="Delete" onClick={onDelete} />
        </div>
      }
    >
      {/* Pulled up level with the × (Sam, 2026-10-05: "remove some of that gap at the top of
          the modal above the email/name", then "Tighten more"): with no title, the top bar is
          only the ×, so the From row sits on its line. The row's right padding keeps a long
          address clear of the ×. */}
      <div ref={body} tabIndex={-1} data-enquiry-detail="" className="-mt-[38px] outline-none">
        <div data-enquiry-facts="">
          <KvRow label="From" className="pr-10">
            <span className="flex min-w-0 items-baseline gap-2.5 text-[14px]">
              <span className="flex-none font-semibold text-ink">{row.name}</span>
              <span className="min-w-0 truncate text-ink-muted">{row.email}</span>
            </span>
          </KvRow>
          {showArtist ? (
            <KvRow label="Artist">
              <span className="text-[14px] text-ink">{row.artistName}</span>
            </KvRow>
          ) : null}
          <KvRow label="Type">
            <span className="text-[14px] text-ink">{row.purposeLabel}</span>
          </KvRow>
          <KvRow label="Received">
            <span className="font-space text-[12px] text-ink" suppressHydrationWarning>
              {received(row.created_at)}
            </span>
          </KvRow>
        </div>
        {row.message ? <p className="mt-5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{row.message}</p> : null}

        {/* https-only at the door and by a CHECK, but still through safeHref here:
            render-time sanitisation is the must-have guard, because a stored row can
            outlive the validator that let it in. */}
        {demo ? (
          <p className="mt-5 font-space text-[12px]">
            <span className="text-ink-faint">Demo </span>
            <a href={demo} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline underline-offset-2">
              {row.demo_url}
            </a>
          </p>
        ) : null}

        {row.attachmentCount > 0 ? (
          <ul className="mt-5">
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
      </div>
    </CardModal>
  )
}
