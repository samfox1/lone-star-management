/**
 * The FRAME side of the bridge, for the BUILT-IN edit-frame route — now a thin wrapper
 * over `@lone-star/site-bridge/frame` (2026-08-07 consolidation).
 *
 * This file used to be a full parallel implementation, and the review that retired it
 * found five documented divergences already grown between the copies — all in the
 * package's favour, each one a lesson skeen's frame had learned that this copy hadn't:
 *
 *   • a section apply no longer slams a wrapped video's playback speed back to 1×
 *     (speed is reset only by the region that OWNS it);
 *   • appliers and highlight hit EVERY matching element, not querySelector's first
 *     (the five-polaroid-captions / socials-in-two-places lesson);
 *   • an image URL landing on a placeholder <div> swaps it for a real <img> instead of
 *     printing the URL as text over the page (cinematic's unfilled hero);
 *   • malformed editor messages are dropped by the strField guard instead of writing
 *     the string "undefined" into the DOM;
 *   • selector values are escaped, and declared bases can be injected for the
 *     snapshot (unused by the built-in frame today — its regions carry their bases in
 *     markup — so the package default, snapshotting the live class attribute, is
 *     exactly this file's old behaviour).
 *
 * The wrapper keeps this module's export surface so no caller or test changed paths;
 * `mountFrameBridge` adapts the old options shape onto the package's (the built-in
 * frame renders its draft server-side, so `init-data` is a no-op here).
 */
import {
  mountFrameBridge as mountPackageBridge,
  type InboundEditorMessage,
} from '@lone-star/site-bridge/frame'
import type { TemplateManifest } from '@lone-star/site-bridge/manifest'

export {
  READY_RETRY_MS,
  READY_RETRIES,
  markedAncestor,
  targetOf,
  rectOf,
  applyFieldToDom,
  applyImageToDom,
  applyStyleToDom,
  applyLinkToDom,
  highlightSelector,
  applyHighlightToDom,
  clearHighlightFromDom,
} from '@lone-star/site-bridge/frame'

export function mountFrameBridge(options: {
  editorOrigin: string
  onEditorMessage?: (msg: InboundEditorMessage) => void
  target?: Window
  /**
   * The frame's manifest, announced on `ready` and consulted so `apply-field` knows a
   * TEXT field from an image one — without it a caption whose words happen to look like
   * a URL ("skeen.com") would be swapped for a broken <img>. The built-in frame passes
   * its template's local manifest; harmless editor-side, which only trusts a runtime
   * manifest for custom sites.
   */
  editList?: TemplateManifest
}): () => void {
  return mountPackageBridge({
    editorOrigin: options.editorOrigin,
    // The built-in frame server-renders the draft under RLS — it never consumes the
    // wire payload, so init-data (which the editor doesn't send same-origin anyway)
    // is acknowledged and dropped.
    onInitData: () => {},
    editList: options.editList,
    onEditorMessage: options.onEditorMessage,
    target: options.target,
  })
}
