'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublicSitePayload } from '@/lib/site'
import { editorMessage, isFrameMessage } from '@/lib/site-editor/bridge'
import type { TemplateManifest } from '@/lib/site-editor/manifest'
import { fitViewport, zoomLabel, type Device } from '@/lib/site-editor/viewport'
import { EditorPublish } from './editor-publish'
import {
  EditorInspector,
  type EditorLink,
  type EditorMerch,
  type EditorSong,
  type EditorTextField,
  type EditorVideo,
  type GalleryPhoto,
} from './editor-inspector'

/**
 * The visual editor shell (SITE_EDITOR_PLAN.md phase 2). Sits full-bleed below the
 * dashboard nav: the LEFT inspector (component browser + tools) and the artist's
 * real site in an embedded frame. The frame's controls — device, save status,
 * Publish — float in the gap above the centered window (no toolbar bar).
 *
 * TWO FRAME KINDS (SITE_STYLING_PLAN.md S4):
 *  - built-in template → same-origin `/artists/[id]/edit-frame`, which fetches its
 *    own draft server-side under RLS. No data is posted to it.
 *  - custom site (`site_kind='custom'`) → the artist's own `custom_site_url/edit`,
 *    CROSS-ORIGIN. It has no access to our DB, so we hand it the draft over the
 *    bridge (`init-data`) once it announces `ready` (D-C). `ready` is the trigger,
 *    not the iframe's `load`: load can fire before the frame's bridge has mounted,
 *    and the message would be dropped.
 *
 * Origin discipline: every postMessage targets the FRAME's origin (never `*`), and
 * every inbound message is checked against it before we trust the payload — the
 * bridge's source/version guards are a shape check, not an origin check.
 */
export function EditorShell({
  artistId,
  customSiteUrl,
  draft,
  photos,
  textFields,
  links,
  videos,
  merch,
  songs,
}: {
  artistId: string
  /** The artist's external site origin when `site_kind='custom'`, else null. */
  customSiteUrl?: string | null
  /** The draft to inject into a custom frame, in the wire shape. Null for a
   *  built-in template, which reads its own draft server-side. */
  draft?: PublicSitePayload | null
  photos: GalleryPhoto[]
  textFields: EditorTextField[]
  links: EditorLink[]
  videos: EditorVideo[]
  merch: EditorMerch[]
  songs: EditorSong[]
}) {
  const [device, setDevice] = useState<Device>('desktop')
  const frameRef = useRef<HTMLIFrameElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panel, setPanel] = useState({ w: 0, h: 0 })
  // A custom site posts its own edit-list on `ready`; a built-in template has none
  // to send (its manifest lives here and declares no style regions yet).
  const [frameManifest, setFrameManifest] = useState<TemplateManifest | null>(null)
  // Region key the frame last reported a click on, so the inspector can focus it.
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null)

  // Measure the frame panel so the canvas can be scaled to fit it. The panel
  // resizes with the window (and would with a collapsible inspector), so observe
  // rather than measure once.
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setPanel({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const view = fitViewport(device, panel.w, panel.h)

  const frameSrc = customSiteUrl ? `${customSiteUrl.replace(/\/$/, '')}/edit` : `/artists/${artistId}/edit-frame`

  // Resolved lazily: this is a client component but still SSRs, and `window` only
  // exists in the browser. Every caller below runs client-side.
  const targetOrigin = useCallback(
    () => (customSiteUrl ? new URL(customSiteUrl).origin : window.location.origin),
    [customSiteUrl],
  )

  // Optimistically paint a text edit into the live preview frame (bridge apply-field).
  const applyField = useCallback(
    (key: string, value: string) => {
      frameRef.current?.contentWindow?.postMessage(
        editorMessage({ type: 'apply-field', key, value }),
        targetOrigin(),
      )
    },
    [targetOrigin],
  )

  // Same, for a region's class string (bridge apply-style) — repaints the frame
  // as you type, before the debounced save lands.
  const applyStyle = useCallback(
    (key: string, className: string) => {
      frameRef.current?.contentWindow?.postMessage(
        editorMessage({ type: 'apply-style', key, className }),
        targetOrigin(),
      )
    },
    [targetOrigin],
  )

  // One listener for everything the frame says. `ready` carries a CUSTOM site's
  // own edit-list (D-D) — that's the only way the editor learns skeen's style
  // regions, since the built-in manifests declare `styles: []`. We answer it with
  // the draft, which a custom frame has no DB access to fetch itself.
  useEffect(() => {
    const origin = targetOrigin()
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || !isFrameMessage(e.data)) return
      const msg = e.data
      if (msg.type === 'ready') {
        if (msg.manifest) setFrameManifest(msg.manifest)
        if (draft) {
          frameRef.current?.contentWindow?.postMessage(editorMessage({ type: 'init-data', site: draft }), origin)
        }
      } else if (msg.type === 'select' && msg.target.kind === 'style') {
        // Click a region in the site → jump the inspector to that region's input.
        setSelectedStyle(msg.target.key)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [draft, targetOrigin])

  return (
    // Cancel the dashboard main padding so the editor is full-bleed below the nav.
    <div className="-mx-7 -my-8 flex h-[calc(100vh-4rem)] border-t border-hairline">
      <EditorInspector
        artistId={artistId}
        photos={photos}
        textFields={textFields}
        links={links}
        videos={videos}
        merch={merch}
        songs={songs}
        styleRegions={frameManifest?.styles ?? []}
        styleValues={draft?.styles ?? {}}
        selectedStyle={selectedStyle}
        onApplyField={applyField}
        onApplyStyle={applyStyle}
      />

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
              onChange={(e) => setDevice(e.target.value as Device)}
              className="rounded-lg border border-hairline bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink-faint"
            >
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>

            {/* The canvas is a real 1440px desktop window drawn smaller, so say so —
                otherwise a zoomed-out site reads as "the text is broken". */}
            <span className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              {view.width}px · {zoomLabel(view.scale)}
            </span>

            <span className="flex-1" />

            {/* No global save chip here — the real per-field status ('Saving…/Saved/Failed')
                lives in each inspector tool; a hardcoded chip would just lie. */}
            <EditorPublish artistId={artistId} />
          </div>

          {/* The frame renders at a TRUE desktop width and is scaled down to fit,
              rather than being squeezed into the panel's ~900px — which would trip
              the site's tablet breakpoints and show a layout no desktop visitor
              gets. `overflow-hidden` clips the scaled canvas; the outer box is
              sized to the RENDERED dimensions so layout stays honest.
              NOTE for the selection overlay (still to come): the frame reports
              rects in its own 1440-space, so multiply them by `view.scale` before
              drawing over the top. */}
          <div ref={panelRef} className="flex min-h-0 flex-1 justify-center">
            <div
              className="relative overflow-hidden rounded-xl border border-hairline bg-paper shadow-sm"
              style={{ width: view.renderedWidth || '100%', height: view.renderedHeight || '100%' }}
            >
              <iframe
                ref={frameRef}
                src={frameSrc}
                title="Site editor"
                className="absolute left-0 top-0 border-0"
                style={{
                  width: view.width,
                  height: view.height,
                  transform: `scale(${view.scale})`,
                  transformOrigin: 'top left',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
