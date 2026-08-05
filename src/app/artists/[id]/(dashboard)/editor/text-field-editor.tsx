'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { applyStyleValue, buildTextItemStyleControls, type SiteStyleOptions } from '@/lib/site-editor/style-controls'
import { type EditorTextField } from './inspector-types'
import { FIELD, SCROLL_BODY, SaveLine, type SaveStatus } from './inspector-shared'
import { StyleControlRow } from './panels/style-tools'

/**
 * ONE text field, opened full-panel — the same shape the image and video editors use, so
 * "Edit" means the same thing everywhere in the inspector.
 *
 * Why a separate component rather than `ItemEditor`: that one is built around swapping a
 * MEDIA item (a preview thumbnail, Replace, Remove). A sentence has none of those. What
 * it shares is the frame: back-chevron header, the body, and the type controls.
 *
 * The words save DEBOUNCED as you type (the panel list did this too, and losing it would
 * make the editor feel worse than the list it replaced). Styling saves on change through
 * the same hook the Style panel uses, so the two can never disagree about what is stored.
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
  /** Live value, owned by the panel so it survives opening and closing this editor. */
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
  const cls = region ? (styleValues[region.key] ?? '') : ''

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-hairline px-4 pb-2.5 pt-[15px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex-none rounded-md p-1 text-ink-muted hover:bg-surface hover:text-ink"
        >
          <Icon name="chevronLeft" size={18} />
        </button>
        <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em]">Edit {field.label}</h2>
      </div>

      <div className={SCROLL_BODY}>
        <div className="px-5 pt-4">
          {field.multiline ? (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => onEdit(e.target.value)}
              aria-label={field.label}
              className={cx(FIELD, 'min-h-32 resize-y leading-relaxed')}
            />
          ) : (
            <input
              autoFocus
              type={field.type === 'email' ? 'email' : 'text'}
              value={value}
              onChange={(e) => onEdit(e.target.value)}
              aria-label={field.label}
              className={FIELD}
            />
          )}
        </div>

        <div className="mt-5 border-t border-hairline-soft px-5 pt-4">
          {region ? (
            // Controls only when the site declares a style region for this field. One
            // that writes to a key nothing renders is worse than none: the manager
            // changes the font, nothing happens, and no error explains it.
            <div className="space-y-1.5">
              {controls.map((control) => (
                <StyleControlRow
                  key={control.id}
                  regionLabel={field.label}
                  control={control}
                  cls={cls}
                  onChange={(v) => onStyle(region.key, applyStyleValue(cls, control, v))}
                />
              ))}
            </div>
          ) : (
            // SAY SO. Silence here is indistinguishable from the panel being broken —
            // which is exactly how this looked before, and the manager has no way to
            // know the site never offered this text for styling.
            <p className="font-space text-[11px] leading-snug text-ink-faint">
              This site hasn&apos;t made {field.label.toLowerCase()} styleable, so there&apos;s no font, size
              or thickness to set here. Its appearance comes from the site&apos;s own design.
            </p>
          )}
        </div>)

        <div className="px-5">
          <SaveLine status={status} />
        </div>
      </div>
    </>
  )
}
