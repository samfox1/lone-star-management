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
import { Icon } from '@/components/ui/icons'
import { inputClass } from '@/components/ui/ui'
import { FileDropField } from '../file-drop-field'
import { toast } from '../toast'
import { useStorageUpload } from '../use-storage-upload'
import { addArtistFontAction, removeArtistFontAction, setFontSlotAction } from './actions'

/** The manager-facing spelling of a slot. DERIVED from the slot name, so a sixth slot
 *  gets a label without anyone remembering to add one — a hand-written map would render
 *  `undefined` on the button for the slot nobody updated. */
const slotLabel = (slot: FontSlot) => slot.replace(/_/g, ' ')

/**
 * The artist's uploaded fonts.
 *
 * EVERY FONT IS PREVIEWED IN ITSELF. That is the entire point of the page: a list of
 * filenames tells a manager nothing about whether the face is right, and they cannot
 * "just look at the site" because a font is draft until it is published. So the component
 * injects the same `@font-face` CSS the public site will get and renders each row in its
 * own family — what you see here is literally what the site will be typeset in.
 *
 * The name is asked for BEFORE the file, not after. The name is what the CSS family token
 * is derived from, and that token is stored verbatim in every per-region style row that
 * uses it — so it is fixed at upload and there is no rename. Asking first makes that
 * one-way door visible instead of surprising.
 */
export function FontManager({ artistId, fonts }: { artistId: string; fonts: ArtistFont[] }) {
  const [label, setLabel] = useState('')
  /** Which row is mid-write, for the disabled/label state. NOT the re-entry guard. */
  const [busyId, setBusyId] = useState<string | null>(null)
  /**
   * The actual re-entry latch. `busyId` is state: two fast clicks both read the value
   * from before the re-render and both fire, so a double-clicked Remove deletes a font
   * and then reports "that font is no longer there" for the second call. A ref updates
   * synchronously.
   */
  const busyRef = useRef(false)

  const named = label.trim()

  const { busy, error, upload } = useStorageUpload({
    bucket: FONTS_BUCKET,
    artistId,
    category: FONT_FOLDER,
    noun: 'font',
    rules: FONT_UPLOAD_RULES,
    successMessage: 'Font uploaded',
    writeRow: async (path, file) => {
      const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
      return (await addArtistFontAction(artistId, { label: named, storagePath: path, format: ext })).error ?? null
    },
    onSuccess: () => setLabel(''),
  })

  /** One writer for both row actions, so the latch and the toasts cannot drift apart. */
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
      // In `finally` so one transient failure doesn't leave the list permanently dead.
      busyRef.current = false
      setBusyId(null)
    }
  }

  function remove(font: ArtistFont) {
    // There is no undo and no trash, and any region already styled with this font falls
    // back to the template face the moment it goes.
    if (!window.confirm(`Remove ${font.label}? Anything using it falls back to the template font.`)) return
    void run(font.id, () => removeArtistFontAction(artistId, font.id), 'Font removed')
  }

  /**
   * Put this font in a slot, or take it out of one.
   *
   * A font may hold SEVERAL slots at once (one typeface for headings and body is the
   * ordinary case), so this toggles one slot at a time and never touches the others.
   */
  function assign(font: ArtistFont, slot: FontSlot) {
    const clearing = font.slots.includes(slot)
    const incumbent = fonts.find((f) => f.slots.includes(slot) && f.id !== font.id)
    const name = slotLabel(slot)
    // Taking a slot off another font is a site-wide typeface change made by clicking one
    // small button, and the button gives no hint that a second font is about to lose it.
    if (!clearing && incumbent && !window.confirm(`${incumbent.label} is the ${name} font. Use ${font.label} instead?`))
      return
    void run(
      font.id,
      () => setFontSlotAction(artistId, slot, clearing ? null : font.id),
      clearing ? `${font.label} is no longer the ${name} font` : `${font.label} is now the ${name} font`,
    )
  }

  return (
    <div className="space-y-4">
      {/* The same stylesheet the published site gets, so the previews below are the real
          faces rather than a guess. Safe to inject: every value in it has been through
          sanitizeFamily or is a known-safe enum (see lib/fonts.ts). */}
      <style dangerouslySetInnerHTML={{ __html: fontFaceCss(fonts.map((f) => ({ ...f, path: f.storage_path }))) }} />

      {fonts.length > 0 && (
        <ul className="divide-y divide-hairline rounded-xl border border-hairline">
          {fonts.map((font) => {
            const rowBusy = busyId === font.id
            return (
              <li key={font.id} className="px-4 py-3">
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-[19px] leading-tight text-ink"
                      style={{ fontFamily: `'${sanitizeFamily(font.family)}', sans-serif` }}
                    >
                      {font.label}
                    </p>
                    <p className="mt-0.5 font-space text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                      {font.format} &middot; font-{sanitizeFamily(font.family)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(font)}
                    disabled={rowBusy}
                    aria-label={`Remove ${font.label}`}
                    className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-danger-soft hover:text-accent-red disabled:opacity-50"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>

                {/* One chip per slot, DERIVED from FONT_SLOTS — a new slot appears here
                    without an edit, and cannot be silently missing from the one place a
                    manager can fill it. Pressed chips are how the list answers "which
                    slots does this font fill", and a font may fill several. */}
                <div className="mt-2 flex flex-wrap gap-1.5">
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
                          'rounded-lg border px-2.5 py-1 font-space text-[11px] uppercase tracking-[0.08em] transition-colors disabled:opacity-50',
                          held
                            ? 'border-ink bg-ink text-white'
                            : 'border-hairline text-ink-muted hover:border-ink-faint hover:text-ink',
                        )}
                      >
                        {slotLabel(slot)}
                      </button>
                    )
                  })}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <label className="block">
        <span className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">Font name</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="PP Mori"
          aria-label="Font name"
          maxLength={80}
          className={cx(inputClass, 'mt-1.5 w-full max-w-xs')}
        />
      </label>

      {/* The explicit allowlist, never a wildcard: the picker must not advertise what
          validateUpload refuses, and an SVG font is a script vector on a public bucket. */}
      <FileDropField
        accept={acceptFor(FONT_UPLOAD_RULES)}
        label={named ? `Upload ${named}` : 'Name the font first'}
        hint="WOFF2, WOFF, TTF or OTF, up to 2 MB. WOFF2 loads fastest."
        busy={busy}
        error={error}
        disabled={!named}
        onFile={upload}
      />

      <p className="font-space text-xs leading-relaxed text-ink-faint">
        You are responsible for holding a licence to use these fonts on a public website.
        Most foundry licences are sold per use, and a desktop licence does not cover a
        website.
      </p>
    </div>
  )
}
