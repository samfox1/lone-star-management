import { useState, useEffect, useRef, useCallback } from 'react'
import { cx } from '@/lib/cx'
import { type IconName } from '@/components/ui/icons'
import { applyStyleValue, buildStyleControls, type SiteStyleOptions } from '@/lib/site-editor/style-controls'
import { type EditorTextField } from '../inspector-types'
import { runSerialized, FieldRow, SaveLine, FIELD } from '../inspector-shared'
import { StyleControlRow } from './style-tools'
import { useStyleRegionSave } from '../use-style-save'
import { saveEditorFieldAction } from '../../actions'

/** Which icon leads a TEXT field row — matched on the field key so the panel doesn't
 *  repeat one glyph down the whole column. */
function textFieldIcon(key: string, type: string): IconName {
  if (type === 'email' || key.includes('email')) return 'external'
  const k = key.toLowerCase()
  if (k.includes('button') || k.includes('cta')) return 'bolt'
  if (k.includes('show') || k.includes('tour')) return 'tour'
  if (k.includes('work') || k.includes('music') || k.includes('track')) return 'tracks'
  if (k.includes('video')) return 'videos'
  if (k.includes('merch')) return 'merch'
  if (k.includes('booking') || k.includes('contact')) return 'links'
  if (k.includes('name')) return 'roster'
  return 'text'
}
/* ── Text tools: edit the site's headings, taglines, bio, booking copy ───────── */
export function TextTools({
  textFields,
  artistId,
  onApplyField,
  styleValues = {},
  styleOptions,
  onApplyStyle,
}: {
  textFields: EditorTextField[]
  artistId: string
  onApplyField?: (key: string, value: string) => void
  /** region_key → class string, for the region each field is dressed by. */
  styleValues?: Record<string, string>
  styleOptions?: SiteStyleOptions
  onApplyStyle?: (key: string, className: string) => void
}) {
  // Styling saves through the SAME hook the Style panel uses, so a font set here and a
  // font set there cannot disagree about what is stored or drift in debounce behaviour.
  const { status: styleStatus, save: saveStyle } = useStyleRegionSave(artistId, onApplyStyle)
  const styleControls = buildStyleControls(styleOptions).filter((c) =>
    // Type only. Colour, alignment and the rest stay in the Style panel: the Text panel
    // is for the words and how they READ, and a dozen controls under every input turns a
    // content list into a wall.
    ['font', 'size', 'weight'].includes(c.id),
  )
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(textFields.map((f) => [f.key, f.value])),
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())

  const persist = useCallback(
    (key: string, value: string) => {
      pending.current.delete(key)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, key, () => saveEditorFieldAction(artistId, key, value))
    },
    [artistId],
  )

  // Flush any still-pending edits on unmount so a fast tab-away can't drop one.
  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((value, key) => {
        void saveEditorFieldAction(artistId, key, value)
      })
    }
  }, [artistId])

  function edit(field: EditorTextField, value: string) {
    setValues((v) => ({ ...v, [field.key]: value }))
    onApplyField?.(field.key, value) // optimistic live-preview paint
    pending.current.set(field.key, value)
    const existing = timers.current.get(field.key)
    if (existing) clearTimeout(existing)
    timers.current.set(
      field.key,
      setTimeout(() => {
        timers.current.delete(field.key)
        persist(field.key, value)
      }, 500),
    )
  }

  return (
    <div className="py-2">
      {textFields.map((f) => (
        <div key={f.key} className="px-5">
          <FieldRow icon={textFieldIcon(f.key, f.type)} label={f.label}>
            {f.multiline ? (
              <textarea
                value={values[f.key] ?? ''}
                onChange={(e) => edit(f, e.target.value)}
                className={cx(FIELD, 'min-h-20 resize-y leading-relaxed')}
              />
            ) : (
              <input
                type={f.type === 'email' ? 'email' : 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => edit(f, e.target.value)}
                className={FIELD}
              />
            )}
          </FieldRow>

          {/* Type controls for the region this field's element is dressed by, when the
              site declares one. A field with no region shows none rather than controls
              that write somewhere nothing renders — see styleRegionForField. */}
          {f.styleRegion && styleControls.length > 0 && (
            <div className="mb-3 ml-8 space-y-1.5 border-l border-hairline-soft pl-3">
              {styleControls.map((control) => (
                <StyleControlRow
                  key={control.id}
                  regionLabel={f.label}
                  control={control}
                  cls={styleValues[f.styleRegion!.key] ?? ''}
                  onChange={(value) =>
                    saveStyle(
                      f.styleRegion!.key,
                      applyStyleValue(styleValues[f.styleRegion!.key] ?? '', control, value),
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      ))}
      {/* One line for both jobs: a manager editing a sentence does not think of typing
          and restyling it as two different saves. */}
      <SaveLine status={status === 'idle' ? styleStatus : status} />
    </div>
  )
}
