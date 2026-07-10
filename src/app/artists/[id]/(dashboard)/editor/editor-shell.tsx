'use client'

import { useEffect, useState } from 'react'
import { cx } from '@/lib/cx'
import { isFrameMessage, type SelectTarget } from '@/lib/site-editor/bridge'
import { labelForTarget, type TemplateManifest } from '@/lib/site-editor/manifest'

/**
 * The visual editor shell (SITE_EDITOR_PLAN.md phase 2, minimal). Sits below the
 * dashboard nav: a LEFT toolbar + the artist's real site in an embedded frame
 * (the edit-mode `/edit-frame` route). Clicking a marked region in the frame
 * reports a `select` over the bridge; the toolbar names it. The per-field editing
 * controls, "+ Add from library", and publish land next — this proves the layout
 * and the click→select loop end to end.
 */
export function EditorShell({ artistId, manifest }: { artistId: string; manifest: TemplateManifest | null }) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [selected, setSelected] = useState<SelectTarget | null>(null)

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Same-origin frame; ignore anything else (and any non-bridge message).
      if (e.origin !== window.location.origin || !isFrameMessage(e.data)) return
      if (e.data.type === 'select') setSelected(e.data.target)
      else if (e.data.type === 'deselect') setSelected(null)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const selectedLabel = selected && manifest ? labelForTarget(manifest, selected) : null

  return (
    // Cancel the dashboard main padding so the editor is full-bleed below the nav.
    <div className="-mx-7 -my-8 flex h-[calc(100vh-4rem)] border-t border-hairline">
      <aside className="flex w-64 flex-none flex-col gap-4 overflow-y-auto border-r border-hairline bg-surface p-4">
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
          {selectedLabel ? (
            <>
              <div className="font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">Selected</div>
              <div className="mt-1 text-sm font-semibold text-accent">{selectedLabel}</div>
              <p className="mt-2 text-xs text-ink-muted">Editing controls for this land here next.</p>
            </>
          ) : (
            <p className="text-xs text-ink-muted">
              Click a section, heading, song, or video on your site to edit it.
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
