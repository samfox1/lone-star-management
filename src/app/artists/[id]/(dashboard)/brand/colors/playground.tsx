'use client'

import { useId, useState } from 'react'
import { contrastRatio, isReadable } from '@/lib/color'
import { cx } from '@/lib/cx'
import { BrandModal } from '../_ui/brand-modal'
import { HoverLabel } from '../_ui/row-icon'

/** A colour the playground can offer: every palette row that has one. */
export type PlayColor = { key: string; name: string; hex: string }

type Part = 'background' | 'text' | 'border' | 'accent'

/** The four parts, in the order the pickers stack. */
const PARTS: { part: Part; label: string }[] = [
  { part: 'background', label: 'Background' },
  { part: 'text', label: 'Text' },
  { part: 'border', label: 'Border' },
  { part: 'accent', label: 'Accent' },
]

/**
 * Where the parts start: the clicked colour is the Background; Text is the colour that
 * reads best on it and Border the next best, so the card opens readable when the palette
 * allows; Accent is the first other colour that isn't the Text. A palette of one colour
 * paints everything in it — and says it is hard to read, which it is.
 */
function startingParts(palette: PlayColor[], startKey: string): Record<Part, string> {
  const bg = palette.find((c) => c.key === startKey) ?? palette[0]
  const others = palette.filter((c) => c.key !== bg.key)
  const best = [...others].sort((a, b) => contrastRatio(b.hex, bg.hex) - contrastRatio(a.hex, bg.hex))
  const text = best[0] ?? bg
  const border = best[1] ?? text
  const accent = others.find((c) => c.key !== text.key) ?? text
  return { background: bg.key, text: text.key, border: border.key, accent: accent.key }
}

/**
 * THE COLOUR PLAYGROUND (Sam, 2026-09-23, BRAND_PAGE_PLAN.md): the eye on a colour row.
 * A sample card — an editable "Test" title, a line of text, a link, a Tickets button — and
 * beside it the four parts, each choosing from the artist's palette by name. It repaints
 * live. Under the parts, plain words: "Easy to read" or a red "Hard to read", for the TEXT
 * on the BACKGROUND at WCAG's 4.5:1. No numbers anywhere — the words are the answer.
 *
 * It is for trying combinations and saves nothing: Save only closes it.
 */
export function ColorPlayground({ palette, startKey, onClose }: { palette: PlayColor[]; startKey: string; onClose: () => void }) {
  const uid = useId()
  const [parts, setParts] = useState(() => startingParts(palette, startKey))
  const hexOf = (part: Part) => palette.find((c) => c.key === parts[part])?.hex ?? '#ffffff'
  const start = palette.find((c) => c.key === startKey) ?? palette[0]
  const readable = isReadable(hexOf('text'), hexOf('background'))

  return (
    <BrandModal
      label={start.name}
      meta="preview"
      square={<div className="h-full w-full" style={{ backgroundColor: start.hex }} />}
      onClose={onClose}
      board={
        <div
          data-sample-card=""
          style={{ backgroundColor: hexOf('background'), color: hexOf('text'), borderColor: hexOf('border') }}
          className="flex min-h-[190px] w-[300px] max-w-full flex-col gap-2.5 rounded-[14px] border-2 px-[22px] pb-6 pt-[22px]"
        >
          <div
            role="textbox"
            aria-label="Title"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            className="text-[28px] font-bold tracking-[-0.02em] outline-none"
          >
            Test
          </div>
          <p className="m-0 text-[14px] opacity-85">Live this weekend, doors early.</p>
          <span className="text-[14px] underline" style={{ color: hexOf('accent') }}>
            Listen now
          </span>
          <span
            className="mt-auto self-start rounded-[9px] px-3.5 py-2 text-[13px] font-semibold"
            style={{ backgroundColor: hexOf('accent'), color: hexOf('background') }}
          >
            Tickets
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        {PARTS.map(({ part, label }) => (
          <div key={part}>
            <span id={`${uid}-${part}`} className="mb-1.5 block font-space text-[11px] uppercase tracking-[0.08em] text-ink-faint">
              {label}
            </span>
            <div role="radiogroup" aria-labelledby={`${uid}-${part}`} className="flex flex-wrap gap-2">
              {palette.map((c) => {
                const on = parts[part] === c.key
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={c.name}
                    onClick={() => setParts((p) => ({ ...p, [part]: c.key }))}
                    style={{ backgroundColor: c.hex }}
                    className={cx(
                      'group/icon relative h-[26px] w-[26px] rounded-full border border-hairline',
                      // Picked: an ink ring, always. Otherwise a ring on keyboard focus. Each ring
                      // says `outline-solid` itself — Tailwind v4's `outline-hidden` would zero the
                      // style `outline-2` reads (tests/components/brand/focus-rings.test.tsx).
                      on
                        ? 'outline-solid outline-2 outline-offset-2 outline-ink'
                        : 'outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    )}
                  >
                    <HoverLabel label={c.name} side="top" />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        <p
          className={cx(
            'm-0 text-[13px]',
            readable ? "text-ink-muted before:content-['✓_']" : "text-accent-red before:content-['!_']",
          )}
        >
          {readable ? 'Easy to read' : 'Hard to read'}
        </p>
      </div>
    </BrandModal>
  )
}
