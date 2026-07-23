import { useState, useEffect, useRef, useCallback } from 'react'
import { cx } from '@/lib/cx'
import { type IconName } from '@/components/ui/icons'
import { type EditorTextField } from '../inspector-types'
import { runSerialized, FieldRow, SaveLine, FIELD } from '../inspector-shared'
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
}: {
  textFields: EditorTextField[]
  artistId: string
  onApplyField?: (key: string, value: string) => void
}) {
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
        </div>
      ))}
      <SaveLine status={status} />
    </div>
  )
}
