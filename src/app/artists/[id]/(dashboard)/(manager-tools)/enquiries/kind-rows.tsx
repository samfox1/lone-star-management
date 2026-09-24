'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '@/components/ui/icons'
import { buttonClass } from '@/components/ui/ui'
import { CardModal } from '../../card-modal'
import { KvField, KvRow, ModalHeader } from '../../modal-kit'
import { toast } from '../../toast'
import {
  addEnquiryKindAction,
  deleteEnquiryKindAction,
  renameEnquiryKindAction,
  setEnquiryRecipientsAction,
} from './actions'
import { LABEL_MAX, PURPOSE_FALLBACK, recipientProblem, type EnquiryKindRow } from '@/lib/enquiries/kinds'

/**
 * Who receives each kind of enquiry (Sam, 2026-09-22: kind rows above the inbox, the modal
 * kit on click).
 *
 * ONE ROW PER KIND, each showing the address that WOULD receive it and how many people are
 * copied. Clicking opens the modal-kit card: the label saves itself, the primary is shown
 * but never editable here, and the list is chips — the grammar SupportActs already uses for
 * a tour date's lineup.
 *
 * THE PRIMARY IS READ-ONLY ON PURPOSE. It is whatever `resolve_booking_recipient` found —
 * the booking address on the artist's own site — and it is edited in Settings, in one
 * place, because it is also what the public site displays. Showing it here without letting
 * it be changed is what stops the two screens disagreeing about the same address. These
 * lists only ADD to it (20260921120000).
 *
 * No captions, no explanatory paragraph: the rows say what they are (no-instruction-copy,
 * Sam 2026-08-12).
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
  const [adding, setAdding] = useState(false)
  // Re-entry latch for Add (AGENTS.md rule 5): two Enters before the first insert returns
  // used to mint a duplicate `press-2`, or lose the 23505 race and toast (review 2026-09-23).
  const addingRef = useRef(false)

  const open = kinds.find((k) => k.id === openId) ?? null

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
      setAdding(false)
    } finally {
      addingRef.current = false
    }
  }

  return (
    <div className="space-y-1">
      {kinds.map((k) => (
        <button
          key={k.id}
          type="button"
          onClick={() => setOpenId(k.id)}
          className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-ink/[0.03]"
        >
          <span aria-hidden className="size-2 flex-none rounded-[2px] bg-ink" />
          <span className="min-w-[110px] flex-none text-sm font-medium">{k.label}</span>
          {/* The address this kind would actually reach. A missing one is the only thing
              that speaks up, because it is the only thing the manager has to act on. */}
          <span className="truncate font-mono text-xs text-ink-muted">
            {primary ?? 'No booking address set'}
          </span>
          {k.recipients.length > 0 ? (
            <span className="flex-none font-mono text-xs text-ink-faint">
              +{k.recipients.length}
            </span>
          ) : null}
          <Icon
            name="chevronRight"
            size={15}
            className="ml-auto flex-none text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
          />
        </button>
      ))}

      {adding ? (
        <AddKind onCancel={() => setAdding(false)} onAdd={addKind} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <Icon name="plus" size={14} />
          Add kind
        </button>
      )}

      {open ? (
        <KindModal
          key={open.id}
          artistId={artistId}
          kind={open}
          primary={primary}
          onClose={() => setOpenId(null)}
          onPatch={(next) => patch(open.id, next)}
          onDeleted={() => {
            setKinds((ks) => ks.filter((k) => k.id !== open.id))
            setOpenId(null)
          }}
        />
      ) : null}
    </div>
  )
}

/** The inline "Add kind" input. Enter commits, Escape backs out. */
function AddKind({ onAdd, onCancel }: { onAdd: (label: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <input
        autoFocus
        aria-label="Kind name"
        value={value}
        placeholder="Press"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && value.trim()) onAdd(value)
          if (e.key === 'Escape') onCancel()
        }}
        className="w-[180px] rounded-md border border-hairline bg-transparent px-2 py-1 text-sm outline-none focus:border-ink"
      />
      <button
        type="button"
        disabled={!value.trim()}
        onClick={() => onAdd(value)}
        className={buttonClass('solid', 'px-3 py-1 text-xs disabled:opacity-40')}
      >
        Add
      </button>
    </div>
  )
}

/** One kind's card: label, the resolved primary, and the list as chips. */
function KindModal({
  artistId,
  kind,
  primary,
  onClose,
  onPatch,
  onDeleted,
}: {
  artistId: string
  kind: EnquiryKindRow
  primary: string | null
  onClose: () => void
  onPatch: (next: Partial<EnquiryKindRow>) => void
  onDeleted: () => void
}) {
  // `other` is the fallback every unrecognised purpose lands on, and the database refuses
  // to delete it. Not offering the button is kinder than offering one that always fails.
  const deletable = kind.slug !== PURPOSE_FALLBACK

  return (
    <CardModal
      open
      onClose={onClose}
      label={kind.label}
      deleteNoun="Kind"
      confirmText={`Delete “${kind.label}” and everyone on its list?`}
      deleteAction={
        deletable
          ? async () => {
              const res = await deleteEnquiryKindAction(artistId, kind.id)
              if (!res.error) onDeleted()
              return res
            }
          : undefined
      }
    >
      <ModalHeader
        square={<span aria-hidden className="grid size-14 place-items-center rounded-xl bg-ink/[0.06]"><Icon name="note" size={22} /></span>}
        title={kind.label}
        // The SLUG, because it is the one thing here that cannot be changed and the one
        // thing the artist's website has to match.
        meta={<span className="font-mono">{kind.slug}</span>}
      />

      <KvField
        label="Name"
        value={kind.label}
        onSave={async (v) => {
          const res = await renameEnquiryKindAction(artistId, kind.id, v)
          // The server stores the first LABEL_MAX characters; show what it stored.
          if (!res.error) onPatch({ label: v.trim().slice(0, LABEL_MAX) })
          return res
        }}
      />

      <KvRow label="Receives">
        <span className="font-mono text-sm text-ink-muted">
          {primary ?? <span className="text-accent-red">No booking address set</span>}
        </span>
      </KvRow>

      <KvRow label="Also" align="start">
        <Chips
          recipients={kind.recipients}
          onChange={async (next) => {
            const before = kind.recipients
            onPatch({ recipients: next })
            const res = await setEnquiryRecipientsAction(
              artistId,
              kind.id,
              next.map((r) => ({ email: r.email, label: r.label })),
            )
            if (res.error || !res.rows) {
              // The save is atomic now, so on a refusal the database still holds `before`
              // and putting it back is TRUE, not cosmetic.
              onPatch({ recipients: before })
              toast(res.error ?? 'Could not save the list.', 'error')
              return
            }
            // Server ids and server order replace the optimistic `new-…` ones.
            onPatch({ recipients: res.rows })
          }}
        />
      </KvRow>
    </CardModal>
  )
}

type Recipient = EnquiryKindRow['recipients'][number]

/**
 * The list as chips, the grammar SupportActs set for a tour date's lineup: a chip per
 * person, a dashed "+" to add. Optimistic, with the whole list sent on every change.
 *
 * TWO GUARDS the first version lacked (review, 2026-09-22):
 *   - `recipientProblem` runs BEFORE the save: address shape (ASCII-strict, because one
 *     pasted zero-width space makes Resend refuse the whole send), case-insensitive
 *     duplicates, and the cap of ten. The database enforces all three too; this is what
 *     lets the manager be told in a sentence instead of a toast of a constraint name.
 *   - `busyRef` is a re-entry LATCH — a ref, not state (AGENTS.md rule 5): two fast edits
 *     both read pre-render state, and letting the second save start before the first
 *     returned let them interleave and lose an address.
 *
 * A chip shows the LABEL when there is one and the address when there is not, so a list
 * reads as people rather than as a column of addresses.
 */
function Chips({
  recipients,
  onChange,
}: {
  recipients: Recipient[]
  onChange: (next: Recipient[]) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [email, setEmail] = useState('')
  const [label, setLabel] = useState('')
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

  function commit() {
    const clean = email.trim()
    if (!clean) return
    const problem = recipientProblem(recipients.map((r) => r.email), clean)
    if (problem) {
      // 'error', always: every toast in this file is a refusal (live check 2026-09-23
      // found them all wearing the success tick).
      toast(problem, 'error')
      return
    }
    // Checked HERE, before the inputs clear: a refused send used to wipe what was typed
    // without saving it (review 2026-09-23).
    if (busy()) return
    void send([...recipients, { id: `new-${crypto.randomUUID()}`, email: clean, label: label.trim() || null }])
    setEmail('')
    setLabel('')
    setAdding(false)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setAdding(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {recipients.map((r) => (
        <span
          key={r.id}
          title={r.email}
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline py-1 pl-2.5 pr-1.5 text-xs"
        >
          {r.label || r.email}
          <button
            type="button"
            aria-label={`Remove ${r.label || r.email}`}
            onClick={() => void send(recipients.filter((x) => x.id !== r.id))}
            className="grid size-4 place-items-center rounded-full text-ink-faint transition-colors hover:bg-ink/10 hover:text-ink"
          >
            <Icon name="close" size={10} />
          </button>
        </span>
      ))}

      {adding ? (
        <span className="inline-flex items-center gap-1.5">
          <input
            autoFocus
            aria-label="Email address"
            value={email}
            placeholder="name@example.com"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={onKey}
            className="w-[190px] rounded-full border border-hairline bg-transparent px-2.5 py-1 text-xs outline-none focus:border-ink"
          />
          <input
            aria-label="Who this is"
            value={label}
            placeholder="Who"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={onKey}
            className="w-[84px] rounded-full border border-hairline bg-transparent px-2.5 py-1 text-xs outline-none focus:border-ink"
          />
        </span>
      ) : (
        <button
          type="button"
          aria-label="Add someone"
          onClick={() => setAdding(true)}
          className="grid size-6 place-items-center rounded-full border border-dashed border-hairline text-ink-faint transition-colors hover:border-ink hover:text-ink"
        >
          <Icon name="plus" size={12} />
        </button>
      )}
    </div>
  )
}
