'use client'

import { useEffect, useRef, useState } from 'react'
import type { PublicSitePayload } from '@/lib/site'
import { fitViewport, zoomLabel, type Device } from '@/lib/site-editor/viewport'
import { withUploadedFonts } from '@/lib/site-editor/style-controls'
import { EditorPublish } from './editor-publish'
import { useFrameBridge } from './use-frame-bridge'
import {
  EditorInspector,
  type EditorImageField,
  type EditorLink,
  type EditorMerch,
  type EditorProject,
  type EditorSupportLink,
  type EditorTour,
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
  imageFields,
  textFields,
  links,
  supportLinks,
  linkValues,
  videos,
  merch,
  releases,
  tours,
  uploadedFonts = [],
}: {
  artistId: string
  /** The artist's external site origin when `site_kind='custom'`, else null. */
  customSiteUrl?: string | null
  /** The draft to inject into a custom frame, in the wire shape. Null for a
   *  built-in template, which reads its own draft server-side. */
  draft?: PublicSitePayload | null
  photos: GalleryPhoto[]
  /** Single-occupancy image fields (hero image, profile photo) — the "Set slots" group.
   *  BUILT-IN templates only: page.tsx resolves them with a save target. A custom site
   *  (skeen) declares its images without a lone-star target and edits them via the component
   *  slots + gallery instead, so it passes []; skeen's hero is a video (Videos panel), not an
   *  image, so there is deliberately no hero-image tile for it. */
  imageFields: EditorImageField[]
  textFields: EditorTextField[]
  links: EditorLink[]
  supportLinks: EditorSupportLink[]
  /** Current URL for each manifest link region, keyed by its role (from the DB). The
   *  regions themselves come from the frame's manifest at runtime. */
  linkValues: Record<string, string>
  videos: EditorVideo[]
  merch: EditorMerch[]
  releases: EditorProject[]
  tours: EditorTour[]
  /** Fonts uploaded on the Brand page, folded into the frame manifest's font options so
   *  every region's font dropdown offers them (Sam's per-region override model). */
  uploadedFonts?: { family: string; label: string }[]
}) {
  const [device, setDevice] = useState<Device>('desktop')
  const panelRef = useRef<HTMLDivElement>(null)
  const [panel, setPanel] = useState({ w: 0, h: 0 })

  // Everything about talking to the frame — origin discipline, the ready→init-data
  // handshake, select routing — lives behind this hook, where it's testable.
  // Destructured, not held as an object: the react-hooks/refs rule rejects reaching
  // through a member expression for a ref during render.
  const {
    frameRef,
    src: frameSrc,
    applyField,
    applyImage,
    applyStyle,
    applyLink,
    applyHighlight,
    clearHighlight,
    manifest,
    selectedStyle,
    selectedLink,
    selectedRegion,
  } = useFrameBridge({
    artistId,
    customSiteUrl,
    draft,
  })

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

  return (
    // Cancel the dashboard main padding so the editor is full-bleed below the nav.
    <div className="-mx-7 -my-8 flex h-[calc(100vh-4rem)] border-t border-hairline">
      <EditorInspector
        artistId={artistId}
        photos={photos}
        imageFields={imageFields}
        textFields={textFields}
        links={links}
        supportLinks={supportLinks}
        videos={videos}
        merch={merch}
        releases={releases}
        tours={tours}
        components={manifest?.components ?? []}
        // The collage exists only if the site declares somewhere to render one.
        showGallery={(manifest?.slots ?? []).some((sl) => sl.accepts === 'image')}
        styleRegions={manifest?.styles ?? []}
        styleValues={draft?.styles ?? {}}
        styleOptions={withUploadedFonts(manifest?.styleOptions, uploadedFonts)}
        selectedStyle={selectedStyle}
        linkRegions={manifest?.links ?? []}
        linkValues={linkValues}
        selectedLink={selectedLink}
        selectedRegion={selectedRegion}
        onApplyField={applyField}
        onApplyImage={applyImage}
        onApplyStyle={applyStyle}
        onApplyLink={applyLink}
        onHighlight={applyHighlight}
        onClearHighlight={clearHighlight}
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
