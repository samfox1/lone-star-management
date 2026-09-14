'use client'

import { useEffect, useId, useRef, useState } from 'react'
import {
  type ArtistFont,
  type FontSlot,
  FONT_FOLDER,
  FONT_SLOTS,
  FONTS_BUCKET,
  fontFaceCss,
  sanitizeFamily,
} from '@/lib/fonts'
import { FONT_UPLOAD_RULES, acceptFor } from '@/lib/upload'
import { cx } from '@/lib/cx'
import { CardModal } from '../card-modal'
import { useConfirm } from '../confirm-dialog'
import { ModalHeader } from '../modal-kit'
import { Icon } from '@/components/ui/icons'
import { buttonClass } from '@/components/ui/ui'
import { UploadField } from '../upload-field'
import { toast } from '../toast'
import { addArtistFontAction, removeArtistFontAction, setFontSlotAction } from './actions'

/** The manager-facing spelling of a slot. DERIVED from the slot name, so a sixth slot
 *  gets a label without anyone remembering to add one. */
const slotLabel = (slot: FontSlot) => slot.replace(/_/g, ' ')

/** The CSS the preview sets a font in — the sanitized token, never the raw family. */
const faceOf = (font: ArtistFont) => `'${sanitizeFamily(font.family)}', sans-serif`

/**
 * THE FONTS, SLOT-FIRST (Sam, 2026-09-13: "Each font (primary, secondary, custom, etc)
 * should be next to a selector or a + font where you can upload one or you can choose
 * from a list (with a search bar)… Each one should have a view").
 *
 * One row per slot: the KEY, then the font that fills it as a picker, then an eye. The
 * picker is the dashboard's own menu — a search line, every uploaded font set in itself,
 * "None", and "+ Font" at the foot, which uploads a new font INTO this slot. Fonts are
 * removed from inside the picker (the bin beside a font), because the list of fonts IS
 * the picker; there is no second list on the page.
 *
 * EVERY FONT IS SHOWN IN ITSELF: the component injects the same `@font-face` CSS the
 * public site gets, because a font is draft until published and a filename tells a
 * manager nothing. The eye opens a preview where any text is drawn in the face.
 */
export function FontManager({ artistId, fonts }: { artistId: string; fonts: ArtistFont[] }) {
  const { ask, dialog } = useConfirm()
  /** The slot an upload was started from, or null when the dialog is closed. */
  const [adding, setAdding] = useState<FontSlot | null>(null)
  const [previewing, setPreviewing] = useState<ArtistFont | null>(null)
  /** Which slot is mid-write, for the disabled state. NOT the re-entry guard. */
  const [busySlot, setBusySlot] = useState<string | null>(null)
  /** The re-entry latch — a ref, because two fast clicks both read stale state. */
  const busyRef = useRef(false)

  async function run(key: string, work: () => Promise<{ error?: string }>, done: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusySlot(key)
    try {
      const res = await work()
      if (res.error) {
        toast(res.error, 'error')
        return
      }
      toast(done)
    } catch {
      toast('Something went wrong. Try again.', 'error')
    } finally {
      busyRef.current = false
      setBusySlot(null)
    }
  }

  /** Fill a slot, or empty it (`null`). The row shows what it replaces, so no question. */
  function choose(slot: FontSlot, font: ArtistFont | null) {
    const name = slotLabel(slot)
    void run(slot, () => setFontSlotAction(artistId, slot, font?.id ?? null), font ? `${font.label} is now the ${name} font` : `No ${name} font`)
  }

  async function remove(font: ArtistFont) {
    if (!(await ask(`Remove ${font.label}? Anything using it falls back to the template font.`, { action: 'Remove' }))) return
    void run(font.id, () => removeArtistFontAction(artistId, font.id), 'Font removed')
  }

  return (
    <div className="flex flex-col gap-0.5">
      {/* Safe to inject: every value has been through sanitizeFamily or is a known enum. */}
      <style dangerouslySetInnerHTML={{ __html: fontFaceCss(fonts.map((f) => ({ ...f, path: f.storage_path }))) }} />

      {FONT_SLOTS.map((slot) => {
        const font = fonts.find((f) => f.slots.includes(slot)) ?? null
        const rowBusy = busySlot === slot
        return (
          <div key={slot} className={cx('flex h-8 items-center gap-4', rowBusy && 'opacity-60')}>
            <span className="w-[96px] flex-none font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">{slotLabel(slot)}</span>
            <FontPicker
              slot={slot}
              fonts={fonts}
              value={font}
              disabled={rowBusy}
              onChoose={(f) => choose(slot, f)}
              onRemove={remove}
              onAdd={() => setAdding(slot)}
            />
            {/* The eye (Sam, 2026-09-13): type anything, see it in this face. */}
            {font ? (
              <button
                type="button"
                onClick={() => setPreviewing(font)}
                aria-label={`Preview ${slotLabel(slot)} font`}
                className="flex h-5 w-5 flex-none items-center justify-center text-ink-faint transition-colors hover:text-ink"
              >
                <Icon name="eye" size={14} />
              </button>
            ) : null}
          </div>
        )
      })}

      {adding && <AddFontDialog artistId={artistId} slot={adding} onClose={() => setAdding(null)} />}
      {previewing && <PreviewDialog font={previewing} onClose={() => setPreviewing(null)} />}
      {dialog}
    </div>
  )
}

/**
 * The slot's picker: reads as the row's value with a chevron; opens the paper menu with
 * a search line, each font in its own face (a bin beside it), None, and + Font. The same
 * `combobox` / `listbox` / `option` roles SelectMenu uses, so it reads as a select.
 */
function FontPicker({
  slot,
  fonts,
  value,
  disabled,
  onChoose,
  onRemove,
  onAdd,
}: {
  slot: FontSlot
  fonts: ArtistFont[]
  value: ArtistFont | null
  disabled: boolean
  onChoose: (font: ArtistFont | null) => void
  onRemove: (font: ArtistFont) => void
  onAdd: () => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const listId = useId()
  const label = `${slotLabel(slot)} font`

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const toggle = () => {
    setQ('')
    setOpen((v) => !v)
  }
  const pick = (font: ArtistFont | null) => {
    setOpen(false)
    if ((font?.id ?? null) !== (value?.id ?? null)) onChoose(font)
  }
  const shown = fonts.filter((f) => f.label.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div ref={ref} className="relative w-[200px]">
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={toggle}
        className="flex h-8 w-full items-center gap-1.5 text-left leading-8 outline-none disabled:opacity-50"
      >
        {/* The value in its own face; the placeholder in the site's own mono, like every
            other empty value (Sam, 2026-09-14: "the correct font"). */}
        {value ? (
          <span className="min-w-0 flex-1 truncate text-[17px]" style={{ fontFamily: faceOf(value) }}>
            {value.label}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate font-space text-[11px] uppercase tracking-[0.12em] text-ink-faint">Choose</span>
        )}
        <Icon name="chevronRight" size={12} className={cx('flex-none rotate-90 text-ink-faint transition-transform', open && '-rotate-90')} />
      </button>
      {open && (
        <div id={listId} role="listbox" aria-label={label} className="absolute left-0 top-full z-20 mt-1 w-[260px] rounded-xl border border-hairline bg-paper shadow-2xl">
          {fonts.length > 1 ? (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search fonts"
              placeholder="Search"
              className="mx-3 mt-2 h-7 w-[calc(100%-24px)] border-b border-hairline bg-transparent font-space text-[12px] leading-7 outline-none placeholder:text-ink-faint focus:border-ink"
            />
          ) : null}
          <div className="max-h-64 overflow-auto py-1.5">
            {shown.map((font) => {
              const held = font.id === value?.id
              return (
                <div key={font.id} role="option" aria-selected={held} aria-label={font.label} className="group flex items-center gap-2 pl-3 pr-2 hover:bg-surface">
                  <button type="button" onClick={() => pick(font)} className={cx('flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left', held ? 'text-ink' : 'text-ink-muted')}>
                    <span className="min-w-0 flex-1 truncate text-[17px] leading-6" style={{ fontFamily: faceOf(font) }}>
                      {font.label}
                    </span>
                    <span className="flex-none font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint" title={`font-${sanitizeFamily(font.family)}`}>
                      {font.format}
                    </span>
                    {held ? <Icon name="check" size={13} className="flex-none" /> : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      onRemove(font)
                    }}
                    aria-label={`Remove ${font.label}`}
                    className="flex h-5 w-5 flex-none items-center justify-center text-ink-faint opacity-0 transition-[opacity,color] group-hover:opacity-100 hover:text-accent-red focus:opacity-100"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              )
            })}
            {value ? (
              <button type="button" role="option" aria-selected={false} onClick={() => pick(null)} className="flex w-full items-center px-3 py-1.5 text-left text-sm text-ink-faint hover:bg-surface">
                None
              </button>
            ) : null}
          </div>
          <div className="border-t border-hairline p-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onAdd()
              }}
              className={buttonClass('ghost', 'w-full justify-center')}
            >
              <Icon name="plus" size={12} /> Font
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The face's own square: "Aa" set in it, where cover art would stand. */
function FaceSquare({ family, faint = false }: { family: string | null; faint?: boolean }) {
  return (
    <div className={cx('flex h-full w-full items-center justify-center rounded-xl border border-hairline text-[22px] leading-none', faint && 'text-ink-faint')} style={family ? { fontFamily: family } : undefined}>
      Aa
    </div>
  )
}

/** Name first, then the file, and the file goes straight into `slot`. The licence line
 *  lives HERE — the one moment it matters — and nowhere on the page. */
function AddFontDialog({ artistId, slot, onClose }: { artistId: string; slot: FontSlot; onClose: () => void }) {
  const [label, setLabel] = useState('')
  const named = label.trim()

  return (
    <CardModal open onClose={onClose} label="Add a font" footer={null}>
      {/* The slot it goes into, and the formats the picker takes — the two facts a manager needs. */}
      <ModalHeader
        square={<FaceSquare family={null} faint />}
        title={named || 'Font'}
        meta={
          <>
            <span className="capitalize">{slotLabel(slot)}</span>
            <span className="uppercase">{FONT_UPLOAD_RULES.allowedExt.join(' · ')}</span>
          </>
        }
      />
      <label className="mt-7 flex flex-col gap-1">
        <span className="font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">Name</span>
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="Font name"
          maxLength={80}
          className="h-7 border-b border-hairline bg-transparent text-[15px] leading-7 outline-none focus:border-ink"
        />
      </label>
      <div className="mt-5">
        {/* The explicit allowlist, never a wildcard: an SVG font is a script vector on a public bucket. */}
        <UploadField
          accept={acceptFor(FONT_UPLOAD_RULES)}
          label={named ? `Upload ${named}` : 'Name the font first'}
          disabled={!named}
          kind="font"
          bucket={FONTS_BUCKET}
          artistId={artistId}
          category={FONT_FOLDER}
          noun="font"
          rules={FONT_UPLOAD_RULES}
          successMessage="Font uploaded"
          writeRow={async (path, file) => {
            const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
            return (await addArtistFontAction(artistId, { label: named, storagePath: path, format: ext }, slot)).error ?? null
          }}
          onSuccess={onClose}
        />
      </div>
      <p className="mt-4 font-space text-[10.5px] leading-relaxed text-ink-faint">
        You are responsible for holding a licence to use this font on a public website.
      </p>
      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onClose} className={buttonClass('confirm', 'min-w-[88px] justify-center')}>
          Cancel
        </button>
      </div>
    </CardModal>
  )
}

/**
 * The preview (Sam, 2026-09-13: "click like an eye icon to preview it and it allows the
 * user to type in whatever they want and it displays it as the font selected"). The
 * card header, one line to type in, and the same words drawn large in the face.
 */
function PreviewDialog({ font, onClose }: { font: ArtistFont; onClose: () => void }) {
  const [text, setText] = useState(font.label)
  const family = faceOf(font)

  return (
    <CardModal open onClose={onClose} label={`Preview ${font.label}`} footer={null}>
      <ModalHeader
        square={<FaceSquare family={family} />}
        title={<span style={{ fontFamily: family }}>{font.label}</span>}
        meta={
          <>
            <span className="uppercase">{font.format}</span>
            {font.slots.map((slot) => (
              <span key={slot} className="capitalize">{slotLabel(slot)}</span>
            ))}
          </>
        }
      />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Text to preview"
        className="mt-7 h-7 w-full border-b border-hairline bg-transparent font-space text-[13px] leading-7 outline-none focus:border-ink"
      />
      <p data-testid="font-sample" className="mt-6 min-h-[120px] break-words text-[44px] leading-[1.1] text-ink" style={{ fontFamily: family }}>
        {text || ' '}
      </p>
    </CardModal>
  )
}
