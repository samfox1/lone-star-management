'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { applyStyleValue, buildTextItemStyleControls, type SiteStyleOptions } from '@/lib/site-editor/style-controls'
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
  styleOptions?: SiteStyleOptions
  onEdit: (value: string) => void
  onStyle: (regionKey: string, className: string) => void
  onBack: () => void
}) {
  // Sliders for size and thickness, a select for font — shaped like the image and video
  // editors rather than the Style panel's menus, because this is the same gesture.
  const controls = buildTextItemStyleControls(styleOptions)
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
  const [staged, setStaged] = useState(() => (region ? (styleValues[region.key] ?? '') : ''))
  const [seededFor, setSeededFor] = useState(region?.key ?? null)
  if (seededFor !== (region?.key ?? null)) {
    setSeededFor(region?.key ?? null)
    setStaged(region ? (styleValues[region.key] ?? '') : '')
  }
  const cls = staged

  return (
    <EditorPanel label={field.label} onBack={onBack}>
      {/* A style-only entry is a text AREA of the site — the words are written into the
          design, so there is nothing to type. It still gets the type controls below. */}
      {field.styleOnly ? (
        <p className="px-5 pt-4 font-space text-[11px] leading-snug text-ink-faint">
          This text is part of the site&apos;s design, so it can&apos;t be retyped here — but you
          can change how it looks.
        </p>
      ) : (
      <div className="px-5 pt-4">
        {/* The site's own fallback as the PLACEHOLDER, so opening an untouched field
            shows the words that are actually on the page rather than an empty box that
            reads as missing content. Typing replaces it; clearing brings it back. */}
        {field.multiline ? (
          <textarea
            autoFocus
            value={value}
            onChange={(e) => onEdit(e.target.value)}
            aria-label={field.label}
            placeholder={field.defaultValue ?? ''}
            className={cx(FIELD, 'min-h-32 resize-y leading-relaxed')}
          />
        ) : (
          <input
            autoFocus
            type={field.type === 'email' ? 'email' : 'text'}
            value={value}
            onChange={(e) => onEdit(e.target.value)}
            aria-label={field.label}
            placeholder={field.defaultValue ?? ''}
            className={FIELD}
          />
        )}
      </div>
      )}

      <div className="mt-5 border-t border-hairline-soft px-5 pt-4">
        {region ? (
          // Controls only when the site declares a style region for this field. One that
          // writes to a key nothing renders is worse than none: the manager changes the
          // font, nothing happens, and no error explains it.
          <div className="space-y-1.5">
            {controls.map((control) => (
              <StyleControlRow
                key={control.id}
                regionLabel={field.label}
                control={control}
                cls={cls}
                onChange={(v) => {
                  const next = applyStyleValue(cls, control, v)
                  setStaged(next) // the control moves NOW; the save follows
                  onStyle(region.key, next)
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
