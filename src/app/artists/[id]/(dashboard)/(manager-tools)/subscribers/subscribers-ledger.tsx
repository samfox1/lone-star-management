'use client'

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icons'
import { cx } from '@/lib/cx'
import { plural } from '@/lib/manager-tools/format'
import {
  SUBSCRIBER_SORTS,
  emailList,
  exportHref,
  filterSubscribers,
  formatSubscribedDate,
  highlightSegments,
  mailtoHref,
  sortSubscribers,
  type Subscriber,
  type SubscriberSort,
} from '@/lib/manager-tools/subscribers/subscribers'
import { useConfirm } from '../../confirm-dialog'
import { toast } from '../../toast'
import { removeSubscriberAction } from './actions'
import { FOCUS_RING } from '../_ui/focus-ring'
import { HoverLabel, RowIcon } from '../_ui/row-icon'

/**
 * SUBSCRIBERS (Sam, 2026-09-24; prototypes/subscribers_ledger_20260924.html). The emails the
 * site's signup door collected, in the Brand ledger's look. The list is a CENTRED column:
 * the gap on its left equals the gap on its right (Sam, 2026-09-24 — Brand's empty 150px
 * left column left twice the gap on the left). No "Subscribers" label, no count, no
 * heading, no instruction copy, and every action is an icon with a hover label.
 *
 * REMOVE (Sam, 2026-09-28): a manager may remove one subscriber, the trash-on-hover pattern
 * every ledger uses (`useConfirm` asks first, `removeSubscriberAction`, the RLS delete
 * policy is `subscribers_delete`, 20260928140500). `subscribe()` is still the only INSERT.
 *

 * THE TOOLBAR STAYS, THE PAGE SCROLLS (Sam, 2026-09-24). The toolbar is `sticky` just under
 * the dashboard header and the rows scroll beneath it with the page. Not a scroll box of its
 * own: the page keeps its one native scrollbar, a phone's browser bars still collapse, and
 * Space / Page Down / find-in-page work as on any page. Anything between the toolbar and the
 * page that clips or scrolls (an `overflow-*`) would silently un-stick it; the component test
 * walks the ancestors for exactly that.
 */

/** Under the dashboard header (layout.tsx): 59px tall below md, where its section nav is
 *  hidden, and 71px from md up; plus the notch inset, which is 0 unless the viewport is
 *  ever set to `viewport-fit=cover`. Measured in the browser, 2026-09-24. */
export const STICKY_TOP = ['top-[calc(59px+env(safe-area-inset-top,0px))]', 'md:top-[calc(71px+env(safe-area-inset-top,0px))]']

/** How long a copy's check stays up. */
const FLASH_MS = 1400

/** Row icons are faint until their row is hovered — with a MOUSE. A touch screen has no
 *  hover, so there they are always fully visible. */
const TOUCH_VISIBLE = 'pointer-coarse:opacity-100'


const QUIET = 'py-7 text-[14px] text-ink-faint'

/**
 * Copy text: the async clipboard first, and when a browser refuses it (permissions, an
 * insecure origin) or has none, a hidden textarea selected and copied the old way. Focus goes
 * back where it was, so a keyboard user is not dropped on <body>. False only if both failed.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Refused: fall back below.
  }
  const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  prev?.focus()
  return ok
}

/** A value that shows for FLASH_MS, then clears. A second flash restarts the clock. */
function useFlash<T>(): [T | null, (v: T) => void] {
  const [value, setValue] = useState<T | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const flash = useCallback((v: T) => {
    if (timer.current) clearTimeout(timer.current)
    setValue(v)
    timer.current = setTimeout(() => {
      timer.current = null
      setValue(null)
    }, FLASH_MS)
  }, [])
  return [value, flash]
}

export function SubscribersLedger({ artistId, subscribers }: { artistId: string; subscribers: Subscriber[] }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SubscriberSort>('new')
  const [copiedAll, flashCopiedAll] = useFlash<number>()
  const [said, setSaid] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const { ask, dialog } = useConfirm()
  // Seeded ONCE from the server, then this component's own truth: a successful Remove drops
  // the row locally (the same "seed once" rule Brand's ledgers use — a revalidated page's
  // fresh props only reach this copy on the NEXT mount, e.g. a real navigation).
  const [rows, setRows] = useState(subscribers)

  const shown = useMemo(() => sortSubscribers(filterSubscribers(rows, query), sort), [rows, query, sort])
  const needle = query.trim()

  const copyAll = async () => {
    const count = shown.length
    if (!count) return
    if (await copyText(emailList(shown))) {
      flashCopiedAll(count)
      setSaid(`Copied ${plural(count, 'email', 'emails')}`)
    }
  }
  const copied = useCallback((email: string) => setSaid(`Copied ${email}`), [])

  const remove = useCallback(
    async (s: Subscriber) => {
      if (!(await ask(`Remove ${s.email}?`, { action: 'Remove' }))) return
      const res = await removeSubscriberAction(artistId, s.id)
      if (res.error) {
        toast(res.error, 'error')
        return
      }
      setRows((all) => all.filter((r) => r.id !== s.id))
    },
    [artistId, ask],
  )

  return (
    // No width or bottom room of its own (it was a centred 1000px column): the tools shell's one
    // frame sets both for every tool (TOOL_FRAME, _shell/tools-rail.tsx, Batch 3 2026-10-02).
    <div>
      <div data-subscribers-frame="">
        <div className="min-w-0">
          {rows.length === 0 ? (
            <p className={QUIET}>No subscribers yet.</p>
          ) : (
            <>
              <div
                data-subscribers-toolbar=""
                // -mt-4 pt-4: at rest the search sits where it would without the padding; once
                // stuck, that padding is the breathing room under the header's hairline.
                className={cx('sticky z-20 -mt-4 flex flex-wrap items-center gap-2.5 border-b border-hairline bg-paper pb-3.5 pt-4', ...STICKY_TOP)}
              >
                <div className="relative min-w-0 flex-1 basis-full sm:max-w-[420px] sm:basis-auto">
                  <Icon name="search" size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search emails"
                    aria-label="Search emails"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-[10px] border border-hairline bg-paper py-[9px] pl-[34px] pr-8 text-[14px] text-ink outline-hidden transition-colors placeholder:text-ink-faint focus:border-ink [&::-webkit-search-cancel-button]:appearance-none"
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => {
                        setQuery('')
                        searchRef.current?.focus()
                      }}
                      className={cx('absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-md text-ink-faint transition-colors hover:text-ink', FOCUS_RING)}
                    >
                      <Icon name="close" size={14} />
                      <HoverLabel label="Clear search" align="end" />
                    </button>
                  ) : null}
                </div>

                <div role="group" aria-label="Sort" className="flex flex-none gap-0.5 rounded-[10px] border border-hairline bg-surface p-[3px] sm:ml-auto">
                  {SUBSCRIBER_SORTS.map((s) => {
                    const on = s.key === sort
                    return (
                      <button
                        key={s.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSort(s.key)}
                        className={cx(
                          'whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-offset-1',
                          FOCUS_RING,
                          on ? 'bg-paper text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-ink-muted hover:text-ink',
                        )}
                      >
                        {s.label}
                      </button>
                    )
                  })}
                </div>

                <RowIcon
                  variant="boxed"
                  size="sm"
                  tone="accent"
                  labelAlign="end"
                  icon={copiedAll !== null ? 'check' : 'copy'}
                  label={copiedAll !== null ? `Copied ${copiedAll}` : 'Copy all emails'}
                  disabled={shown.length === 0}
                  onClick={copyAll}
                  className={copiedAll !== null ? 'text-accent!' : undefined}
                />
                <RowIcon variant="boxed" size="sm" tone="accent" labelAlign="end" icon="download" label="Download CSV" href={exportHref(artistId, query)} />
              </div>

              {shown.length ? (
                <ul aria-label="Emails">
                  {shown.map((s) => (
                    <Row key={s.id} email={s.email} createdAt={s.created_at} needle={needle} onCopied={copied} onRemove={() => remove(s)} />
                  ))}
                </ul>
              ) : (
                <p className={QUIET}>No emails match “{needle}”.</p>
              )}
            </>
          )}
        </div>
      </div>
      {/* What a copy did, for a screen reader: the flashing icon only changes a label. */}
      <span role="status" className="sr-only">
        {said}
      </span>
      {dialog}
    </div>
  )
}

/**
 * One subscriber. Memoised: a re-sort re-renders none of them, a keystroke only those whose
 * highlight could change. Below `sm` the date drops under the email and the two icons sit
 * beside both, so nothing is squeezed off a phone.
 */
const Row = memo(function Row({
  email,
  createdAt,
  needle,
  onCopied,
  onRemove,
}: {
  email: string
  createdAt: string
  needle: string
  onCopied: (email: string) => void
  onRemove: () => void
}) {
  const [copied, flash] = useFlash<true>()
  const copy = async () => {
    if (await copyText(email)) {
      flash(true)
      onCopied(email)
    }
  }
  return (
    <li className="group/ledger grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-hairline-soft py-[13px] last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-x-6">
      <span data-email="" title={email} className="min-w-0 truncate text-[15px] text-ink">
        {highlightSegments(email, needle).map((seg, i) =>
          seg.hit ? (
            <mark key={i} className="rounded-[2px] bg-[#fff3a3] text-inherit">
              {seg.text}
            </mark>
          ) : (
            <Fragment key={i}>{seg.text}</Fragment>
          ),
        )}
      </span>
      <span className="row-start-2 whitespace-nowrap font-space text-[12px] text-ink-muted sm:row-start-auto">{formatSubscribedDate(createdAt)}</span>
      <span className="row-span-2 flex gap-1 sm:row-span-1">
        <RowIcon
          icon={copied ? 'check' : 'copy'}
          label={copied ? 'Copied' : 'Copy'}
          tone="accent"
          onClick={copy}
          className={cx(TOUCH_VISIBLE, copied && 'opacity-100! text-accent!')}
        />
        <RowIcon icon="mail" label="Email" tone="accent" labelAlign="end" href={mailtoHref(email)} className={TOUCH_VISIBLE} />
        <RowIcon icon="trash" label="Remove" tone="danger" labelAlign="end" onClick={onRemove} className={TOUCH_VISIBLE} />
      </span>
    </li>
  )
})
