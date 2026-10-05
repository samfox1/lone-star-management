'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '@/components/ui/icons'
import { ICON_BOLD } from '@/components/ui/icon-hover'
import { cx } from '@/lib/cx'
import { emailKey, type ConfirmState } from '@/lib/enquiries/confirm'
import { useConfirm } from '../../confirm-dialog'
import { toast } from '../../toast'
import { EditList } from '../_ui/edit-list'
import { FOCUS_RING } from '../_ui/focus-ring'
import { LEDGER_ROW_GRID, LedgerSection } from '../_ui/ledger'
import { HoverLabel, RowIcon } from '../_ui/row-icon'
import {
  deleteEnquiryKindAction,
  saveEnquiryKindAction,
  setEnquiryRecipientsAction,
} from './actions'
import { ConfirmWindow } from './confirm-window'
import {
  DESCRIPTION_MAX,
  LABEL_MAX,
  PURPOSE_FALLBACK,
  kindDetailsUpdate,
  recipientProblem,
  type EnquiryKindRow,
  type KindDetails,
} from '@/lib/enquiries/kinds'

/**
 * Who receives each kind of enquiry: Settings › Email, the ONE place addresses are managed
 * (Sam, 2026-10-02). What he asked for, in order:
 *   "Remove email from General."
 *   "I dont want the main address to recieve everything, I should have to add each one
 *    individually" (20261002210000: a kind goes ONLY to its own list)
 *   "work more like genre where you add it and then can see it … Dont put the email in a pill"
 *   "Dont say add email. Have it be a plus (+)."
 *   "Have a plus for every row, not in the bottom left" (and no new kinds from here for now:
 *    "Lets remove the ability to add new email types right now"; addEnquiryKindAction stays)
 *   "when I click on a submitted email, then I can edit it or delete it … I want minimal stuff"
 *   "i should be able to edit/delete every email there"; "It should say for x, y and z"
 *   "I dont like the border around the container when adding an email"
 *   "if I add a new type of email name, I should be able to add and edit the description for it"
 *
 * So, at rest: one ledger row per kind, its NAME on the left with what it is FOR under it (its
 * description, 20261002220000; no line when it has none), its OWN addresses as plain text on the
 * right ending in a + that adds one more to THAT kind. No words on the +, no boxes: it opens an
 * underline field where the address will sit (Sam: "a line lined up with where the email name
 * and email address are"). Every address shown is one this kind is sent to, and every one
 * can be clicked to edit or delete: nothing is read-only, nothing is greyed out. The site's
 * public booking contact (its link or text) is NOT a recipient and is not shown here.
 *
 * Click an address and it becomes its field, with ✓ and a trash; Enter or ✓ saves, Escape or a
 * click away puts it back (the shared click-to-edit list, _ui/edit-list.tsx, lifted from here). Click a kind's NAME and the name and its description both become
 * fields (KindHead), the same way. Every kind but `other` can be deleted from its name's trash
 * (`other` is the fallback every unknown purpose lands on; the database refuses).
 *
 * Every save sends the WHOLE list and shows what the server answered.
 *
 * CONFIRMED OR WAITING (EMAIL_CONFIRM_PLAN.md §3, 2026-10-05). An address is used only once it
 * has proved it wants the enquiries. A confirmed one looks and behaves exactly as above. A
 * waiting one is accent blue with a key after it (Sam: "Lets do key") and is not click-to-edit:
 * a click opens the code window without sending (hover: "Enter code"). Adding an address saves
 * the list, sends its code and opens the window. Changing a CONFIRMED address adds the new one
 * (waiting) and keeps the old, which goes from that kind's list when the new one confirms. One
 * confirmation covers the address on every list (it is per artist and address).
 */
export function KindRows({
  artistId,
  kinds: initial,
  confirm,
}: {
  artistId: string
  kinds: EnquiryKindRow[]
  /** Which addresses are confirmed (the loader's email_confirmation_status). */
  confirm: ConfirmState
}) {
  const [kinds, setKinds] = useState(initial)
  /** Confirmed addresses (emailKey). Anything else is waiting: default deny, as in the SQL. */
  const [confirmed, setConfirmed] = useState(() => new Set(confirm.confirmed))
  const waiting = (email: string) => !confirmed.has(emailKey(email))
  /** The code window: which address, on which kind's row, and whether opening it sends. */
  const [codeFor, setCodeFor] = useState<{ kindId: string; email: string; send: boolean; sentAt?: number } | null>(null)
  /** When the last code went to each address on this visit, for the window's countdown. */
  const sentAt = useRef(new Map<string, number>())
  /** A confirmed address being changed: the new one's key → the old one, which leaves that
   *  kind's list when the new one confirms. */
  const replacing = useRef(new Map<string, { kindId: string; email: string }>())
  const { ask, dialog } = useConfirm()

  const patch = (id: string, next: Partial<EnquiryKindRow>) =>
    setKinds((ks) => ks.map((k) => (k.id === id ? { ...k, ...next } : k)))

  /** An address off every list is forgotten, as the database does at commit (20261006130000;
   *  Sam, 2026-10-05: "forget it on removal"): added again, it waits for a new code. */
  function forgetUnlisted(stillListed: { email: string }[]) {
    const keep = new Set(stillListed.map((r) => emailKey(r.email)))
    setConfirmed((s) => new Set([...s].filter((e) => keep.has(e))))
  }

  /**
   * ONE SAVE PER KIND AT A TIME, whoever starts it (a row's edit or remove, or the +). Each save
   * sends the whole list, so two in flight for one kind would interleave and the second would
   * drop whatever the first changed. The latch is a ref, not state (AGENTS.md rule 5): two fast
   * clicks both read pre-render state.
   */
  const saving = useRef(new Set<string>())
  async function save(kind: EnquiryKindRow, next: Addr[]): Promise<{ error?: string }> {
    if (saving.current.has(kind.id)) return { error: STILL_SAVING }
    saving.current.add(kind.id)
    const before = kind.recipients
    try {
      patch(kind.id, { recipients: next.map((r, i) => ({ id: `new-${i}-${r.email}`, ...r })) })
      const res = await setEnquiryRecipientsAction(artistId, kind.id, next)
      if (res.error || !res.rows) {
        // Atomic, so the database still holds `before`: putting it back is TRUE, not cosmetic.
        patch(kind.id, { recipients: before })
        return { error: res.error ?? 'Could not save the list.' }
      }
      // Server ids and order replace the optimistic ones.
      patch(kind.id, { recipients: res.rows })
      forgetUnlisted([...kinds.filter((k) => k.id !== kind.id).flatMap((k) => k.recipients), ...res.rows])
      return {}
    } finally {
      saving.current.delete(kind.id)
    }
  }

  /** Open the code window for one address on one kind's row. */
  function openCode(kindId: string, email: string, opts: { send: boolean; replaces?: string }) {
    if (opts.replaces) replacing.current.set(emailKey(email), { kindId, email: opts.replaces })
    setCodeFor({ kindId, email, send: opts.send, sentAt: sentAt.current.get(emailKey(email)) })
  }

  /** Drop an address from one kind's list (by address, not position: the list may have moved). */
  async function dropFrom(kindId: string, email: string, confirmLast: boolean) {
    const k = kinds.find((x) => x.id === kindId)
    if (!k) return
    const next = k.recipients.filter((r) => emailKey(r.email) !== emailKey(email))
    if (next.length === k.recipients.length) return
    if (confirmLast && !next.length && !(await ask(`Remove ${email}? No one else gets ${k.label} enquiries.`, { action: 'Remove' }))) return
    const res = await save(k, next)
    if (res.error) toast(res.error, 'error')
  }

  /** The address proved itself: ink everywhere it is listed, and an address it replaces goes. */
  function onConfirmed(email: string) {
    const key = emailKey(email)
    setConfirmed((s) => new Set(s).add(key))
    setCodeFor(null)
    const swap = replacing.current.get(key)
    if (!swap) return
    replacing.current.delete(key)
    void dropFrom(swap.kindId, swap.email, false)
  }

  return (
    <>
      <LedgerSection label="Enquiries">
        {kinds.map((k) => (
          <KindRow
            key={k.id}
            artistId={artistId}
            kind={k}
            waiting={waiting}
            onCode={(email, opts) => openCode(k.id, email, opts)}
            onSave={(next) => save(k, next)}
            onSaved={(saved) => patch(k.id, saved)}
            onDeleted={() => {
              setKinds((ks) => ks.filter((x) => x.id !== k.id))
              forgetUnlisted(kinds.filter((x) => x.id !== k.id).flatMap((x) => x.recipients))
            }}
          />
        ))}
      </LedgerSection>
      {codeFor ? (
        <ConfirmWindow
          key={emailKey(codeFor.email)}
          artistId={artistId}
          email={codeFor.email}
          sendOnOpen={codeFor.send}
          sentAt={codeFor.sentAt}
          onSent={(at) => {
            if (at === undefined) sentAt.current.delete(emailKey(codeFor.email))
            else sentAt.current.set(emailKey(codeFor.email), at)
          }}
          onConfirmed={() => onConfirmed(codeFor.email)}
          onRemove={() => {
            setCodeFor(null)
            replacing.current.delete(emailKey(codeFor.email))
            void dropFrom(codeFor.kindId, codeFor.email, true)
          }}
          onClose={() => setCodeFor(null)}
        />
      ) : null}
      {dialog}
    </>
  )
}

/**
 * AN ADDRESS WAITING FOR ITS CODE (mock: prototypes/email_confirm_20261005.html §03): the
 * accent blue (the on-site check's "pending"), a 14px key after it, "Enter code" on hover. A
 * click opens the code window; it sends nothing (the window's glyph does).
 */
function WaitingAddress({ email, onOpen }: { email: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${email}: enter the code`}
      className={cx('relative inline-flex max-w-full items-center gap-1.5 rounded text-left text-accent', EMAIL_TEXT_FACE, ICON_BOLD, FOCUS_RING)}
    >
      <span className="truncate">{email}</span>
      <Icon name="key" size={14} />
      <HoverLabel label="Enter code" />
    </button>
  )
}

type Addr = { email: string; label: string | null }

const STILL_SAVING = 'Still saving — try that again in a moment.'

/** The grey line under a kind's name: what it is for (LedgerRow's `guide` look). */
const GUIDE_TEXT = 'text-[13px] leading-5 text-ink-muted'
const GUIDE = cx('mt-0.5 max-w-[40ch]', GUIDE_TEXT)

/** A field that is only a line (Sam: no boxes), in the type of the text it stands in for. */
const UNDERLINE = 'border-b border-hairline bg-transparent p-0 outline-none placeholder:text-ink-faint focus:border-ink'
const NAME_TEXT = 'text-[15px] font-medium leading-6 text-ink'
/** An address's type without its colour: ink when confirmed, accent while waiting. */
const EMAIL_TEXT_FACE = 'font-space text-[13px] leading-6'
const EMAIL_TEXT = cx(EMAIL_TEXT_FACE, 'text-ink')

/**
 * One kind: its name and what it is for, its addresses in a line.
 *
 * `recipientProblem` runs before any save (ASCII-strict shape, because one pasted zero-width
 * space makes Resend refuse the whole send; a case-insensitive repeat; the cap of ten). The
 * database enforces all three too; this is what lets the manager be told in a sentence.
 */
function KindRow({
  artistId,
  kind,
  waiting,
  onCode,
  onSave,
  onSaved,
  onDeleted,
}: {
  artistId: string
  kind: EnquiryKindRow
  /** Has this address yet to be confirmed? (Never, when confirmation is off.) */
  waiting: (email: string) => boolean
  /** Open the code window for an address on this row; `send` sends a code as it opens. */
  onCode: (email: string, opts: { send: boolean; replaces?: string }) => void
  /** The whole new list. Resolves `{ error }` (unsaid: the caller does not toast). */
  onSave: (next: Addr[]) => Promise<{ error?: string }>
  /** The name and/or description as stored. */
  onSaved: (saved: KindDetails) => void
  onDeleted: () => void
}) {
  const { ask, dialog } = useConfirm()
  /** One delete of the kind at a time (rule 5). */
  const deletingRef = useRef(false)
  const addresses = kind.recipients

  /** Why an address can't go on this list (`index`: the one being edited, left out of the
   *  repeat check), or nothing. EditList asks before it saves. */
  const problem = (email: string, index: number | null) =>
    recipientProblem(addresses.filter((_, j) => j !== index).map((r) => r.email), email)

  /** The row's +: one more address on THIS kind's list. A new address then gets its code and
   *  the window opens; one already confirmed (it is on another list) needs neither. */
  async function add(email: string) {
    const res = await onSave([...addresses, { email, label: null }])
    if (!res.error && waiting(email)) onCode(email, { send: true })
    return res
  }

  async function edit(i: number, email: string) {
    const old = addresses[i]
    // A confirmed address is never swapped for one nobody has confirmed: enquiries would stop
    // until the new one proves itself. The new one joins the list (waiting) and the old one
    // keeps receiving until then (EMAIL_CONFIRM_PLAN.md §3). A change of case is the same address.
    if (!waiting(old.email) && waiting(email) && emailKey(email) !== emailKey(old.email)) {
      const res = await onSave([...addresses, { email, label: old.label }])
      if (!res.error) onCode(email, { send: true, replaces: old.email })
      return res
    }
    return onSave(addresses.map((r, j) => (j === i ? { email, label: r.label } : r)))
  }

  /** No question for an ordinary address; asked only for the kind's LAST one, after which
   *  this kind of enquiry is stored and reaches nobody. */
  async function remove(i: number) {
    const email = addresses[i].email
    if (addresses.length === 1 && !(await ask(`Remove ${email}? No one else gets ${kind.label} enquiries.`, { action: 'Remove' }))) return
    const res = await onSave(addresses.filter((_, j) => j !== i))
    if (res.error) toast(res.error, 'error')
  }

  async function saveDetails(details: KindDetails) {
    const res = await saveEnquiryKindAction(artistId, kind.id, details)
    // What the server stored (trimmed, cut to LABEL_MAX, an empty description as null).
    if (!res.error && res.saved) onSaved(res.saved)
    return res
  }

  async function del() {
    if (deletingRef.current) return
    // No undo and no trash can.
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

  return (
    <div data-ledger-row="" data-kind={kind.slug} className={LEDGER_ROW_GRID}>
      <KindHead kind={kind} onSave={saveDetails} onDelete={kind.slug !== PURPOSE_FALLBACK ? () => void del() : undefined} />
      {/* Keyed by POSITION (EditList's default): a refused edit puts the list back, and the
          field must survive that with what was typed still in it. */}
      <EditList
        items={addresses}
        text={(r) => r.email}
        title={(r) => r.label ?? undefined}
        label="Email"
        addLabel={`Add email to ${kind.label}`}
        addFieldLabel={`New email for ${kind.label}`}
        placeholder="name@example.com"
        maxLength={254}
        inputMode="email"
        textClass={EMAIL_TEXT}
        validate={problem}
        onSave={edit}
        onAdd={add}
        onRemove={(i) => void remove(i)}
        removeLabel={(r) => `Remove ${r.label || r.email}`}
        atRest={(r) => (waiting(r.email) ? <WaitingAddress email={r.email} onOpen={() => onCode(r.email, { send: false })} /> : undefined)}
        className="justify-start min-[900px]:justify-end"
      />
      {dialog}
    </div>
  )
}

/**
 * A KIND'S NAME AND WHAT IT IS FOR, edited together (Sam, 2026-10-02: "I should be able to add and
 * edit the description"). At rest, the name (a button, so a keyboard reaches it) and under it the
 * grey line, none when the kind has no description. Click the name and both become underline
 * fields in their own type (no boxes), ✓ and, when the kind can go, a trash beside the name:
 *
 *   Enter (in either) or ✓   saves only what changed; a refusal says why in a toast and KEEPS
 *                            both fields as typed
 *   Escape                   puts both back
 *   a click away             puts both back (focus leaving the fields and their glyphs)
 *
 * An empty description is "no line" (saved as null). kindDetailsUpdate checks the edit here, to
 * say so before a round trip; the save checks it again.
 */
function KindHead({
  kind,
  onSave,
  onDelete,
}: {
  kind: EnquiryKindRow
  onSave: (details: KindDetails) => Promise<{ error?: string }>
  onDelete?: () => void
}) {
  const [draft, setDraft] = useState<{ label: string; description: string } | null>(null)
  const nameField = useRef<HTMLInputElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  /** One save at a time: Enter and ✓ in one tick save once (rule 5). */
  const savingRef = useRef(false)
  /** Hand focus back to the name after Enter or Escape (a keyboard user's place). */
  const refocus = useRef(false)
  const editing = draft !== null

  useEffect(() => {
    if (editing) nameField.current?.focus()
    else if (refocus.current) {
      refocus.current = false
      button.current?.focus()
    }
  }, [editing])

  function close(keyboard: boolean) {
    refocus.current = keyboard
    setDraft(null)
  }

  async function save() {
    if (draft === null || savingRef.current) return
    const details: KindDetails = {}
    if (draft.label.trim() !== kind.label) details.label = draft.label
    const description = draft.description.trim()
    if (description !== (kind.description ?? '')) details.description = description || null
    if (!Object.keys(details).length) return close(true)

    const checked = kindDetailsUpdate(details)
    if (!checked.ok) {
      toast(checked.error, 'error')
      return
    }
    savingRef.current = true
    try {
      const res = await onSave(details)
      if (res.error) {
        toast(res.error, 'error')
        return
      }
      close(true)
    } catch {
      toast('Couldn’t save that kind.', 'error')
    } finally {
      savingRef.current = false
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    }
  }

  if (!editing) {
    return (
      <div className="min-w-0">
        <button
          ref={button}
          type="button"
          onClick={() => setDraft({ label: kind.label, description: kind.description ?? '' })}
          className={cx('max-w-full cursor-text truncate rounded text-left', NAME_TEXT, FOCUS_RING)}
        >
          {kind.label}
        </button>
        {kind.description ? <div className={GUIDE}>{kind.description}</div> : null}
      </div>
    )
  }

  return (
    <div
      className="flex min-w-0 flex-col"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close(false)
      }}
    >
      <span className="inline-flex max-w-full items-center gap-1.5">
        <input
          ref={nameField}
          aria-label="Kind name"
          value={draft.label}
          maxLength={LABEL_MAX}
          spellCheck={false}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          onKeyDown={onKeyDown}
          // As wide as the text (field-sizing where supported), never wider than the row.
          className={cx(UNDERLINE, NAME_TEXT, 'min-w-[8ch] max-w-full [field-sizing:content]')}
        />
        {/* mousedown would blur the field first, and a blur is "put it back". */}
        <span className="inline-flex items-center gap-1.5" onMouseDown={(e) => e.preventDefault()}>
          <RowIcon icon="check" label="Save" variant="bare" tone="accent" glyphSize={14} onClick={() => void save()} />
          {onDelete ? (
            <RowIcon
              icon="trash"
              label={`Delete ${kind.label}`}
              variant="bare"
              tone="danger"
              glyphSize={14}
              onClick={() => {
                close(false)
                onDelete()
              }}
            />
          ) : null}
        </span>
      </span>
      <input
        aria-label="Description"
        value={draft.description}
        maxLength={DESCRIPTION_MAX}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        onKeyDown={onKeyDown}
        // A line to write on even when empty: the description it stands in for may not exist yet.
        className={cx(UNDERLINE, GUIDE_TEXT, 'mt-1 w-full max-w-[40ch] focus:text-ink')}
      />
    </div>
  )
}
