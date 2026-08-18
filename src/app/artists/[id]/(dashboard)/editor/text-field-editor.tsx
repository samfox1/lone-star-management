'use client'

import type { EditorStyleOptions } from '@/lib/site-editor/style-controls'
import { useState } from 'react'
import { cx } from '@/lib/cx'
import { siteSwatches } from '@/lib/site-editor/style-apply'
import { mergeStyle } from '@samfox1/site-bridge'
import {
  applyStyleValue,
  buildTextItemStyleControls,
  storableStyle,
} from '@/lib/site-editor/style-controls'
import { type EditorTextField } from './inspector-types'
import { FIELD, SaveLine, type SaveStatus } from './inspector-shared'
import { EditorPanel } from './editor-panel'
import { StyleControlRow } from './panels/style-tools'

/**
 * ONE text field, opened full-panel — the words and how they look, in one place.
 *
 * Shares `EditorPanel` (header, back, scroll body) with the image and video editors, so
 * "Edit" is the same gesture and the same shape everywhere in the inspector. It is not
 * `ItemEditor` itself because that one is built around swapping a MEDIA item — a
 * preview, Replace, Remove — and a sentence has none of those.
 *
 * The words save DEBOUNCED as they are typed (owned above, in `useTextFieldSave`).
 * Styling saves on change through the same hook the Style panel uses, so the two can
 * never disagree about what is stored.
 */
export function TextFieldEditor({
  field,
  value,
  status,
  styleValues,
  styleOptions,
  onEdit,
  onStyle,
  onBack,
}: {
  field: EditorTextField
  /** Live value, owned by the inspector so it survives opening and closing this editor. */
  value: string
  status: SaveStatus
  styleValues: Record<string, string>
  styleOptions?: EditorStyleOptions
  onEdit: (value: string) => void
  onStyle: (regionKey: string, className: string) => void
  onBack: () => void
}) {
  // Sliders for size and thickness, a select for font — shaped like the image and video
  // editors rather than the Style panel's menus, because this is the same gesture.
  const controls = buildTextItemStyleControls(styleOptions)

  // What the box SHOWS: the stored value, or — the first time an unset field is opened —
  // the site's own fallback, so the manager edits real words instead of retyping them.
  // Once the manager has touched the field, `value` is the only truth, including when
  // they clear it to empty (which must stay empty, not snap back).
  //
  // RE-SEEDED WHEN THE FIELD CHANGES, not merely latched at mount. This editor is NOT
  // remounted per field — a preview click swaps `field` on the same instance — so a
  // mount-only latch showed field B holding field A's default, and typing then saved A's
  // words under B's key (2026-08-09 review). Deriving from `field.key` here makes that
  // unexpressible however the parent renders us; the same shape the style staging below
  // already uses for its region.
  const [defaultSeed, setDefaultSeed] = useState(() => (value === '' ? (field.defaultValue ?? '') : ''))
  const [touched, setTouched] = useState(false)
  const [seededKey, setSeededKey] = useState(field.key)
  if (seededKey !== field.key) {
    setSeededKey(field.key)
    setDefaultSeed(value === '' ? (field.defaultValue ?? '') : '')
    setTouched(false)
  }
  const shown = touched || value !== '' ? value : defaultSeed
  const region = field.styleRegion

  // STAGED LOCALLY, like StyleTools and ItemEditor. Reading the class string straight
  // off `styleValues` made every control lag: the inspector only refreshes that map on a
  // 500ms debounce, so the text repainted at once while the slider thumb sat still and
  // then jumped — which reads as the drag being ignored, so the manager drags further
  // and overshoots. Worse, a second control read the STALE string and silently dropped
  // whatever the first had just set.
  //
  // Seeded from the prop, and re-seeded when the REGION changes (a different field is
  // opened) rather than on every prop change, so an in-flight drag is never clobbered by
  // the debounced write landing underneath it.
  // Seeded from the stored override if there is one, else the region's OWN BASE
  // CLASSES — never from ''. A section override REPLACES the base, so seeding empty
  // turns "set a size" into "delete every class this element had". That is not
  // theoretical: it wiped `fx-glitch-mono` off the hero wordmark, whose effect paints
  // the visible text, and the word disappeared from the site.
  // EFFECTIVE string, whichever era the stored row is from: mergeStyle applies a delta
  // over the base, passes a legacy full string through, and falls back to the base.
  const seed = (r: typeof region) => (r ? mergeStyle(r.key, r.base ?? '', styleValues[r.key] ?? '') : '')
  const [staged, setStaged] = useState(() => seed(region))
  const [seededFor, setSeededFor] = useState(region?.key ?? null)
  if (seededFor !== (region?.key ?? null)) {
    setSeededFor(region?.key ?? null)
    setStaged(seed(region))
  }
  const cls = staged

  return (
    <EditorPanel label={field.label} onBack={onBack}>
      {/* A style-only entry is a text AREA of the site — the words are written into the
          design, so there is nothing to type. It still gets the type controls below. */}
      {field.styleOnly ? (
        <p className="px-5 pt-3 font-space text-[11px] leading-snug text-ink-faint">
          This text is part of the site&apos;s design, so it can&apos;t be retyped here — but you
          can change how it looks.
        </p>
      ) : (
      <div className="px-5 pt-3">
        {/* SEEDED with the site's own words, not merely hinted at by a placeholder.
            A placeholder looked right and could not be edited: changing one word of a
            sentence already on the page meant retyping it from memory (Sam, 2026-08-09).

            Seeded for DISPLAY only — `onEdit` is not called, so opening a field writes
            nothing. Stamping defaults into site_content by browsing would make "unset"
            unreachable and freeze copy the site should still be free to change. */}
        {field.multiline ? (
          <textarea
            autoFocus
            value={shown}
            onChange={(e) => { setTouched(true); onEdit(e.target.value) }}
            aria-label={field.label}
            className={cx(FIELD, 'min-h-32 resize-y leading-relaxed')}
          />
        ) : (
          <input
            autoFocus
            type={field.type === 'email' ? 'email' : 'text'}
            value={shown}
            onChange={(e) => { setTouched(true); onEdit(e.target.value) }}
            aria-label={field.label}
            className={FIELD}
          />
        )}
      </div>
      )}

      <div className="mt-3 border-t border-hairline-soft px-5 pt-3">
        {region ? (
          // Controls only when the site declares a style region for this field. One that
          // writes to a key nothing renders is worse than none: the manager changes the
          // font, nothing happens, and no error explains it.
          <div className="space-y-0.5">
            {controls.map((control) => (
              <StyleControlRow
                key={control.id}
                regionLabel={field.label}
                control={control}
                cls={cls}
                swatches={siteSwatches(styleOptions, styleValues)}
                palette={styleOptions}
                onChange={(v) => {
                  // '' (Default) restores the BASE's own family token — applyStyleValue
                  // is base-aware now, which is what makes Default mean "the site's
                  // default" instead of "delete the property".
                  const next = applyStyleValue(cls, control, v, region.base ?? '')
                  setStaged(next) // the control moves NOW; the save follows
                  // Delta era: store only the changed families (an unchanged string
                  // diffs to '' and the row is deleted). Older sites keep the full
                  // string with the base-equality delete.
                  onStyle(region.key, storableStyle(styleOptions, region.base ?? '', next))
                }}
              />
            ))}
          </div>
        ) : (
          // SAY SO. Silence here is indistinguishable from a broken panel, and the
          // manager has no other way to learn the site never offered this text for
          // styling. (Skeen declares regions for its sections but none for its polaroid
          // captions — see BRIEF-caption-styling.md in that repo.)
          <p className="font-space text-[11px] leading-snug text-ink-faint">
            This site hasn&apos;t made {field.label.toLowerCase()} styleable, so there&apos;s no font,
            size or thickness to set here. Its appearance comes from the site&apos;s own design.
          </p>
        )}
      </div>

      <div className="px-5">
        <SaveLine status={status} />
      </div>
    </EditorPanel>
  )
}
