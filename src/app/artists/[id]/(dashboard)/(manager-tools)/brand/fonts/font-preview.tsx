'use client'

import { useEffect, useState } from 'react'
import type { BrandFont } from '@/lib/fonts'
import { weightName } from '@/lib/font-weight'
import { googleWeights, loadGoogleFonts } from '@/lib/google-fonts'
import { FOCUS_RING } from '../../_ui/focus-ring'
import { BrandModal } from '../_ui/brand-modal'
import { previewStartWeight } from './face'
import { useSampleStyle } from './font-sample'

/**
 * The real upright weights of a Google font, from the bundled catalogue (a dynamic import,
 * read only when a Google font's preview opens), or [] — for an upload, or a family the
 * catalogue does not hold. The ledger's Google stylesheet already requests every weight
 * (the bridge's `googleFontsHref`), so each one offered here is drawn from a real file.
 */
function useRealWeights(font: BrandFont): number[] {
  const [weights, setWeights] = useState<number[]>([])
  const family = font.source === 'google' ? font.googleFamily : null
  useEffect(() => {
    if (!family) return
    let live = true
    loadGoogleFonts().then((rows) => {
      if (live) setWeights(googleWeights(rows, family))
    })
    return () => {
      live = false
    }
  }, [family])
  return family ? weights : []
}

/**
 * THE EYE (BRAND_PAGE_PLAN.md, Fonts): the row's font on a stage — "Test", editable, so
 * the manager can type their own words — with the font's name above it. Trying words
 * saves nothing; Save just closes.
 *
 * THE WEIGHT TOGGLE (Sam, 2026-09-28: "all real weights, but only on the preview, via
 * toggle"): a Google font offers exactly the upright weights Google has for it, starting at
 * Regular (or the nearest it has). An upload offers none and stays at the NORMAL weight: its
 * @font-face declares no weight, so anything heavier is the browser faking bold over the
 * file, which is exactly what the row's "no Bold" warns about. The ledger rows are untouched.
 */
export function FontPreview({ title, font, onClose }: { title: string; font: BrandFont; onClose: () => void }) {
  const sample = useSampleStyle(font.family, 23, 32, font.googleFamily)
  const weights = useRealWeights(font)
  const [picked, setPicked] = useState<number | null>(null)
  // Until the manager picks, the start follows the weights as they load.
  const weight = picked !== null && weights.includes(picked) ? picked : previewStartWeight(weights)
  return (
    <BrandModal label={title} meta="preview" onClose={onClose}>
      <figure className="m-0 flex flex-col items-center gap-2">
        {/* The name ABOVE the stage (Sam, 2026-09-28); the weights sit under it. */}
        <figcaption className="font-space text-[12px] text-ink-muted">{font.label}</figcaption>
        <div
          role="textbox"
          aria-label="Sample"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          style={{ ...sample, fontWeight: weight }}
          className="grid min-h-[160px] w-[520px] max-w-full place-items-center whitespace-pre-wrap break-words rounded-xl bg-surface px-7 text-center leading-tight tracking-[-0.02em] text-ink outline-none"
        >
          Test
        </div>
        {weights.length > 1 ? (
          <div role="group" aria-label="Weight" className="flex max-w-[520px] flex-wrap justify-center gap-x-3 gap-y-1">
            {weights.map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={w === weight}
                onClick={() => setPicked(w)}
                // The current one bold black, as a Settings sub-tab (never the accent).
                className={`rounded-sm px-0.5 text-[12px] ${FOCUS_RING} ${w === weight ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink'}`}
              >
                {weightName(w)}
              </button>
            ))}
          </div>
        ) : null}
      </figure>
    </BrandModal>
  )
}
