'use client'

import { useCallback, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { buttonClass } from '@/components/ui/ui'
import { editorMessage } from '@/lib/site-editor/bridge'
import { EditorInspector, type EditorTextField, type GalleryPhoto } from './editor-inspector'

/**
 * The visual editor shell (SITE_EDITOR_PLAN.md phase 2). Sits full-bleed below the
 * dashboard nav: the LEFT inspector (component browser + tools) and the artist's
 * real site in an embedded frame (the edit-mode `/edit-frame` route). The frame's
 * controls — device, save status, Publish — float in the gap above the centered
 * window (no toolbar bar). Publish + the tool→data wiring land next.
 */
export function EditorShell({
  artistId,
  photos,
  textFields,
}: {
  artistId: string
  photos: GalleryPhoto[]
  textFields: EditorTextField[]
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const frameRef = useRef<HTMLIFrameElement>(null)

  // Optimistically paint a text edit into the live preview frame (bridge apply-field).
  const applyField = useCallback((key: string, value: string) => {
    frameRef.current?.contentWindow?.postMessage(
      editorMessage({ type: 'apply-field', key, value }),
      window.location.origin,
    )
  }, [])

  return (
    // Cancel the dashboard main padding so the editor is full-bleed below the nav.
    <div className="-mx-7 -my-8 flex h-[calc(100vh-4rem)] border-t border-hairline">
      <EditorInspector artistId={artistId} photos={photos} textFields={textFields} onApplyField={applyField} />

      <div className="flex min-w-0 flex-1 flex-col bg-surface p-3">
        <div className="flex h-full w-full flex-col gap-2.5">
          {/* Floating controls: device, status, Publish — no toolbar bar. */}
          <div className="flex items-center gap-3 px-0.5">
            <label className="sr-only" htmlFor="editor-device">
              Preview device
            </label>
            <select
              id="editor-device"
              value={device}
              onChange={(e) => setDevice(e.target.value as 'desktop' | 'mobile')}
              className="rounded-lg border border-hairline bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink-faint"
            >
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>

            <span className="flex-1" />

            <span className="inline-flex items-center gap-2 font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Saved
            </span>
            <button type="button" className={buttonClass('accent')} title="Publishing lands next">
              Publish
            </button>
          </div>

          <iframe
            ref={frameRef}
            src={`/artists/${artistId}/edit-frame`}
            title="Site editor"
            className={cx(
              'min-h-0 flex-1 rounded-xl border border-hairline bg-paper shadow-sm',
              device === 'mobile' ? 'mx-auto w-[390px]' : 'w-full',
            )}
          />
        </div>
      </div>
    </div>
  )
}
