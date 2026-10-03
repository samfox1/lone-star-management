'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '@/lib/cx'
import { useConfirm } from '../../confirm-dialog'
import { toast } from '../../toast'
import { LineField } from '../_ui/fields'
import { FOCUS_RING } from '../_ui/focus-ring'
import { LEDGER_ROW_GRID, LedgerSection } from '../_ui/ledger'
import { RowIcon } from '../_ui/row-icon'
import {
  deleteEnquiryKindAction,
  saveEnquiryKindAction,
  setEnquiryRecipientsAction,
} from './actions'
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
 * click away puts it back. Click a kind's NAME and the name and its description both become
 * fields (KindHead), the same way. Every kind but `other` can be deleted from its name's trash
 * (`other` is the fallback every unknown purpose lands on; the database refuses).
 *
 * Every save sends the WHOLE list and shows what the server answered.
 */
export function KindRows({ artistId, kinds: initial }: { artistId: string; kinds: EnquiryKindRow[] }) {
  const [kinds, setKinds] = useState(initial)

  const patch = (id: string, next: Partial<EnquiryKindRow>) =>
    setKinds((ks) => ks.map((k) => (k.id === id ? { ...k, ...next } : k)))

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
      return {}
    } finally {
      saving.current.delete(kind.id)
    }
  }

  return (
    <LedgerSection label="Enquiries">
      {kinds.map((k) => (
        <KindRow
          key={k.id}
          artistId={artistId}
          kind={k}
          onSave={(next) => save(k, next)}
          onSaved={(saved) => patch(k.id, saved)}
          onDeleted={() => setKinds((ks) => ks.filter((x) => x.id !== k.id))}
        />
      ))}
    </LedgerSection>
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
const EMAIL_TEXT = 'font-space text-[13px] leading-6 text-ink'

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
  onSave,
  onSaved,
  onDeleted,
}: {
  artistId: string
  kind: EnquiryKindRow
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

  /** The row's +: one more address on THIS kind's list. */
  function add(email: string) {
    const problem = recipientProblem(addresses.map((r) => r.email), email)
    if (problem) return { error: problem }
    return onSave([...addresses, { email: email.trim(), label: null }])
  }

  function edit(i: number, email: string) {
    const problem = recipientProblem(addresses.filter((_, j) => j !== i).map((r) => r.email), email)
    if (problem) return { error: problem }
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
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-x-4 gap-y-1 min-[900px]:justify-end">
        {addresses.map((r, i) => (
          // Keyed by POSITION: a refused edit puts the list back, and the field must survive
          // that with what was typed still in it.
          <ClickEdit
            key={i}
            value={r.email}
            title={r.label ?? undefined}
            label="Email"
            text={EMAIL_TEXT}
            email
            maxLength={254}
            onSave={(v) => edit(i, v)}
            onDelete={() => void remove(i)}
            deleteLabel={`Remove ${r.label || r.email}`}
          />
        ))}
        <PlusField
          label={`Add email to ${kind.label}`}
          fieldLabel={`New email for ${kind.label}`}
          placeholder="name@example.com"
          maxLength={254}
          email
          text={cx(EMAIL_TEXT, 'min-w-[16ch] max-w-full [field-sizing:content]')}
          onAdd={add}
        />
      </div>
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

/**
 * TEXT YOU CLICK TO EDIT (Sam, 2026-10-02: "The delete icon appears after I click on it, same
 * with the edit. I want minimal stuff on the screen"). At rest, the text alone, as a button (so
 * a keyboard reaches it: focus, Enter). Clicked, it is an underline field in the same type, with
 * ✓ and, when there is something to delete, a trash.
 *
 *   Enter or ✓      saves the trimmed text, only when it changed; a refusal says why in a toast
 *                   and KEEPS what was typed in the field
 *   Escape          puts it back
 *   a click away    puts it back (focus leaving the field and its glyphs)
 *
 * The glyphs keep the field focused on mousedown, so clicking ✓ is a save, not a click away.
 */
function ClickEdit({
  value,
  label,
  text,
  email = false,
  maxLength,
  title,
  onSave,
  onDelete,
  deleteLabel,
}: {
  value: string
  /** The field's accessible name: "Email". */
  label: string
  /** The text's look, at rest and while edited. */
  text: string
  email?: boolean
  maxLength: number
  title?: string
  onSave: (next: string) => Promise<{ error?: string }> | { error?: string }
  onDelete?: () => void
  deleteLabel?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const savingRef = useRef(false)
  /** Hand focus back to the text after Enter or Escape (a keyboard user's place). */
  const refocus = useRef(false)
  const editing = draft !== null

  useEffect(() => {
    if (editing) input.current?.focus()
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
    const next = draft.trim()
    if (next === value) return close(true)
    savingRef.current = true
    try {
      const res = await onSave(next)
      if (res?.error) {
        toast(res.error, 'error')
        input.current?.focus()
        return
      }
      close(true)
    } catch {
      toast(`Couldn’t save that ${label.toLowerCase()}.`, 'error')
    } finally {
      savingRef.current = false
    }
  }

  if (!editing) {
    return (
      <button ref={button} type="button" title={title} onClick={() => setDraft(value)} className={cx('max-w-full cursor-text truncate rounded text-left', text, FOCUS_RING)}>
        {value}
      </button>
    )
  }

  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close(false)
      }}
    >
      <LineField
        ref={input}
        label={label}
        value={draft}
        onChange={(v) => setDraft(v.slice(0, maxLength))}
        mono={email ? 'value' : undefined}
        inputMode={email ? 'email' : undefined}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            close(true)
          }
        }}
        // As wide as the text (field-sizing where supported), never wider than the row.
        className={cx('min-w-[8ch] max-w-full [field-sizing:content]', !email && 'font-medium')}
      />
      {/* mousedown would blur the field first, and a blur is "put it back". */}
      <span className="inline-flex items-center gap-1.5" onMouseDown={(e) => e.preventDefault()}>
        <RowIcon icon="check" label="Save" variant="bare" tone="accent" glyphSize={14} onClick={() => void save()} />
        {onDelete ? (
          <RowIcon
            icon="trash"
            label={deleteLabel ?? 'Delete'}
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
  )
}

/**
 * A BARE + THAT OPENS A LINE (Sam: "Dont say add email. Have it be a plus"; no boxes). Clicked,
 * it becomes an underline field in the type of the text it will add, with bare ✓ and ×, in the
 * place that text will sit: at the end of the row's addresses.
 *
 *   Enter or ✓   adds; a refusal says why in a toast and KEEPS what was typed in the field
 *   Escape or ×  closes it and adds nothing
 *
 * The latch is a ref (AGENTS.md rule 5): Enter and ✓ in one tick must add once.
 */
function PlusField({
  label,
  fieldLabel,
  placeholder,
  maxLength,
  email = false,
  text,
  onAdd,
}: {
  /** The +'s name and hover label. */
  label: string
  /** The open field's accessible name. */
  fieldLabel: string
  placeholder: string
  maxLength: number
  email?: boolean
  /** The field's type and width: the look of what it adds. */
  text: string
  onAdd: (value: string) => Promise<{ error?: string }> | { error?: string }
}) {
  const [value, setValue] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const plus = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false)
  /** Focus goes back to the + after a cancel or an add. */
  const refocus = useRef(false)
  const open = value !== null

  useEffect(() => {
    if (open) field.current?.focus()
    else if (refocus.current) {
      refocus.current = false
      plus.current?.focus()
    }
  }, [open])

  function close() {
    refocus.current = true
    setValue(null)
  }

  async function confirm() {
    const next = (value ?? '').trim()
    if (!next || busyRef.current) return
    busyRef.current = true
    try {
      const res = await onAdd(next)
      if (res?.error) {
        toast(res.error, 'error')
        field.current?.focus()
        return
      }
      close()
    } finally {
      busyRef.current = false
    }
  }

  if (!open) return <RowIcon ref={plus} icon="plus" label={label} variant="bare" glyphSize={16} onClick={() => setValue('')} />

  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <input
        ref={field}
        aria-label={fieldLabel}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        inputMode={email ? 'email' : undefined}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void confirm()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            close()
          }
        }}
        className={cx(UNDERLINE, text)}
      />
      <RowIcon icon="check" label="Add" variant="bare" tone="accent" glyphSize={16} onClick={() => void confirm()} />
      <RowIcon icon="close" label="Cancel" variant="bare" tone="danger" glyphSize={16} onClick={close} />
    </span>
  )
}
