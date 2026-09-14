'use client'

import { useEffect, useRef, useState } from 'react'
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
import { useConfirm } from '../confirm-dialog'
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
    <div className="flex flex-col gap-0.5">
      {/* Safe to inject: every value has been through sanitizeFamily or is a known enum. */}
      <style dangerouslySetInnerHTML={{ __html: fontFaceCss(fonts.map((f) => ({ ...f, path: f.storage_path }))) }} />

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

      <button type="button" onClick={() => setAdding(true)} className="mt-1 inline-flex w-fit items-center gap-1 py-1 text-[15px] text-ink-muted transition-colors hover:text-ink">
        <Icon name="plus" size={13} /> Font
      </button>

      {adding && <AddFontDialog artistId={artistId} onClose={() => setAdding(false)} />}
      {dialog}
    </div>
  )
}

/** Name first, then the file. The licence line lives HERE — the one moment it matters —
 *  and nowhere on the page. */
function AddFontDialog({ artistId, onClose }: { artistId: string; onClose: () => void }) {
  const [label, setLabel] = useState('')
  const named = label.trim()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Add a font" className="w-[440px] max-w-full rounded-2xl bg-paper p-6 shadow-2xl">
        <div className="flex justify-end">
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink">
            <Icon name="close" size={16} />
          </button>
        </div>
        <label className="mt-1 flex flex-col gap-1">
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
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className={buttonClass('confirm', 'min-w-[88px] justify-center')}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
