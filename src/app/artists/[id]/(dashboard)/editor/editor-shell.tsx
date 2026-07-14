'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import type { PublicSitePayload } from '@/lib/site'
import { editorMessage, isFrameMessage } from '@/lib/site-editor/bridge'
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
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const frameRef = useRef<HTMLIFrameElement>(null)

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

  // Hand a custom frame its draft as soon as it says `ready`. The built-in frame
  // never needs this (it has DB access), so there's nothing to send without a draft.
  useEffect(() => {
    if (!draft) return
    const origin = targetOrigin()
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || !isFrameMessage(e.data) || e.data.type !== 'ready') return
      frameRef.current?.contentWindow?.postMessage(editorMessage({ type: 'init-data', site: draft }), origin)
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
        onApplyField={applyField}
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
              onChange={(e) => setDevice(e.target.value as 'desktop' | 'mobile')}
              className="rounded-lg border border-hairline bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink-faint"
            >
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>

            <span className="flex-1" />

            {/* No global save chip here — the real per-field status ('Saving…/Saved/Failed')
                lives in each inspector tool; a hardcoded chip would just lie. */}
            <EditorPublish artistId={artistId} />
          </div>

          <iframe
            ref={frameRef}
            src={frameSrc}
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
