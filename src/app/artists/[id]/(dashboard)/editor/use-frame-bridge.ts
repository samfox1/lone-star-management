'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublicSitePayload } from '@/lib/site'
import { editorMessage, isFrameMessage } from '@/lib/site-editor/bridge'
import type { TemplateManifest } from '@/lib/site-editor/manifest'

/**
 * The editor's whole conversation with the site frame, in one place
 * (SITE_STYLING_PLAN.md S4 / ADR 0006's postMessage bridge).
 *
 * It lives here rather than inside `EditorShell` because this is where the bugs
 * are. Every failure in this area is SILENT — a postMessage to the wrong target
 * origin is dropped by the browser with no error, and the frame simply never
 * populates. Two shipped that way: `apply-field` posted to
 * `window.location.origin`, which a cross-origin custom site could never receive;
 * and the earlier test "covering" it re-implemented `frameSrc` and asserted against
 * its own copy, so it passed regardless. Behind a hook, the rules below are
 * assertable against a fake frame with no iframe in sight.
 *
 * TWO FRAME KINDS:
 *  - built-in template → same-origin `/artists/[id]/edit-frame`, which fetches its
 *    own draft server-side under RLS. Nothing is posted to it.
 *  - custom site → the artist's own `custom_site_url/edit`, CROSS-ORIGIN, with no
 *    access to our DB. We hand it the draft over `init-data` (D-C).
 */

/** Where the frame is loaded from. A custom site serves an `/edit` route (S3); a
 *  built-in template uses the same-origin edit-mode route. */
export function frameSrc(artistId: string, customSiteUrl?: string | null): string {
  return customSiteUrl ? `${customSiteUrl.replace(/\/$/, '')}/edit` : `/artists/${artistId}/edit-frame`
}

/**
 * The ONE origin we post to and the only one we accept from. Never `'*'`: that
 * would hand the draft to whatever document happened to occupy the frame.
 *
 * Takes `fallback` (the editor's own origin) rather than reading `window` itself,
 * so it stays pure and callable during SSR — this module is a client component but
 * still renders on the server, where `window` does not exist.
 */
export function frameOrigin(customSiteUrl: string | null | undefined, fallback: string): string {
  return customSiteUrl ? new URL(customSiteUrl).origin : fallback
}

export type FrameBridge = {
  /** Attach to the iframe. */
  frameRef: React.RefObject<HTMLIFrameElement | null>
  /** The iframe's `src`. */
  src: string
  /** Optimistically repaint a text field in the frame, before the debounced save. */
  applyField: (key: string, value: string) => void
  /** Optimistically repaint a region's classes in the frame, before the save. */
  applyStyle: (key: string, className: string) => void
  /** A custom site's own edit-list, received on `ready` (D-D). Null for a built-in
   *  template, which has none to send. */
  manifest: TemplateManifest | null
  /** Region key the frame last reported a click on, so the inspector can focus it. */
  selectedStyle: string | null
}

export function useFrameBridge({
  artistId,
  customSiteUrl,
  draft,
}: {
  artistId: string
  customSiteUrl?: string | null
  draft?: PublicSitePayload | null
}): FrameBridge {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [manifest, setManifest] = useState<TemplateManifest | null>(null)
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null)

  // Resolved lazily: `window` only exists in the browser, and every caller below
  // runs client-side.
  const targetOrigin = useCallback(
    () => frameOrigin(customSiteUrl, window.location.origin),
    [customSiteUrl],
  )

  const post = useCallback(
    (msg: Parameters<typeof editorMessage>[0]) => {
      frameRef.current?.contentWindow?.postMessage(editorMessage(msg), targetOrigin())
    },
    [targetOrigin],
  )

  const applyField = useCallback((key: string, value: string) => post({ type: 'apply-field', key, value }), [post])
  const applyStyle = useCallback(
    (key: string, className: string) => post({ type: 'apply-style', key, className }),
    [post],
  )

  // One listener for everything the frame says.
  useEffect(() => {
    const origin = targetOrigin()
    const onMessage = (e: MessageEvent) => {
      // The bridge's source/version guards are a SHAPE check, not an origin check —
      // both are required before the payload is trusted.
      if (e.origin !== origin || !isFrameMessage(e.data)) return
      const msg = e.data
      if (msg.type === 'ready') {
        // `ready`, not the iframe's `load`: load can fire before the frame's bridge
        // has mounted its listener, and the draft would land in the void.
        if (msg.manifest) setManifest(msg.manifest)
        if (draft) {
          frameRef.current?.contentWindow?.postMessage(editorMessage({ type: 'init-data', site: draft }), origin)
        }
      } else if (msg.type === 'select' && msg.target.kind === 'style') {
        setSelectedStyle(msg.target.key)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [draft, targetOrigin])

  return { frameRef, src: frameSrc(artistId, customSiteUrl), applyField, applyStyle, manifest, selectedStyle }
}
