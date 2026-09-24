'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CUSTOM_FONT_SLOTS,
  fontFaceCss,
  googleStylesheetHref,
  nextFreeCustomSlot,
  type BrandFont,
  type BrandFonts,
  type CustomFontSlot,
  type FontSlot,
  type FontSlotMeta,
} from '@/lib/fonts'
import { weightName } from '@/lib/font-weight'
import { useConfirm } from '../../../confirm-dialog'
import { toast } from '../../../toast'
import { AddRow } from '../../_ui/add-row'
import type { SaveResult } from '../../_ui/inline-text'
import { LedgerRow, LedgerSection } from '../../_ui/ledger'
import { RowIcon } from '../../_ui/row-icon'
import {
  addGoogleFontAction,
  clearCustomFontSlotAction,
  removeArtistFontAction,
  renameArtistFontAction,
  setFontSlotAction,
  setFontSlotMetaAction,
} from '../actions'
import { BOLD_FROM } from './face'
import { FontSample } from './font-sample'
import { FontMenu } from './font-menu'
import { FontPreview } from './font-preview'
import { FontUploadDialog } from './font-upload-dialog'
import { GoogleFontPicker } from './google-font-picker'

/** The built-in rows: a fixed title and fixed grey guide text (Brand's approved exception
 *  to the no-instruction-copy rule). PRIMARY is headings and display type, SECONDARY body —
 *  the split lib/fonts.ts documents for the slot vocabulary. */
/**
 *  Keyed by EVERY slot that is not a custom one, so a new built-in slot in the vocabulary
 *  is a compile error here until it has a row (and BrandFonts a field for it) — a slot the
 *  payload carries that no row can set would fail nowhere else. */
type BuiltInSlot = Exclude<FontSlot, CustomFontSlot>
const BUILT_IN: Record<BuiltInSlot, { title: string; guide: string }> = {
  primary: { title: 'Primary', guide: 'Headings and names.' },
  secondary: { title: 'Secondary', guide: 'Body text and labels.' },
}
const BUILT_IN_SLOTS = Object.keys(BUILT_IN) as BuiltInSlot[]

/** A custom slot with no stored title ("custom_2" → "Custom 2"). Derived from the slot. */
const slotTitle = (slot: FontSlot) => {
  const words = slot.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * An added row that exists only here until it gets its font (the plan's add flow). It
 * holds the slot it will fill, chosen when it was added. `saved` flips once the pick or
 * upload lands; the row stays shown until the refresh brings the server's own row.
 */
type Pending = { slot: CustomFontSlot; title: string; note: string; font: BrandFont | null; saved: boolean }

type Row = {
  slot: FontSlot
  title: string
  /** Built-in: fixed title + guide. Otherwise: renamable, a note, a trash. */
  guide: string | null
  note: string
  font: BrandFont | null
  /** Client-only: every write so far went to local state, none to the database. */
  unsaved: boolean
}

type Upload = { slot: FontSlot; title: string; meta?: FontSlotMeta }

/**
 * BRAND → FONTS (BRAND_PAGE_PLAN.md; prototype variant A). One ledger row per font slot:
 * Primary and Secondary, then the added rows (custom slots, at most CUSTOM_FONT_SLOTS).
 *
 * EVERY FONT IS SHOWN IN ITSELF: the component injects the same @font-face CSS the site
 * gets (fontFaceCss, which re-sanitizes every family — the family is a CSS-injection sink)
 * and, for Google fonts, the css2 stylesheet the bridge builds; every inline face goes
 * through `faceOf`, the same allowlists.
 *
 * GOOGLE FONTS (BRAND_SYNC_PLAN.md, 2026-09-24): the Change menu's "Google Fonts…" opens
 * the picker; a family picked there is added and placed in one action. Its row says
 * "Google Fonts" where an upload says its weight (a Google family carries every weight).
 *
 * Writes go straight to the server actions; a refusal is an error toast and nothing moves.
 * After a write, `router.refresh()` so the layout's Publish bar sees the real change. A pick
 * of the font a row already holds is not a change and writes nothing.
 */
export function FontsLedger({ artistId, data }: { artistId: string; data: BrandFonts }) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [pending, setPending] = useState<Pending[]>([])
  /** A pick shown before the refresh brings it back, per slot. */
  const [picked, setPicked] = useState<Partial<Record<FontSlot, BrandFont>>>({})
  /** A font's new name, shown from the moment it is typed until the refresh brings it. */
  const [renamed, setRenamed] = useState<Record<string, string>>({})
  /** The row whose note takes focus: the one just added. */
  const [focusSlot, setFocusSlot] = useState<FontSlot | null>(null)
  const [menuFor, setMenuFor] = useState<FontSlot | null>(null)
  const [uploading, setUploading] = useState<Upload | null>(null)
  /** The row the Google picker is open for. */
  const [googleFor, setGoogleFor] = useState<Row | null>(null)
  const [previewing, setPreviewing] = useState<{ title: string; font: BrandFont } | null>(null)
  /** The re-entry latch. A ref: two fast clicks both read the pre-render state. */
  const busy = useRef(false)

  // NEW SERVER DATA (a refresh) supersedes what was shown ahead of it: optimistic picks go,
  // and an unsaved row whose slot the server now fills has become that row.
  const [seen, setSeen] = useState(data)
  if (seen !== data) {
    setSeen(data)
    setPicked({})
    setRenamed({})
    const filled = new Set<FontSlot>(data.custom.map((c) => c.slot))
    setPending((rows) => rows.filter((p) => !filled.has(p.slot)))
  }

  /** A font as it should read now: with its new name, if one is on its way. */
  const named = (f: BrandFont | null | undefined): BrandFont | null => (f && renamed[f.id] ? { ...f, label: renamed[f.id] } : (f ?? null))
  const fonts = data.fonts.map((f) => named(f)!)

  const builtIn = (slot: BuiltInSlot): Row => ({
    slot,
    title: BUILT_IN[slot].title,
    guide: BUILT_IN[slot].guide,
    note: '',
    font: named(picked[slot] ?? data[slot].font),
    unsaved: false,
  })
  const custom: Row[] = [
    ...data.custom.map((c) => ({
      slot: c.slot,
      title: c.label ?? slotTitle(c.slot),
      guide: null,
      note: c.note ?? '',
      font: named(picked[c.slot] ?? c.font),
      unsaved: false,
    })),
    ...pending.map((p) => ({ slot: p.slot, title: p.title, guide: null, note: p.note, font: named(p.font), unsaved: !p.saved })),
  ].sort((a, b) => CUSTOM_FONT_SLOTS.indexOf(a.slot as CustomFontSlot) - CUSTOM_FONT_SLOTS.indexOf(b.slot as CustomFontSlot))
  const rows = [...BUILT_IN_SLOTS.map(builtIn), ...custom]
  /** Where "+ Add font" lands; null hides it (every custom slot filled or claimed). */
  const freeSlot = nextFreeCustomSlot(custom.map((r) => r.slot))

  // Every font drawn in itself: uploads through the same @font-face the site gets, Google
  // fonts through the css2 stylesheet the bridge builds (all nine weights), set by their
  // real family (faceOf). The @import leads, or the browser ignores it.
  const wire = data.fonts.map((f) => ({
    family: f.family,
    label: f.label,
    format: f.format,
    path: f.storagePath,
    source: f.source,
    google_family: f.googleFamily,
  }))
  const googleHref = googleStylesheetHref(wire)
  const css = (googleHref ? `@import url('${googleHref}');` : '') + fontFaceCss(wire)

  const patchPending = (slot: FontSlot, patch: Partial<Pending>) =>
    setPending((ps) => ps.map((p) => (p.slot === slot ? { ...p, ...patch } : p)))

  /** One latched write: an error toast on refusal, a refresh on success. */
  async function run(work: () => Promise<{ error?: string }>, fallback: string): Promise<boolean> {
    if (busy.current) return false
    busy.current = true
    try {
      const res = await work()
      if (res?.error) {
        toast(res.error, 'error')
        return false
      }
      router.refresh()
      return true
    } catch {
      toast(fallback, 'error')
      return false
    } finally {
      busy.current = false
    }
  }

  /** An unsaved row's title and note, saved with its first font. */
  const metaOf = (row: Row): FontSlotMeta => ({ label: row.title, note: row.note || null })

  async function pick(row: Row, font: BrandFont) {
    setMenuFor(null)
    if (row.font?.id === font.id) return // the same font is not a change
    const meta = row.unsaved ? metaOf(row) : null
    const ok = await run(
      () => (meta ? setFontSlotAction(artistId, row.slot, font.id, meta) : setFontSlotAction(artistId, row.slot, font.id)),
      'Couldn’t change that font.',
    )
    if (!ok) return
    if (pending.some((p) => p.slot === row.slot)) patchPending(row.slot, { font, saved: true })
    else setPicked((m) => ({ ...m, [row.slot]: font }))
  }

  function openGoogle(row: Row) {
    setMenuFor(null)
    setGoogleFor(row)
  }

  /** A Google family picked for a row: add it (or reuse the artist's row for it) and place
   *  it, in ONE action — with an unsaved row's title and note, which it saves. The family
   *  the row already holds is not a change and writes nothing. A placement that failed is a
   *  warning: the font was added and is in the Change menu. */
  async function pickGoogle(row: Row, family: string) {
    setGoogleFor(null)
    if (row.font?.source === 'google' && row.font.googleFamily === family) return
    const meta = row.unsaved ? metaOf(row) : undefined
    let warned = false
    const ok = await run(async () => {
      const res = await addGoogleFontAction(artistId, family, row.slot, meta)
      if (res.warning) {
        warned = true
        toast(res.warning, 'error')
      }
      return res
    }, 'Couldn’t add that font.')
    if (ok && !warned && pending.some((p) => p.slot === row.slot)) patchPending(row.slot, { saved: true })
  }

  function openUpload(row: Row) {
    setMenuFor(null)
    setUploading({ slot: row.slot, title: row.title, ...(row.unsaved ? { meta: metaOf(row) } : {}) })
  }

  async function removeFont(font: BrandFont) {
    setMenuFor(null)
    const used = rows.some((r) => r.font?.id === font.id)
    const question = used ? `Remove ${font.label}? Every row set in it loses it.` : `Remove ${font.label}?`
    if (!(await ask(question, { action: 'Remove' }))) return
    await run(() => removeArtistFontAction(artistId, font.id), 'Couldn’t remove that font.')
  }

  /** Rename a FONT (its label, from the Change menu) — not a row. Shown at once; a refusal
   *  takes it back (the field toasts it). The label is published, so the refresh lets the
   *  layout's Publish bar see it. */
  async function renameFont(font: BrandFont, label: string): Promise<SaveResult> {
    setRenamed((m) => ({ ...m, [font.id]: label }))
    let res: { error?: string }
    try {
      res = await renameArtistFontAction(artistId, font.id, label)
    } catch {
      res = { error: 'Couldn’t rename that font.' }
    }
    if (res.error) {
      setRenamed((m) => {
        const next = { ...m }
        delete next[font.id]
        return next
      })
      return res
    }
    router.refresh()
  }

  async function rename(row: Row, label: string): Promise<SaveResult> {
    if (row.unsaved) return patchPending(row.slot, { title: label })
    const res = await setFontSlotMetaAction(artistId, row.slot, { label })
    if (!res.error) router.refresh()
    return res
  }

  async function saveNote(row: Row, note: string): Promise<SaveResult> {
    if (row.unsaved) return patchPending(row.slot, { note })
    const res = await setFontSlotMetaAction(artistId, row.slot, { note })
    if (!res.error) router.refresh()
    return res
  }

  async function removeRow(row: Row) {
    // Nothing of an unsaved row is in the database, so there is nothing to ask about.
    if (row.unsaved) return setPending((ps) => ps.filter((p) => p.slot !== row.slot))
    if (!(await ask(`Remove ${row.title}? The font stays in your list.`, { action: 'Remove' }))) return
    await run(() => clearCustomFontSlotAction(artistId, row.slot), 'Couldn’t remove that row.')
  }

  function add(name: string) {
    if (!freeSlot) return
    setPending((ps) => [...ps, { slot: freeSlot, title: name, note: '', font: null, saved: false }])
    setFocusSlot(freeSlot)
  }

  return (
    <>
      {/* Safe to inject: fontFaceCss re-sanitizes every family and drops unsafe URLs. */}
      {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
      <LedgerSection label="Fonts">
        {rows.map((row) => (
          <FontRow
            key={row.slot}
            row={row}
            fonts={fonts}
            autoFocusNote={row.unsaved && focusSlot === row.slot}
            menuOpen={menuFor === row.slot}
            onToggleMenu={() => setMenuFor((s) => (s === row.slot ? null : row.slot))}
            onCloseMenu={() => setMenuFor(null)}
            onPick={(font) => void pick(row, font)}
            onGoogle={() => openGoogle(row)}
            onUpload={() => openUpload(row)}
            onRemoveFont={(font) => void removeFont(font)}
            onRenameFont={renameFont}
            onPreview={() => row.font && setPreviewing({ title: row.title, font: row.font })}
            onRename={(label) => rename(row, label)}
            onNote={(note) => saveNote(row, note)}
            onDelete={() => void removeRow(row)}
          />
        ))}
        {freeSlot ? <AddRow noun="font" onAdd={add} placeholder="Display" /> : null}
      </LedgerSection>
      {uploading ? (
        <FontUploadDialog
          artistId={artistId}
          slot={uploading.slot}
          title={uploading.title}
          meta={uploading.meta}
          onClose={() => setUploading(null)}
          onPlaced={() => patchPending(uploading.slot, { saved: true })}
        />
      ) : null}
      {googleFor ? (
        <GoogleFontPicker
          title={googleFor.title}
          current={googleFor.font?.source === 'google' ? googleFor.font.googleFamily : null}
          onPick={(family) => void pickGoogle(googleFor, family)}
          onClose={() => setGoogleFor(null)}
        />
      ) : null}
      {previewing ? <FontPreview title={previewing.title} font={previewing.font} onClose={() => setPreviewing(null)} /> : null}
      {dialog}
    </>
  )
}

/** The weight under the title/note, and a red "no Bold" when the file is lighter than
 *  Semi Bold (browsers fake bold over it). Unknown weight says nothing — never a guess. */
function WeightLine({ weight }: { weight: number | null }) {
  if (weight == null) return null
  return (
    <>
      {weightName(weight)}
      {weight < BOLD_FROM ? <b className="font-normal text-accent-red"> · no Bold</b> : null}
    </>
  )
}

function FontRow({
  row,
  fonts,
  autoFocusNote,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onPick,
  onGoogle,
  onUpload,
  onRemoveFont,
  onRenameFont,
  onPreview,
  onRename,
  onNote,
  onDelete,
}: {
  row: Row
  fonts: BrandFont[]
  autoFocusNote: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onCloseMenu: () => void
  onPick: (font: BrandFont) => void
  onGoogle: () => void
  onUpload: () => void
  onRemoveFont: (font: BrandFont) => void
  onRenameFont: (font: BrandFont, label: string) => Promise<SaveResult>
  onPreview: () => void
  onRename: (label: string) => Promise<SaveResult>
  onNote: (note: string) => Promise<SaveResult>
  onDelete: () => void
}) {
  /** The chevrons, or the empty row's + — where the note's Enter sends focus. */
  const trigger = useRef<HTMLButtonElement>(null)
  const { font } = row
  const words = row.guide
    ? { guide: row.guide }
    : { note: { value: row.note, onSave: onNote, primaryRef: font ? undefined : trigger, autoFocus: autoFocusNote } }

  return (
    <LedgerRow
      title={row.title}
      onRename={row.guide ? undefined : onRename}
      meta={font ? font.source === 'google' ? 'Google Fonts' : <WeightLine weight={font.weight} /> : undefined}
      {...words}
      // An added row's trash, in the row's end slot so every row's sample lines up.
      remove={row.guide ? undefined : <RowIcon icon="trash" label="Remove" tone="danger" onClick={onDelete} />}
    >
      {font ? (
        <FontSample family={font.family} googleFamily={font.googleFamily} className="min-w-0 truncate whitespace-nowrap tracking-[-0.005em] text-ink">
          {font.label}
        </FontSample>
      ) : (
        <span className="whitespace-nowrap text-[14px] text-ink-faint">No font yet</span>
      )}
      <div className="relative flex-none">
        <RowIcon
          ref={trigger}
          icon={font ? 'chevronsUpDown' : 'plus'}
          label={font ? 'Change font' : 'Add font'}
          variant={font ? 'faint' : 'primary'}
          onClick={onToggleMenu}
          // Its own hover label is hidden while its menu is open: the menu opens beside it
          // and covered the label's first letters ("hange font"), and an open menu has
          // already answered what the control does. The label is RowIcon's [data-side] child.
          className={menuOpen ? '[&>[data-side]]:hidden' : undefined}
        />
        {menuOpen ? (
          <FontMenu
            fonts={fonts}
            currentId={font?.id ?? null}
            anchor={trigger}
            onPick={onPick}
            onGoogle={onGoogle}
            onUpload={onUpload}
            onRemove={onRemoveFont}
            onRename={onRenameFont}
            onClose={onCloseMenu}
          />
        ) : null}
      </div>
      {font ? <RowIcon icon="eye" label="Preview" onClick={onPreview} /> : null}
    </LedgerRow>
  )
}
