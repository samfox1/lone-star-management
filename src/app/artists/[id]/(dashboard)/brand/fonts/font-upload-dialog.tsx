'use client'

import { useEffect, useRef, useState } from 'react'
import { FONT_FOLDER, FONTS_BUCKET, isReservedFamily, slugify, type FontSlot, type FontSlotMeta } from '@/lib/fonts'
import { sniffFontWeight } from '@/lib/font-weight'
import { FONT_UPLOAD_RULES, acceptFor } from '@/lib/upload'
import { SelectMenu } from '../../modal-kit'
import { toast } from '../../toast'
import { UploadField } from '../../upload-field'
import { BrandModal } from '../_ui/brand-modal'
import { addArtistFontAction } from '../actions'
import { WEIGHT_CHOICES } from './face'

/** What the weight question starts on: the weight most single-file fonts are. */
const DEFAULT_WEIGHT = '400'

/**
 * "UPLOAD A FONT…" (BRAND_PAGE_PLAN.md, Fonts). Name first, then the file, and the file
 * goes straight into the row it was opened from (`slot`, plus an added row's title and
 * note in `meta` — the row is saved by this upload, in the same write).
 *
 * NAME FIRST because the CSS family token is derived from it once and never changes. A
 * RESERVED name ("Bold", "Primary") is refused here, before anything is sent: the server
 * refuses it too, but by then the upload hook has turned its sentence into a generic
 * "Couldn't upload that font".
 *
 * THE WEIGHT is read from the FILE (OS/2 usWeightClass, `sniffFontWeight`) for ttf/otf/
 * woff. A woff2 cannot be read without a Brotli decoder, so the dialog asks — and the row
 * is not written until it is answered. The question sits inside `writeRow`, after the
 * object is in the bucket: UploadField owns the file from pick to storage (the compression
 * gate rides that seam), so this is the first moment the bytes are in hand. Closing the
 * dialog at the question keeps the font with the weight unknown; the file is already
 * uploaded and chosen, and the weight only informs the row's "no Bold" line. A file that
 * says a weight outside 100–900 is asked about too (`usableWeight` reads it as unknown).
 *
 * CLOSED MID-UPLOAD (Save, ×, Escape while the file is still going up). The upload does not
 * stop with the dialog: the object lands and `writeRow` runs with nobody to ask. Rather than
 * block the close — UploadField does not say when an upload starts or fails, so a guard
 * would guess, and a wrong guess traps the manager in the dialog — a question that can no
 * longer be asked is answered "unknown" at once, and a toast says the weight was not set.
 * Before this it waited on the question forever: no row, the file orphaned in the bucket,
 * and nothing said.
 *
 * A CLOSED DIALOG HAS GIVEN UP ITS ROW (review 2, 2026-09-24). The late font is kept — in
 * the library, where the Change menu offers it — but placed nowhere: by then the manager
 * may have picked another font for that row, or dropped the unsaved row it was for, and a
 * late placement overwrote that with nothing on screen. Nor does its success close
 * anything: `onSuccess` is captured when the upload starts, and wired straight to onClose
 * it closed whatever dialog the ledger showed by then — another row's.
 *
 * The licence line lives HERE — the one moment it matters — and nowhere on the page.
 */
export function FontUploadDialog({
  artistId,
  slot,
  title,
  meta,
  onClose,
  onPlaced,
}: {
  artistId: string
  /** The row it was opened from: the upload fills this slot. */
  slot: FontSlot
  /** That row's title, under the dialog's. */
  title: string
  /** An unsaved added row's title + note, saved with its font. */
  meta?: FontSlotMeta
  onClose: () => void
  /** The font was saved AND placed in `slot`. */
  onPlaced?: () => void
}) {
  const [label, setLabel] = useState('')
  const named = label.trim()
  const reserved = named !== '' && isReservedFamily(slugify(named))
  const [asking, setAsking] = useState(false)
  const [weight, setWeight] = useState(DEFAULT_WEIGHT)
  /** The pending question's answer. A ref: `writeRow` awaits it across renders. */
  const answer = useRef<((w: number | null) => void) | null>(null)
  /** The dialog is closed or gone: nobody left to ask, no row to place in, nothing of its own
   *  to close (see "Closed mid-upload" above). Set as the manager closes it, before the
   *  unmount, so an answer that settles in between already sees it. */
  const gone = useRef(false)

  // Leaving with the question up answers it "unknown" — an await that never settles is an
  // upload stuck on busy with its object in the bucket and no row. And a question asked
  // AFTER leaving (the upload was still going) is answered the same way, at once.
  useEffect(() => {
    const pending = answer
    gone.current = false // a remount (StrictMode) is a dialog again
    return () => {
      gone.current = true
      pending.current?.(null)
      pending.current = null
    }
  }, [])

  function settle(w: number | null) {
    const resolve = answer.current
    answer.current = null
    setAsking(false)
    resolve?.(w)
  }

  function close() {
    gone.current = true
    settle(null)
    onClose()
  }

  function askWeight(): Promise<number | null> {
    if (gone.current) return Promise.resolve(null)
    return new Promise((resolve) => {
      answer.current = resolve
      setWeight(DEFAULT_WEIGHT)
      setAsking(true)
    })
  }

  async function writeRow(path: string, file: File): Promise<string | null> {
    const format = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
    let known: number | null
    try {
      known = await sniffFontWeight(await file.arrayBuffer())
    } catch {
      known = null
    }
    const w = known ?? (await askWeight())
    const input = { label: named, storagePath: path, format, weight: w }
    // Closed by now: the font goes to the library only (see "A closed dialog…" above).
    const place = !gone.current
    const res = !place
      ? await addArtistFontAction(artistId, input)
      : meta
        ? await addArtistFontAction(artistId, input, slot, meta)
        : await addArtistFontAction(artistId, input, slot)
    // A warning is a font that exists but did not land in the row: say so, keep the file
    // (an error here would make the upload delete an object a row still names).
    if (res.warning) toast(res.warning, 'error')
    if (res.error) return res.error
    if (place && !res.warning) onPlaced?.()
    // The file could not say its weight and nobody answered for it (the dialog was closed
    // at the question, or before it could be asked): the row will show no weight line.
    if (w === null) toast(`${named} was saved without its weight.`)
    return null
  }

  return (
    <BrandModal label="Upload a font" meta={title} onClose={close} onSave={() => (asking ? settle(Number(weight)) : close())}>
      <label className="flex flex-col gap-1">
        <span className="font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">Name</span>
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="Font name"
          maxLength={80}
          disabled={asking}
          spellCheck={false}
          className="h-8 border-b border-hairline bg-transparent text-[15px] leading-8 outline-none focus:border-ink disabled:opacity-60"
        />
      </label>
      {reserved ? <p className="-mt-3 text-[13px] text-accent-red">{`“${named}” is a reserved name. Try another.`}</p> : null}
      {/* The explicit allowlist, never a wildcard: an SVG font is a script vector on a public bucket. */}
      <UploadField
        accept={acceptFor(FONT_UPLOAD_RULES)}
        label={named && !reserved ? `Upload ${named}` : 'Name the font first'}
        disabled={!named || reserved || asking}
        kind="font"
        bucket={FONTS_BUCKET}
        artistId={artistId}
        category={FONT_FOLDER}
        noun="font"
        rules={FONT_UPLOAD_RULES}
        successMessage="Font uploaded"
        writeRow={writeRow}
        // Only while this dialog is still open: a late success is not its to close.
        onSuccess={() => {
          if (!gone.current) onClose()
        }}
      />
      {asking ? (
        <div className="flex items-center gap-4">
          <span className="w-[72px] flex-none font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">Weight</span>
          <SelectMenu label="Weight" value={weight} options={WEIGHT_CHOICES} required onChange={setWeight} />
        </div>
      ) : null}
      <p className="font-space text-[10.5px] leading-relaxed text-ink-faint">
        You are responsible for holding a licence to use this font on a public website.
      </p>
    </BrandModal>
  )
}
