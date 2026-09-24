'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TITLE_MAX, type BrandLogo, type BrandLogos } from '@/lib/brand'
import { mediaThumbUrl } from '@/lib/storage-url'
import { useConfirm } from '../../../confirm-dialog'
import { toast } from '../../../toast'
import { AddRow } from '../../_ui/add-row'
import { LedgerRow } from '../../_ui/ledger'
import type { BoardSwatch } from '../_ui/modal-board'
import { RowIcon } from '../../_ui/row-icon'
import { renameLogoAction, setLogoNoteAction } from '../actions'
import { LogoEditor, type LogoTarget } from './logo-editor'
import { LogoTile } from './logo-tile'
import { iconsFramedFrom, removeLogo, removeQuestion, type BuiltInPurpose, type IconUse } from './remove'

/** The two built-in rows: a fixed title and fixed grey guide text (the approved Brand-only
 *  exception to the no-instruction-copy rule). Not renamable, not deletable. */
export const BUILT_IN_LOGOS: readonly { purpose: BuiltInPurpose; title: string; guide: string }[] = [
  { purpose: 'logo_primary', title: 'Primary logo', guide: 'Site header and the press kit.' },
  { purpose: 'logo_secondary', title: 'Secondary logo', guide: 'A mark or a light version, for dark backgrounds.' },
]

/** An added row with no file yet. Client-only: it is saved when its upload lands, and
 *  leaving the page (or its trash) leaves nothing behind. */
type Pending = { key: string; title: string; note: string }

type Open = { kind: 'builtin'; purpose: BuiltInPurpose } | { kind: 'logo'; id: string } | { kind: 'pending'; key: string }

const tileUrl = (logo: BrandLogo | null) => (logo ? mediaThumbUrl(logo.storagePath, { size: 256 }) : null)

/**
 * BRAND → LOGOS (Sam, 2026-09-23, BRAND_PAGE_PLAN.md): Primary logo, Secondary logo, then
 * the logos the artist added, then "+ Add logo".
 *
 * Each row: the tile on a checkerboard ("Add" when empty) and one icon — a pencil (Edit)
 * when there is a file, a full-ink + (Add logo) when there is not. Both open the editor.
 * Added rows also carry a renamable title, a note, and a trash that asks first.
 *
 * The add flow is the one every Brand list shares: name → the new row's note (focused) →
 * Enter → the row's + → the editor, whose upload is the moment the row is saved
 * (addLogoAction with the title, the note and the file, in one write).
 *
 * Every write is followed by router.refresh(); the layout's brand-scoped loader decides
 * whether the Publish bar rises. Opening the editor, trying a background or typing a note
 * is never a change the bar hears about.
 */
export function LogosList({
  artistId,
  logos,
  swatches,
  icons,
}: {
  artistId: string
  logos: BrandLogos
  /** The artist's brand colours, offered as board backgrounds by name. */
  swatches: BoardSwatch[]
  /** Each generated icon: does it exist, and which logo is it framed from. Removing a logo
   *  removes the icons made from it (see remove.ts). */
  icons: IconUse
}) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [pending, setPending] = useState<Pending[]>([])
  /** Logos saved from a pending row that the server's list has not caught up with yet —
   *  so the row does not blink out between the save and the refresh. */
  const [justAdded, setJustAdded] = useState<BrandLogo[]>([])
  const [open, setOpen] = useState<Open | null>(null)
  /** Bumped per opening, so each one starts a fresh editor — while a pending row turning
   *  into a saved one mid-edit keeps the same editor and its warnings. */
  const [session, setSession] = useState(0)
  const nextKey = useRef(1)

  const serverIds = new Set(logos.added.map((l) => l.id))
  // Once the server lists a logo, the local copy has done its job (adjusting state while
  // rendering, the React-documented way to derive from a prop change).
  if (justAdded.some((l) => serverIds.has(l.id))) setJustAdded(justAdded.filter((l) => !serverIds.has(l.id)))
  const added = [...logos.added, ...justAdded.filter((l) => !serverIds.has(l.id))]

  function openEditor(next: Open) {
    setSession((s) => s + 1)
    setOpen(next)
  }

  function addPending(title: string) {
    const key = `pending-${nextKey.current++}`
    setPending((rows) => [...rows, { key, title, note: '' }])
  }

  const updatePending = (key: string, patch: Partial<Pending>) =>
    setPending((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const dropAdded = (id: string) => setJustAdded((rows) => rows.filter((l) => l.id !== id))

  /** The icons cut from this logo — they go with it. */
  const madeFrom = (logo: BrandLogo | null) => iconsFramedFrom(icons, logo?.id ?? null, logos.primary?.id ?? null)

  async function removeAdded(logo: BrandLogo) {
    const title = logo.label ?? 'Logo'
    const derived = madeFrom(logo)
    if (!(await ask(removeQuestion({ kind: 'added', id: logo.id }, title, derived), { action: 'Remove' }))) return
    const res = await removeLogo(artistId, { kind: 'added', id: logo.id }, derived)
    if (res.error) return toast(res.error, 'error')
    dropAdded(logo.id)
    router.refresh()
  }

  /** A save that answers `{ error }` hands it back to RowTitle / NoteField, which toast
   *  it as an error and put the old text back. */
  async function saved(res: Promise<{ error?: string }>) {
    const r = await res
    if (!r.error) router.refresh()
    return r
  }

  // What the open editor is working on, read fresh every render: a pending row that just
  // got its file is now an added logo, and a refresh brings a built-in's new file.
  let target: LogoTarget | null = null
  if (open?.kind === 'builtin') {
    const row = BUILT_IN_LOGOS.find((b) => b.purpose === open.purpose)!
    target = { kind: 'builtin', purpose: row.purpose, title: row.title, logo: open.purpose === 'logo_primary' ? logos.primary : logos.secondary }
  } else if (open?.kind === 'logo') {
    const logo = added.find((l) => l.id === open.id)
    if (logo) target = { kind: 'added', title: logo.label ?? 'Logo', logo }
  } else if (open?.kind === 'pending') {
    const row = pending.find((p) => p.key === open.key)
    if (row) target = { kind: 'pending', title: row.title, note: row.note }
  }

  return (
    <>
      {BUILT_IN_LOGOS.map((b) => {
        const logo = b.purpose === 'logo_primary' ? logos.primary : logos.secondary
        const edit = () => openEditor({ kind: 'builtin', purpose: b.purpose })
        return (
          <LedgerRow key={b.purpose} title={b.title} guide={b.guide}>
            <LogoTile url={tileUrl(logo)} onClick={edit} />
            {logo ? <RowIcon icon="edit" label="Edit" onClick={edit} /> : <RowIcon icon="plus" label="Add logo" variant="primary" onClick={edit} />}
          </LedgerRow>
        )
      })}

      {added.map((logo) => {
        const edit = () => openEditor({ kind: 'logo', id: logo.id })
        return (
          <LedgerRow
            key={logo.id}
            title={logo.label ?? 'Logo'}
            onRename={(next) => saved(renameLogoAction(artistId, logo.id, next))}
            note={{ value: logo.note ?? '', onSave: (next) => saved(setLogoNoteAction(artistId, logo.id, next || null)) }}
            remove={<RowIcon icon="trash" label="Remove" tone="danger" onClick={() => void removeAdded(logo)} />}
          >
            <LogoTile url={tileUrl(logo)} onClick={edit} />
            <RowIcon icon="edit" label="Edit" onClick={edit} />
          </LedgerRow>
        )
      })}

      {pending.map((row) => (
        <PendingRow
          key={row.key}
          row={row}
          onRename={(title) => updatePending(row.key, { title })}
          onNote={(note) => updatePending(row.key, { note })}
          onEdit={() => openEditor({ kind: 'pending', key: row.key })}
          onDrop={() => setPending((rows) => rows.filter((r) => r.key !== row.key))}
        />
      ))}

      <AddRow noun="logo" onAdd={addPending} placeholder="Tertiary logo" maxLength={TITLE_MAX} />

      {target ? (
        <LogoEditor
          key={session}
          artistId={artistId}
          target={target}
          swatches={swatches}
          derivedIcons={madeFrom(target.kind === 'pending' ? null : target.logo)}
          onClose={() => setOpen(null)}
          onAdded={(logo) => {
            // The pending row is saved: it becomes this logo, and the open editor follows it.
            const key = open?.kind === 'pending' ? open.key : null
            setJustAdded((rows) => [...rows, logo])
            if (key) setPending((rows) => rows.filter((r) => r.key !== key))
            setOpen({ kind: 'logo', id: logo.id })
          }}
          onRemoved={(id) => {
            dropAdded(id)
            setOpen(null)
          }}
        />
      ) : null}
      {dialog}
    </>
  )
}

/**
 * An added row before its file: renamable title and note (kept on the client), the empty
 * tile, the full-ink + that focus reaches from the note's Enter, and a trash that simply
 * drops it — there is nothing saved to lose, so it does not ask.
 */
function PendingRow({
  row,
  onRename,
  onNote,
  onEdit,
  onDrop,
}: {
  row: Pending
  onRename: (title: string) => void
  onNote: (note: string) => void
  onEdit: () => void
  onDrop: () => void
}) {
  const plus = useRef<HTMLButtonElement>(null)
  return (
    <LedgerRow
      title={row.title}
      onRename={onRename}
      note={{ value: row.note, onSave: onNote, primaryRef: plus, autoFocus: true }}
      remove={<RowIcon icon="trash" label="Remove" tone="danger" onClick={onDrop} />}
    >
      <LogoTile url={null} onClick={onEdit} />
      <RowIcon ref={plus} icon="plus" label="Add logo" variant="primary" onClick={onEdit} />
    </LedgerRow>
  )
}
