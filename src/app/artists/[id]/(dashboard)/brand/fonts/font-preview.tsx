'use client'

import type { BrandFont } from '@/lib/fonts'
import { BrandModal } from '../_ui/brand-modal'
import { useSampleStyle } from './font-sample'

/**
 * THE EYE (BRAND_PAGE_PLAN.md, Fonts): the row's font on a stage — "Test", editable, so
 * the manager can type their own words — with the font's name under it. Trying words
 * saves nothing; Save just closes.
 *
 * Set at the NORMAL weight on purpose: an uploaded @font-face declares no weight, so
 * anything heavier is the browser faking bold over the file, which is exactly what the
 * row's "no Bold" warns about. The stage shows the face as it was drawn.
 */
export function FontPreview({ title, font, onClose }: { title: string; font: BrandFont; onClose: () => void }) {
  const sample = useSampleStyle(font.family, 23, 32)
  return (
    <BrandModal label={title} meta="preview" onClose={onClose}>
      <figure className="m-0 flex flex-col items-center gap-2">
        <div
          role="textbox"
          aria-label="Sample"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          style={sample}
          className="grid min-h-[160px] w-[520px] max-w-full place-items-center whitespace-pre-wrap break-words rounded-xl bg-surface px-7 text-center font-normal leading-tight tracking-[-0.02em] text-ink outline-none"
        >
          Test
        </div>
        <figcaption className="font-space text-[12px] text-ink-muted">{font.label}</figcaption>
      </figure>
    </BrandModal>
  )
}
