'use client'

import { memo, useCallback, useMemo, useState } from 'react'
import { cx } from '@/lib/cx'
import { plural } from '@/lib/manager-tools/format'
import {
  SUBSCRIBER_SORTS,
  emailList,
  exportHref,
  filterSubscribers,
  formatSubscribedDate,
  mailtoHref,
  sortSubscribers,
  type Subscriber,
  type SubscriberSort,
} from '@/lib/manager-tools/subscribers/subscribers'
import { useConfirm } from '../../confirm-dialog'
import { toast } from '../../toast'
import { removeSubscriberAction } from './actions'
import { copyText, useFlash } from '../_ui/copy'
import { Highlight } from '../_ui/highlight'
import { ListToolbar, QUIET, SearchLine, TOUCH_VISIBLE, WordChoice } from '../_ui/list-toolbar'
import { RowIcon } from '../_ui/row-icon'

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
 * THE TOOLBAR STAYS, THE PAGE SCROLLS (Sam, 2026-09-24): the toolbar, its search and its words
 * are _ui/list-toolbar.tsx since Enquiries took the same layout (2026-10-05), which says why.
 */

export function SubscribersLedger({ artistId, subscribers }: { artistId: string; subscribers: Subscriber[] }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SubscriberSort>('new')
  const [copiedAll, flashCopiedAll] = useFlash<number>()
  const [said, setSaid] = useState('')
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
              <ListToolbar data-subscribers-toolbar="">
                <SearchLine value={query} onChange={setQuery} label="Search emails" />
                <WordChoice label="Sort" words={SUBSCRIBER_SORTS} value={sort} onChange={setSort} />

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
              </ListToolbar>

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
        <Highlight text={email} needle={needle} />
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
