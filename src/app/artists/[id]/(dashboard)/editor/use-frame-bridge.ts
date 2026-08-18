'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublicSitePayload } from '@/lib/site'
import { editorMessage, isFrameMessage, type FrameMode, type SelectTarget } from '@samfox1/site-bridge/protocol'
import type { CursorSettings } from '@samfox1/site-bridge/cursor'
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

/** How often the editor re-asks the frame to announce itself, and for how long. A remote
 *  frame can take seconds to hydrate, so this outlasts a slow cold load. */
export const HELLO_RETRY_MS = 400
export const HELLO_TIMEOUT_MS = 20_000

export type FrameBridge = {
  /** Attach to the iframe. */
  frameRef: React.RefObject<HTMLIFrameElement | null>
  /** The iframe's `src`. */
  src: string
  /** Optimistically repaint a text field in the frame, before the debounced save. */
  applyField: (key: string, value: string) => void
  /** Optimistically repaint ONE image region (a slot placement) — before this, an image
   *  change's only route to the frame was revalidate → full init-data (~2-3s, silent). */
  applyImage: (key: string, url: string) => void
  /** Optimistically repaint a region's classes in the frame, before the save. */
  applyStyle: (key: string, className: string) => void
  /** Optimistically set a link-powered element's href in the frame, before the save. */
  applyLink: (key: string, url: string) => void
  /** Repaint the site-wide cursor + trail in the frame (Site panel), before the save. */
  applyCursor: (settings: CursorSettings) => void
  /** Replay every entrance animation in the frame (the toolbar's "Replay motion"). */
  replayMotion: () => void
  /** Pause (false) / resume (true) every playing video in the frame. */
  setPlayback: (playing: boolean) => void
  /** Outline + scroll a region into view in the frame (a tile click in the inspector). */
  applyHighlight: (target: SelectTarget) => void
  /** Drop the frame's current highlight (the tile was deselected). */
  clearHighlight: () => void
  /** Switch the frame between selecting regions and working the site (`set-mode`). */
  setMode: (mode: FrameMode) => void
  /** The mode as the editor last set it — the toolbar's source of truth. */
  frameMode: FrameMode
  /** A custom site's own edit-list, received on `ready` (D-D). Null for a built-in
   *  template, which has none to send. */
  manifest: TemplateManifest | null
  /** Region key the frame last reported a click on, so the inspector can focus it. */
  selectedStyle: string | null
  /** Link-region key the frame last reported a click on, to focus the Site-links panel. */
  selectedLink: { key: string; nonce: number } | null
  /** The IMAGE region (field / slot / item) the frame last reported a click on, so the
   *  inspector can open Images and focus the matching tile (the reverse of applyHighlight).
   *  Only field/slot/item selects land here — style/link route to their own panels. A
   *  bumped `nonce` re-fires the focus even when the same tile is clicked twice. */
  selectedRegion: { target: SelectTarget; nonce: number } | null
  /** Increments each time a preview click landed on nothing editable. The inspector
   *  collapses any open edit row on a change. */
  deselectedAt: number
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
  /** Has the frame answered at all? Internal: it drives the `hello` retries and the
   *  init-data effect. Not returned — nothing displays it (yet). */
  const [connected, setConnected] = useState(false)
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null)
  // Key + NONCE, like selectedRegion: a repeat click on the same element is a new
  // gesture (Sam, 2026-08-17: clicking Listen with another panel open did nothing —
  // the key hadn't changed, so the gate never re-fired).
  const [selectedLink, setSelectedLink] = useState<{ key: string; nonce: number } | null>(null)
  /** Ticks on every preview click that selected nothing — the panels read it as
   *  "collapse whatever is open". */
  const [deselectedAt, setDeselectedAt] = useState(0)
  const [selectedRegion, setSelectedRegion] = useState<{ target: SelectTarget; nonce: number } | null>(null)
  /** Whether a click in the frame SELECTS a region or works the site. Owned HERE, not in
   *  the shell, because the FRAME resets to `edit` whenever its page reloads — and in
   *  browse mode every navigation is a reload. The `ready` handler below re-sends the
   *  current mode so the frame and the toolbar cannot disagree (2026-08-10 review). */
  const [frameMode, setFrameModeState] = useState<FrameMode>('edit')
  const frameModeRef = useRef<FrameMode>('edit')

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
  const applyImage = useCallback((key: string, url: string) => post({ type: 'apply-image', key, url }), [post])
  const applyStyle = useCallback(
    (key: string, className: string) => post({ type: 'apply-style', key, className }),
    [post],
  )
  const applyLink = useCallback((key: string, url: string) => post({ type: 'apply-link', key, url }), [post])
  /** Repaint the site-wide cursor (Site panel) without waiting on the revalidate. */
  const applyCursor = useCallback(
    (settings: CursorSettings) => post({ type: 'apply-cursor', settings }),
    [post],
  )
  /** Replay every entrance in the frame — entrances play once, so testing "what does
   *  my page load look like" needs a button, not a hunt for the reload gesture. */
  const replayMotion = useCallback(() => post({ type: 'replay-entrances' }), [post])
  /** Pause / resume every playing video in the frame (the toolbar toggle). */
  const setPlayback = useCallback((playing: boolean) => post({ type: 'set-playback', playing }), [post])
  const applyHighlight = useCallback((target: SelectTarget) => post({ type: 'highlight', target }), [post])
  const clearHighlight = useCallback(() => post({ type: 'clear-highlight' }), [post])
  /** Whether a click in the frame SELECTS a region or works the site. See the protocol's
   *  `set-mode`: a site with navigation is unbrowsable while every click is swallowed. */
  const setMode = useCallback(
    (mode: FrameMode) => {
      frameModeRef.current = mode
      setFrameModeState(mode)
      post({ type: 'set-mode', mode })
    },
    [post],
  )

  /** The draft last handed to the frame, so the `ready` handler and the connected
   *  effect below (either of which may fire first) don't each post the largest message
   *  in the protocol — the whole site payload — for the same handshake. A frame that
   *  RELOADS re-announces `ready`, and that path deliberately re-sends. */
  const deliveredDraft = useRef<PublicSitePayload | null>(null)

  // One listener for everything the frame says.
  useEffect(() => {
    const origin = targetOrigin()
    const onMessage = (e: MessageEvent) => {
      // The bridge's source/version guards are a SHAPE check, not an origin check —
      // both are required before the payload is trusted.
      if (e.origin !== origin || !isFrameMessage(e.data)) return
      const msg = e.data
      setConnected(true) // anything from the frame means the bridge is up
      if (msg.type === 'ready') {
        // `ready`, not the iframe's `load`: load can fire before the frame's bridge
        // has mounted its listener, and the draft would land in the void.
        //
        // A fresh `ready` can also mean the frame RELOADED — in browse mode every
        // navigation is one — and a reloaded frame starts back in `edit`. Re-assert the
        // editor's mode, or the toolbar says Browse while clicks select (via the ref:
        // this listener must not re-subscribe per mode change).
        if (frameModeRef.current !== 'edit')
          frameRef.current?.contentWindow?.postMessage(editorMessage({ type: 'set-mode', mode: frameModeRef.current }), origin)
        if (msg.manifest) setManifest(msg.manifest)
        if (draft) {
          deliveredDraft.current = draft
          frameRef.current?.contentWindow?.postMessage(editorMessage({ type: 'init-data', site: draft }), origin)
        }
      } else if (msg.type === 'select' && msg.target.kind === 'style') {
        setSelectedStyle(msg.target.key)
      } else if (msg.type === 'select' && msg.target.kind === 'link') {
        const key = msg.target.key
        setSelectedLink((prev) => ({ key, nonce: (prev?.nonce ?? 0) + 1 }))
      } else if (msg.type === 'deselect') {
        // A click in the preview that hit NOTHING editable. The frame has always posted
        // this; the editor used to drop it, which is why an open panel sat there while
        // the manager clicked around the page trying to dismiss it (Sam, 2026-08-14).
        // A COUNTER, not a boolean: two consecutive clicks on dead space are two events,
        // and a flag would only fire on the first.
        setDeselectedAt((n) => n + 1)
      } else if (msg.type === 'select') {
        // field / slot / item — an image (or text) region. Hand it to the inspector,
        // which knows which of these are images and opens the Images panel on them.
        // The nonce lets a repeat click on the same region re-fire the focus.
        const target = msg.target
        setSelectedRegion((prev) => ({ target, nonce: (prev?.nonce ?? 0) + 1 }))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [draft, targetOrigin])

  /**
   * Hand the frame its draft whenever we have both a draft and a live bridge.
   *
   * `ready` only carries the draft when one is already loaded; arrive first and the
   * frame waits forever for data the editor had all along. This closes the other half
   * of that ordering — either side may become ready first, and the draft still lands.
   */
  useEffect(() => {
    if (!connected || !draft || deliveredDraft.current === draft) return
    deliveredDraft.current = draft
    frameRef.current?.contentWindow?.postMessage(
      editorMessage({ type: 'init-data', site: draft }),
      targetOrigin(),
    )
  }, [connected, draft, targetOrigin])

  /**
   * Ask the frame to announce itself, until it does.
   *
   * The frame announcing on its own mount is a race the editor can lose: this listener
   * attaches on mount and RE-attaches whenever `draft` changes, and a `ready` posted in
   * any gap is dropped by the browser silently. Then the editor holds no manifest, shows
   * "0 regions", and nothing distinguishes that from a site that declares nothing.
   *
   * So the editor pushes too. Both sides retry, so connecting no longer depends on who
   * mounted first, and `connected` gives the shell something honest to display instead
   * of a frame that just sits there.
   */
  useEffect(() => {
    if (connected) return
    const origin = targetOrigin()
    const hello = () =>
      frameRef.current?.contentWindow?.postMessage(editorMessage({ type: 'hello' }), origin)
    hello() // the iframe may already be up (a re-render, or a fast cache hit)
    const frame = frameRef.current
    frame?.addEventListener('load', hello)
    const timer = setInterval(hello, HELLO_RETRY_MS)
    const giveUp = setTimeout(() => clearInterval(timer), HELLO_TIMEOUT_MS)
    return () => {
      frame?.removeEventListener('load', hello)
      clearInterval(timer)
      clearTimeout(giveUp)
    }
  }, [connected, targetOrigin])

  return {
    frameRef,
    src: frameSrc(artistId, customSiteUrl),
    applyField,
    applyImage,
    applyStyle,
    applyLink,
    applyCursor,
    replayMotion,
    setPlayback,
    applyHighlight,
    clearHighlight,
    setMode,
    frameMode,
    manifest,
    selectedStyle,
    selectedLink,
    selectedRegion,
    deselectedAt,
  }
}
