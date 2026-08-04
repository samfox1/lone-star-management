'use client'

import { useEffect, useState, useTransition } from 'react'
import { fileSize, type PlayableAttachment } from '@/lib/enquiry-attachments'
import { filterRows, initialSelection, snippet, type InboxFilter, type InboxRow } from '@/lib/enquiry-inbox'
import { safeHref } from '@/lib/url'
import { Icon } from '@/components/ui/icons'
import { buttonClass } from '@/components/ui/ui'
import { markEnquiryReadAction } from '../actions'
import { markEnquiryUnreadAction, signEnquiryAttachmentsAction } from './actions'

const PURPOSE_LABEL: Record<string, string> = { booking: 'Booking', demo: 'Demo', other: 'Contact' }

/** "Aug 4" for this year, "Aug 4, 2025" otherwise — a list column has no room for more,
 *  and the year only earns its place once it is ambiguous. */
function listDate(iso: string): string {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

function fullDate(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

/**
 * The enquiries inbox: list on the left, message on the right.
 *
 * Built as a split pane rather than a stack of expanded cards because the previous
 * version rendered every message in full — fifty enquiries was a wall of text with no way
 * to scan it, which is the one job a list has.
 *
 * OPENING MARKS READ, as every mail client does. That quietly destroys the manager's own
 * triage signal if they were only glancing, which is why "Mark unread" sits next to the
 * message rather than being an afterthought — the undo is what makes auto-read safe.
 *
 * Attachments are signed ON OPEN, not on page load. Signing everything up front meant
 * dozens of round trips for URLs that mostly expired unused, and the one you actually
 * wanted had been counting down since the page rendered.
 */
export function Inbox({ artistId, rows }: { artistId: string; rows: InboxRow[] }) {
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(() => initialSelection(rows))
  // Read state is tracked locally so the list updates the instant you click, rather than
  // waiting for a round trip to tell us what we already know.
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.read_at).map((r) => r.id)),
  )
  /** TAGGED with the enquiry it belongs to, so a slow response for a message you have
   *  already navigated away from is ignored rather than shown against the wrong one — and
   *  the effect never has to synchronously clear state, which cascades a render. */
  const [loadedAudio, setLoadedAudio] = useState<{ id: string; items: PlayableAttachment[] } | null>(null)
  const [, startTransition] = useTransition()

  const visible = filterRows(
    rows.map((r) => ({ ...r, read_at: readIds.has(r.id) ? (r.read_at ?? 'local') : null })),
    filter,
  )
  const selected = rows.find((r) => r.id === selectedId) ?? null
  // Derived, never stored for the empty case: nothing to fetch means nothing to wait for,
  // so it is `[]` immediately rather than a null that briefly renders "Loading audio…".
  const attachments =
    selected && selected.attachmentCount === 0
      ? []
      : loadedAudio && loadedAudio.id === selectedId
        ? loadedAudio.items
        : null
  const unreadCount = rows.filter((r) => !readIds.has(r.id)).length

  // Sign the selected message's audio, and mark it read. Both are per-selection, so
  // opening a second message re-runs them for that one only.
  useEffect(() => {
    if (!selected) return
    let live = true
    const id = selected.id

    // Only the async path touches state. A message with no attachments needs no request
    // and no state at all — see `attachments` above, where empty is derived.
    if (selected.attachmentCount > 0) {
      signEnquiryAttachmentsAction(id).then((items) => {
        if (live) setLoadedAudio({ id, items })
      })
    }

    if (!readIds.has(id)) {
      startTransition(() => {
        setReadIds((prev) => new Set(prev).add(id))
        void markEnquiryReadAction(artistId, id)
      })
    }
    return () => {
      live = false
    }
    // `readIds` deliberately omitted: including it would re-run this the moment we mark
    // read, and the guard above already makes the write idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, artistId])

  function markUnread() {
    if (!selected) return
    setReadIds((prev) => {
      const next = new Set(prev)
      next.delete(selected.id)
      return next
    })
    startTransition(() => {
      void markEnquiryUnreadAction(artistId, selected.id)
    })
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline px-6 py-12 text-center text-sm text-ink-muted">
        No enquiries yet. Messages from the site&rsquo;s contact form land here.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-hairline">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2">
        <span className="font-space text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          {rows.length} {rows.length === 1 ? 'enquiry' : 'enquiries'}
          {unreadCount > 0 && ` · ${unreadCount} unread`}
        </span>
        <div className="ml-auto flex gap-1">
          {(['all', 'unread'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`rounded-md px-2 py-1 font-space text-[11px] capitalize transition-colors ${
                filter === f ? 'bg-surface font-bold text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Two panes on a wide screen; on narrow the list stacks above the message, which
          keeps both reachable without a router or a second route to maintain. */}
      <div className="grid md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <ul className="max-h-[34rem] divide-y divide-hairline-soft overflow-y-auto border-b border-hairline md:border-b-0 md:border-r">
          {visible.length === 0 ? (
            <li className="px-4 py-6 text-center font-space text-xs text-ink-faint">
              Nothing unread.
            </li>
          ) : (
            visible.map((r) => {
              const isRead = readIds.has(r.id)
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    aria-current={r.id === selectedId}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      r.id === selectedId ? 'bg-surface' : 'hover:bg-surface-hover'
                    }`}
                  >
                    <div className="flex items-baseline gap-2">
                      {!isRead && (
                        <span
                          aria-hidden
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                        />
                      )}
                      <span className={`truncate text-sm ${isRead ? 'text-ink-muted' : 'font-bold'}`}>
                        {r.name}
                      </span>
                      <span className="ml-auto shrink-0 font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                        {PURPOSE_LABEL[r.purpose] ?? r.purpose}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-space text-xs text-ink-faint">{snippet(r.message)}</p>
                    <div className="mt-1 flex items-center gap-2 font-space text-[10px] text-ink-faint">
                      <span>{listDate(r.created_at)}</span>
                      {r.attachmentCount > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          <Icon name="tracks" size={11} /> {r.attachmentCount}
                        </span>
                      )}
                      {r.demo_url && <Icon name="external" size={11} />}
                      <span className="sr-only">{isRead ? 'read' : 'unread'}</span>
                    </div>
                  </button>
                </li>
              )
            })
          )}
        </ul>

        <div className="min-w-0 p-5">
          {!selected ? (
            <p className="font-space text-sm text-ink-faint">Select an enquiry to read it.</p>
          ) : (
            <article>
              <p className="font-space text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                {PURPOSE_LABEL[selected.purpose] ?? selected.purpose}
              </p>
              <h2 className="mt-1 text-[17px] font-bold tracking-[-0.01em]">{selected.name}</h2>
              <p className="mt-0.5 font-space text-xs text-ink-muted">
                <a
                  href={`mailto:${selected.email}?subject=${encodeURIComponent('Re: your enquiry')}`}
                  className="hover:text-accent"
                >
                  {selected.email}
                </a>
                <span className="text-ink-faint"> · {fullDate(selected.created_at)}</span>
              </p>

              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{selected.message}</p>

              {/* https-only at the door AND by a CHECK, but still through safeHref here:
                  render-time sanitisation is the must-have guard (lib/url.ts), because a
                  stored row can outlive the validator that let it in. */}
              {selected.demo_url && safeHref(selected.demo_url) && (
                <p className="mt-4 font-space text-sm">
                  <span className="text-ink-faint">Demo: </span>
                  <a
                    href={safeHref(selected.demo_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-accent underline underline-offset-2"
                  >
                    {selected.demo_url}
                  </a>
                </p>
              )}

              {selected.attachmentCount > 0 && (
                <ul className="mt-4 space-y-2">
                  {attachments === null ? (
                    <li className="font-space text-xs text-ink-faint">Loading audio…</li>
                  ) : (
                    attachments.map((a) => (
                      <li key={a.id} className="rounded-lg border border-hairline px-3 py-2">
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
                          // A different fact from expired, and worth saying: the sender
                          // started an upload that never finished.
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

              <div className="mt-5 flex items-center gap-2 border-t border-hairline pt-4">
                <a
                  href={`mailto:${selected.email}?subject=${encodeURIComponent('Re: your enquiry')}`}
                  className={buttonClass('solid')}
                >
                  Reply
                </a>
                {readIds.has(selected.id) && (
                  <button type="button" onClick={markUnread} className={buttonClass('ghost')}>
                    Mark unread
                  </button>
                )}
              </div>
            </article>
          )}
        </div>
      </div>
    </div>
  )
}
