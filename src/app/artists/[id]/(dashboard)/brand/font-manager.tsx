'use client'

import { useRef, useState } from 'react'
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

/**
 * The artist's fonts, as ROWS (Sam, 2026-09-13): the name set in its own face, the
 * format, the five slot chips, and a bare bin at the end. "+ Font" is the last row and
 * opens a small dialog — name first, then the file — so the page itself carries no form
 * and no captions.
 *
 * EVERY FONT IS PREVIEWED IN ITSELF: the component injects the same `@font-face` CSS the
 * public site gets and sets each row in its own family, because a font is draft until
 * published and a filename tells a manager nothing.
 *
 * The name is asked for BEFORE the file. The CSS family token derives from it and is
 * stored verbatim in every per-region style row that uses it, so it is fixed at upload;
 * asking first makes that one-way door visible instead of surprising.
 */
export function FontManager({ artistId, fonts }: { artistId: string; fonts: ArtistFont[] }) {
  const { ask, dialog } = useConfirm()
  const [adding, setAdding] = useState(false)
  /** The font whose preview is open. */
  const [previewing, setPreviewing] = useState<ArtistFont | null>(null)
  /** Which row is mid-write, for the disabled state. NOT the re-entry guard. */
  const [busyId, setBusyId] = useState<string | null>(null)
  /** The re-entry latch — a ref, because two fast clicks both read stale state. */
  const busyRef = useRef(false)

  async function run(id: string, work: () => Promise<{ error?: string }>, done: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusyId(id)
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
      setBusyId(null)
    }
  }

  async function remove(font: ArtistFont) {
    if (!(await ask(`Remove ${font.label}? Anything using it falls back to the template font.`, { action: 'Remove' }))) return
    void run(font.id, () => removeArtistFontAction(artistId, font.id), 'Font removed')
  }

  /** Put this font in a slot, or take it out of one. A font may hold several slots. */
  async function assign(font: ArtistFont, slot: FontSlot) {
    const clearing = font.slots.includes(slot)
    const incumbent = fonts.find((f) => f.slots.includes(slot) && f.id !== font.id)
    const name = slotLabel(slot)
    if (!clearing && incumbent && !(await ask(`${incumbent.label} is the ${name} font. Use ${font.label} instead?`, { action: 'Use it', tone: 'solid' })))
      return
    void run(
      font.id,
      () => setFontSlotAction(artistId, slot, clearing ? null : font.id),
      clearing ? `${font.label} is no longer the ${name} font` : `${font.label} is now the ${name} font`,
    )
  }

  return (
    <div className="flex items-start gap-8">
      {/* Safe to inject: every value has been through sanitizeFamily or is a known enum. */}
      <style dangerouslySetInnerHTML={{ __html: fontFaceCss(fonts.map((f) => ({ ...f, path: f.storage_path }))) }} />

      <div className="flex flex-col gap-0.5">
      {fonts.map((font) => {
        const rowBusy = busyId === font.id
        return (
          <div key={font.id} className={cx('flex items-center gap-4 py-1.5', rowBusy && 'opacity-60')}>
            <span className="min-w-[120px] truncate text-[19px] leading-tight" style={{ fontFamily: `'${sanitizeFamily(font.family)}', sans-serif` }}>
              {font.label}
            </span>
            <span className="w-9 flex-none font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint" title={`font-${sanitizeFamily(font.family)}`}>
              {font.format}
            </span>
            {/* The eye: type anything, see it in this face (Sam, 2026-09-13). */}
            <button
              type="button"
              onClick={() => setPreviewing(font)}
              aria-label={`Preview ${font.label}`}
              className="flex h-5 w-5 flex-none items-center justify-center text-ink-faint transition-colors hover:text-ink"
            >
              <Icon name="eye" size={14} />
            </button>
            {/* Reads as a sentence: "Sorg_font · used as · Primary". A pressed chip is a slot
                this font fills; a font may fill several. */}
            <span className="ml-2 font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">used as</span>
            <span className="flex flex-wrap gap-1.5">
              {FONT_SLOTS.map((slot) => {
                const held = font.slots.includes(slot)
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => assign(font, slot)}
                    disabled={rowBusy}
                    aria-pressed={held}
                    aria-label={`${slotLabel(slot)} font: ${font.label}`}
                    className={cx(
                      'rounded-[7px] border px-2 py-1 font-space text-[10px] uppercase tracking-[0.06em] transition-colors disabled:opacity-50',
                      held ? 'border-ink bg-ink text-white' : 'border-hairline text-ink-muted hover:border-ink-faint hover:text-ink',
                    )}
                  >
                    {slotLabel(slot)}
                  </button>
                )
              })}
            </span>
            <button
              type="button"
              onClick={() => remove(font)}
              disabled={rowBusy}
              aria-label={`Remove ${font.label}`}
              className="flex h-5 w-5 flex-none items-center justify-center text-ink-faint transition-colors hover:text-accent-red disabled:opacity-50"
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        )
      })}

      </div>

      {/* At the far right of the fonts (Sam, 2026-09-13), level with the first row. */}
      <button type="button" onClick={() => setAdding(true)} className={buttonClass('ghost', 'flex-none')}>
        <Icon name="plus" size={12} /> Font
      </button>

      {adding && <AddFontDialog artistId={artistId} onClose={() => setAdding(false)} />}
      {previewing && <PreviewDialog font={previewing} onClose={() => setPreviewing(null)} />}
      {dialog}
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

/** Name first, then the file. The licence line lives HERE — the one moment it matters —
 *  and nowhere on the page. */
function AddFontDialog({ artistId, onClose }: { artistId: string; onClose: () => void }) {
  const [label, setLabel] = useState('')
  const named = label.trim()

  return (
    <CardModal open onClose={onClose} label="Add a font" footer={null}>
      {/* The formats the picker takes, as the meta line — the one fact a manager needs. */}
      <ModalHeader square={<FaceSquare family={null} faint />} title={named || 'Font'} meta={<span className="uppercase">{FONT_UPLOAD_RULES.allowedExt.join(' · ')}</span>} />
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
            return (await addArtistFontAction(artistId, { label: named, storagePath: path, format: ext })).error ?? null
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
  const family = `'${sanitizeFamily(font.family)}', sans-serif`

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
        {text || '\u00a0'}
      </p>
    </CardModal>
  )
}
