'use client'

import { useId, useRef, useState } from 'react'
import { useConfirm } from '../../confirm-dialog'
import { toast } from '../../toast'
import { AddRow } from '../_ui/add-row'
import { CommitField } from '../_ui/commit-field'
import { CardAction, CardActions, CardField, DisclosureCard, DisclosureItem, RowFace, RowValue } from '../_ui/disclosure'
import { LedgerSection } from '../_ui/ledger'
import { RowIcon } from '../_ui/row-icon'
import { MONO_META } from '../_ui/styles'
import {
  addEnquiryKindAction,
  deleteEnquiryKindAction,
  renameEnquiryKindAction,
  setEnquiryRecipientsAction,
} from './actions'
import { LABEL_MAX, PURPOSE_FALLBACK, recipientProblem, type EnquiryKindRow } from '@/lib/enquiries/kinds'

/** What a kind's row and card say when no booking address is set. */
const NO_PRIMARY = 'No booking address set'

/**
 * Who receives each kind of enquiry: Settings › Email (Sam, 2026-09-22; Batch 3, 2026-10-02,
 * prototypes/batch3_20261002.html).
 *
 * ONE "A" ROW PER KIND (_ui/disclosure.tsx, the AI test's row): its name, the address that
 * WOULD receive it and how many more are copied. Clicking OPENS IT IN PLACE (no modal) onto a
 * card: the name (saves itself), the primary (shown, never edited here), the list, and a bare
 * trash. No Save button: every edit saves on its own.
 *
 * THE PRIMARY IS READ-ONLY ON PURPOSE. It is whatever `resolve_booking_recipient` found, the
 * booking address on the artist's own site, and it is edited under General, in one place,
 * because it is also what the public site displays. Showing it here without letting it be
 * changed is what stops the two screens disagreeing about the same address. These lists only
 * ADD to it (20260921120000).
 *
 * No captions, no explanatory paragraph: the rows say what they are (no-instruction-copy).
 */
export function KindRows({
  artistId,
  kinds: initial,
  primary,
}: {
  artistId: string
  kinds: EnquiryKindRow[]
  /** The resolved booking recipient, or null when none is set. Shown, never edited here. */
  primary: string | null
}) {
  const [kinds, setKinds] = useState(initial)
  const [openId, setOpenId] = useState<string | null>(null)
  // Re-entry latch for Add (AGENTS.md rule 5): two Enters before the first insert returns
  // used to mint a duplicate `press-2`, or lose the 23505 race and toast (review 2026-09-23).
  const addingRef = useRef(false)

  const patch = (id: string, next: Partial<EnquiryKindRow>) =>
    setKinds((ks) => ks.map((k) => (k.id === id ? { ...k, ...next } : k)))

  async function addKind(label: string) {
    if (addingRef.current) return
    addingRef.current = true
    try {
      const res = await addEnquiryKindAction(artistId, label)
      const kind = res.kind
      if (res.error || !kind) return toast(res.error ?? 'Could not add that kind.', 'error')
      setKinds((ks) => [...ks, kind])
    } finally {
      addingRef.current = false
    }
  }

  return (
    <LedgerSection label="Enquiries">
      {/* Pulled out 12px, so an open row's grey reaches past the text column (DisclosureGroup's). */}
      <div className="-mx-3">
        {kinds.map((k) => (
          <KindItem
            key={k.id}
            artistId={artistId}
            kind={k}
            primary={primary}
            open={openId === k.id}
            onToggle={() => setOpenId((o) => (o === k.id ? null : k.id))}
            onPatch={(next) => patch(k.id, next)}
            onDeleted={() => {
              setKinds((ks) => ks.filter((x) => x.id !== k.id))
              setOpenId(null)
            }}
          />
        ))}
      </div>
      {/* The shared add flow (Brand's): "+ Add kind", then a name field with ✓ and ×. */}
      <AddRow noun="kind" label="Kind name" placeholder="Press" maxLength={LABEL_MAX} onAdd={(label) => void addKind(label)} />
    </LedgerSection>
  )
}

/** One kind: its row, and its card while open. */
function KindItem({
  artistId,
  kind,
  primary,
  open,
  onToggle,
  onPatch,
  onDeleted,
}: {
  artistId: string
  kind: EnquiryKindRow
  primary: string | null
  open: boolean
  onToggle: () => void
  onPatch: (next: Partial<EnquiryKindRow>) => void
  onDeleted: () => void
}) {
  const buttonId = useId()
  const cardId = useId()
  const { ask, dialog } = useConfirm()
  /** One delete at a time (AGENTS.md rule 5: a ref, not state). */
  const deletingRef = useRef(false)
  // `other` is the fallback every unrecognised purpose lands on, and the database refuses
  // to delete it. Not offering the trash is kinder than offering one that always fails.
  const deletable = kind.slug !== PURPOSE_FALLBACK

  async function del() {
    if (deletingRef.current) return
    // No undo and no trash can: the same question the card modal asked.
    if (!(await ask(`Delete “${kind.label}” and everyone on its list?`, { action: 'Delete' }))) return
    deletingRef.current = true
    try {
      const res = await deleteEnquiryKindAction(artistId, kind.id)
      if (res && 'error' in res && res.error) {
        toast(res.error, 'error')
        return
      }
      toast('Kind deleted')
      onDeleted()
    } catch {
      toast('Couldn’t delete that kind.', 'error')
    } finally {
      deletingRef.current = false
    }
  }

  async function saveList(next: Recipient[]) {
    const before = kind.recipients
    onPatch({ recipients: next })
    const res = await setEnquiryRecipientsAction(
      artistId,
      kind.id,
      next.map((r) => ({ email: r.email, label: r.label })),
    )
    if (res.error || !res.rows) {
      // The save is atomic, so on a refusal the database still holds `before` and putting
      // it back is TRUE, not cosmetic.
      onPatch({ recipients: before })
      toast(res.error ?? 'Could not save the list.', 'error')
      return
    }
    // Server ids and server order replace the optimistic `new-…` ones.
    onPatch({ recipients: res.rows })
  }

  return (
    <DisclosureItem
      buttonId={buttonId}
      cardId={cardId}
      open={open}
      onToggle={onToggle}
      itemData={{ 'data-kind': kind.slug }}
      face={
        <RowFace
          mark={null}
          name={kind.label}
          open={open}
          // The address this kind would actually reach, then how many more are copied. A
          // missing address is the only thing that speaks up (red): it is the only thing
          // the manager has to act on.
          value={
            <>
              <RowValue bad={!primary}>{primary ?? NO_PRIMARY}</RowValue>
              {kind.recipients.length > 0 ? <span className="flex-none font-space text-[12px] text-ink-faint">{`+${kind.recipients.length}`}</span> : null}
            </>
          }
        />
      }
    >
      <DisclosureCard id={cardId} labelledBy={buttonId} noMark>
        <CardField label="Name" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <CommitField
            label="Name"
            value={kind.label}
            onCommit={async (v) => {
              const res = await renameEnquiryKindAction(artistId, kind.id, v)
              // The server stores the first LABEL_MAX characters; show what it stored.
              if (!res.error) onPatch({ label: v.slice(0, LABEL_MAX) })
              return res
            }}
            className="w-[220px] max-w-full"
          />
          {/* The SLUG: the one thing here that cannot be changed, and the one thing the
              artist's website has to match. */}
          <span className={MONO_META}>{kind.slug}</span>
        </CardField>
        <CardField label="Receives">
          <span className={primary ? 'font-space text-[13px] text-ink-muted' : 'font-space text-[13px] text-accent-red'}>{primary ?? NO_PRIMARY}</span>
        </CardField>
        <CardField label="Also">
          <Recipients recipients={kind.recipients} onChange={saveList} />
        </CardField>
        {deletable ? (
          <CardActions>
            <CardAction icon="trash" label="Delete kind" tone="danger" labelAlign="end" className="ml-auto" onClick={() => void del()} />
          </CardActions>
        ) : null}
      </DisclosureCard>
      {dialog}
    </DisclosureItem>
  )
}

type Recipient = EnquiryKindRow['recipients'][number]

/**
 * SEVERAL ADDRESSES PER KIND (Sam, 2026-10-02: "Make sure you can add multiple emails for one
 * slot"): one line per address with its ×, then the shared "+ Add email". Each kind holds up
 * to ten (`enquiry_recipients`, one row per address; RECIPIENT_CAP). The whole list is sent on
 * every change and the server answers with the rows as stored.
 *
 * TWO GUARDS the first version lacked (review, 2026-09-22):
 *   - `recipientProblem` runs BEFORE the save: address shape (ASCII-strict, because one pasted
 *     zero-width space makes Resend refuse the whole send), case-insensitive duplicates, and
 *     the cap of ten. The database enforces all three too; this is what lets the manager be
 *     told in a sentence instead of a toast of a constraint name. A refused address stays in
 *     the field (AddRow keeps it on `false`), so it is never wiped unsaved.
 *   - `busyRef` is a re-entry LATCH, a ref, not state (AGENTS.md rule 5): two fast edits both
 *     read pre-render state, and letting the second save start before the first returned let
 *     them interleave and lose an address.
 *
 * A line shows the address and, after it, the name it was saved with (older entries carry
 * one; a new address is added bare).
 */
function Recipients({ recipients, onChange }: { recipients: Recipient[]; onChange: (next: Recipient[]) => Promise<void> }) {
  const busyRef = useRef(false)

  /** False when a save is already in flight and this one never started. */
  function busy() {
    if (!busyRef.current) return false
    toast('Still saving — try that again in a moment.', 'error')
    return true
  }

  async function send(next: Recipient[]) {
    if (busy()) return
    busyRef.current = true
    try {
      await onChange(next)
    } finally {
      busyRef.current = false
    }
  }

  /** AddRow's onAdd: false keeps the typed address in the field. */
  function add(email: string): boolean {
    const problem = recipientProblem(recipients.map((r) => r.email), email)
    if (problem) {
      // 'error', always: every toast here is a refusal.
      toast(problem, 'error')
      return false
    }
    if (busy()) return false
    void send([...recipients, { id: `new-${crypto.randomUUID()}`, email: email.trim(), label: null }])
    return true
  }

  return (
    // An empty list starts with "+ Add email": pulled up past AddRow's own top padding so it
    // sits on its ALSO label's line, as an address does (from 700px, where they sit side by
    // side; on a phone the label is above it).
    <div className={recipients.length > 0 ? 'min-w-0' : 'min-w-0 min-[700px]:-mt-4'}>
      {recipients.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {recipients.map((r) => (
            <li key={r.id} className="flex min-w-0 items-center gap-2.5">
              <span title={r.email} className="min-w-0 truncate font-space text-[13px] text-ink">
                {r.email}
              </span>
              {r.label ? <span className={MONO_META}>{r.label}</span> : null}
              <RowIcon icon="close" label={`Remove ${r.label || r.email}`} variant="bare" tone="danger" glyphSize={14} onClick={() => void send(recipients.filter((x) => x.id !== r.id))} />
            </li>
          ))}
        </ul>
      ) : null}
      <AddRow noun="email" label="Email address" placeholder="name@example.com" maxLength={254} onAdd={add} />
    </div>
  )
}
