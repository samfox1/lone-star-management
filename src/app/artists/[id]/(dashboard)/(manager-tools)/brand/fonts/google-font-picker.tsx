'use client'

import { useDeferredValue, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '@/lib/cx'
import {
  CATEGORY_LABEL,
  googlePreviewHref,
  loadGoogleFonts,
  searchGoogleFonts,
  type GoogleFontRow,
} from '@/lib/google-fonts'
import { FOCUS_RING } from '../../_ui/focus-ring'
import { BrandModal } from '../_ui/brand-modal'
import { FontSample } from './font-sample'

/** How many families the list shows at once. The search narrows the rest; each shown row
 *  costs its font file, so the list stays short. */
export const GOOGLE_LIST_MAX = 60

/**
 * "GOOGLE FONTS…" (BRAND_SYNC_PLAN.md, Sam 2026-09-24: "pick any Google family by name").
 * A search field and the matching families, each shown in its own face, most popular first;
 * a click picks one for the row it was opened from, and the dialog closes. Enter in the
 * field picks the top match.
 *
 * The catalogue is the bundled list (lib/google-fonts.ts), loaded when this opens. The rows
 * on screen are drawn in their faces through ONE css2 stylesheet (regular weight only):
 * declaring a face downloads nothing, so only the families actually shown cost a file.
 *
 * It only REPORTS the pick — adding the font and placing it is the ledger's, like the
 * Change menu's. The family the row already holds is marked, and picking it again is the
 * ledger's "not a change".
 */
export function GoogleFontPicker({
  title,
  current,
  onPick,
  onClose,
}: {
  /** The row it was opened for — the dialog's title. */
  title: string
  /** The Google family the row holds now, if any. */
  current: string | null
  onPick: (family: string) => void
  onClose: () => void
}) {
  const [rows, setRows] = useState<GoogleFontRow[] | null>(null)
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    loadGoogleFonts().then(
      (all) => live && setRows(all),
      () => live && setRows([]),
    )
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    field.current?.focus()
  }, [])

  const shown = rows ? searchGoogleFonts(rows, deferred, GOOGLE_LIST_MAX) : []
  const href = googlePreviewHref(shown.map(([family]) => family))

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    // The list may lag the field by a frame (useDeferredValue); Enter means what was TYPED.
    const [top] = rows ? searchGoogleFonts(rows, query, 1) : []
    if (top) onPick(top[0])
  }

  return (
    <BrandModal label="Google Fonts" meta={title} onClose={onClose}>
      {href ? <link rel="stylesheet" href={href} /> : null}
      <input
        ref={field}
        type="search"
        aria-label="Search Google Fonts"
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded-lg border border-hairline bg-paper px-3 py-2 font-ui text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-ink"
      />
      <ul aria-label="Google Fonts" className="m-0 -mx-2 max-h-[min(420px,calc(100dvh-260px))] list-none overflow-auto p-0">
        {shown.map(([family, category]) => {
          const on = family === current
          return (
            <li key={family}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onPick(family)}
                className={cx(
                  'flex w-full items-baseline justify-between gap-4 rounded-lg px-2 py-2 text-left text-ink hover:bg-surface-hover',
                  FOCUS_RING,
                )}
              >
                {/* Sized by measured capital height like every Brand sample (FontSample), so a
                    short-capped face is not "super small"; faceOf re-checks the name. */}
                <FontSample family={family} googleFamily={family} cap={13} fallback={18} className={cx('min-w-0 truncate leading-tight', on && 'font-bold')}>
                  {family}
                </FontSample>
                <span className="flex-none font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                  {CATEGORY_LABEL[category]}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {rows && !shown.length ? <p className="m-0 text-[13px] text-ink-muted">No Google font by that name.</p> : null}
    </BrandModal>
  )
}
