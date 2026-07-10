'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { inputClass } from '@/components/ui/ui'
import { editorMessage, isFrameMessage, type SelectTarget } from '@/lib/site-editor/bridge'
import { fieldByKey, labelForTarget, type ManifestField, type TemplateManifest } from '@/lib/site-editor/manifest'
import { saveEditorFieldAction } from '../actions'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * The visual editor shell (SITE_EDITOR_PLAN.md phase 2). Sits below the dashboard
 * nav: a LEFT inspector + the artist's real site in an embedded frame (the
 * edit-mode `/edit-frame` route). Clicking a marked region reports a `select` over
 * the bridge; the inspector edits TEXT fields — optimistically applied into the
 * frame and debounce-saved to the draft. Image fields and library slots come next.
 */
export function EditorShell({
  artistId,
  manifest,
  fieldValues,
}: {
  artistId: string
  manifest: TemplateManifest | null
  fieldValues: Record<string, string>
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [selected, setSelected] = useState<SelectTarget | null>(null)
  const [values, setValues] = useState<Record<string, string>>(fieldValues)
  const [save, setSave] = useState<SaveState>('idle')
  const frameRef = useRef<HTMLIFrameElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ key: string; value: string } | null>(null)

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !isFrameMessage(e.data)) return
      if (e.data.type === 'select') setSelected(e.data.target)
      else if (e.data.type === 'deselect') setSelected(null)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Persist the pending edit NOW (fires the debounce early). Keyed by the pending
  // field, not the current one — so switching fields flushes the previous field's
  // edit instead of dropping it.
  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const p = pending.current
    if (!p) return
    pending.current = null
    setSave('saving')
    saveEditorFieldAction(artistId, p.key, p.value).then((res) => setSave(res.ok ? 'saved' : 'error'))
  }, [artistId])

  // Flush the previous field's pending edit when the selection changes, and on unmount.
  useEffect(() => flush, [selected, flush])

  const selectedField: ManifestField | undefined =
    selected?.kind === 'field' && manifest ? fieldByKey(manifest, selected.key) : undefined

  function edit(field: ManifestField, value: string) {
    setValues((v) => ({ ...v, [field.key]: value }))
    // Optimistic: paint the value into the frame immediately.
    frameRef.current?.contentWindow?.postMessage(
      editorMessage({ type: 'apply-field', key: field.key, value }),
      window.location.origin,
    )
    // Debounced save to the draft.
    pending.current = { key: field.key, value }
    setSave('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 500)
  }

  return (
    // Cancel the dashboard main padding so the editor is full-bleed below the nav.
    <div className="-mx-7 -my-8 flex h-[calc(100vh-4rem)] border-t border-hairline">
      <aside className="flex w-72 flex-none flex-col gap-4 overflow-y-auto border-r border-hairline bg-surface p-4">
        <div>
          <div className="font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Editor</div>
          <h2 className="text-sm font-bold tracking-[-0.01em]">Edit your site</h2>
        </div>

        <div className="inline-flex gap-0.5 rounded-lg border border-hairline p-0.5">
          {(['desktop', 'mobile'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDevice(d)}
              aria-pressed={device === d}
              className={cx(
                'flex-1 rounded-md px-2.5 py-1 font-space text-xs capitalize transition-colors',
                device === d ? 'bg-ink font-semibold text-white' : 'text-ink-muted hover:text-ink',
              )}
            >
              {d}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-hairline bg-paper p-3">
          {selectedField ? (
            <>
              <div className="flex items-center justify-between">
                <div className="font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                  {manifest ? labelForTarget(manifest, selected!) : selectedField.label}
                </div>
                {save !== 'idle' && (
                  <span
                    className={cx(
                      'font-space text-[10px]',
                      save === 'error' ? 'text-accent-red' : 'text-ink-faint',
                    )}
                  >
                    {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : 'Failed'}
                  </span>
                )}
              </div>

              {selectedField.type === 'image' ? (
                <p className="mt-2 text-xs text-ink-muted">Image editing is coming next.</p>
              ) : selectedField.key === 'artist_bio' ? (
                <textarea
                  autoFocus
                  rows={6}
                  value={values[selectedField.key] ?? ''}
                  onChange={(e) => edit(selectedField, e.target.value)}
                  className={cx(inputClass, 'mt-2 w-full resize-y')}
                />
              ) : (
                <input
                  autoFocus
                  type={selectedField.type === 'email' ? 'email' : 'text'}
                  value={values[selectedField.key] ?? ''}
                  onChange={(e) => edit(selectedField, e.target.value)}
                  className={cx(inputClass, 'mt-2 w-full')}
                />
              )}
            </>
          ) : selected ? (
            <p className="text-xs text-ink-muted">
              {manifest ? labelForTarget(manifest, selected) : 'Selected'} — placing and reordering come next.
            </p>
          ) : (
            <p className="text-xs text-ink-muted">
              Click a heading, the bio, or another text region on your site to edit it.
            </p>
          )}
        </div>

        {manifest && manifest.slots.length > 0 && (
          <div className="space-y-1">
            <div className="font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">Sections</div>
            {manifest.slots.map((s) => (
              <div key={s.key} className="rounded-md px-2 py-1.5 text-xs text-ink-muted">
                {s.label}
              </div>
            ))}
          </div>
        )}
      </aside>

      <div className="flex flex-1 items-stretch justify-center overflow-auto bg-surface p-6">
        <iframe
          ref={frameRef}
          src={`/artists/${artistId}/edit-frame`}
          title="Site editor"
          className={cx(
            'h-full border border-hairline bg-paper shadow-sm transition-[width] duration-200',
            device === 'mobile' ? 'w-[390px]' : 'w-full',
          )}
        />
      </div>
    </div>
  )
}
