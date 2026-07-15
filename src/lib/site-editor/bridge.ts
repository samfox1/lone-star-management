/**
 * The BRIDGE protocol between the editor shell and the site FRAME
 * (SITE_EDITOR_PLAN.md). The real site loads in an embedded frame in edit mode;
 * the editor and the frame are separate documents, so they talk over
 * `postMessage` with these typed, versioned messages.
 *
 * Two directions, discriminated by `source` so each side ignores its own echoes
 * and stray messages from other scripts:
 *   frame  → editor : LSE_FRAME  (a click on a marked region, live geometry)
 *   editor → frame  : LSE_EDITOR (apply an optimistic value, highlight, device)
 *
 * Types only + pure guards here — no `window` / `postMessage` calls, so it imports
 * cleanly server-side and in tests. Phase 2 wires the actual message plumbing (and
 * MUST also check `event.origin` — the `source`/version guards below are a shape
 * check, not an origin check).
 */
import type { LibraryAsset, TemplateManifest } from '@/lib/site-editor/manifest'
import type { PublicSitePayload } from '@/lib/site'

/** Bump when the message shape changes incompatibly; both sides pin to it. */
export const BRIDGE_VERSION = 2

export const FRAME_SOURCE = 'lse-frame'
export const EDITOR_SOURCE = 'lse-editor'

/** A region's on-screen box, for drawing the editor's selection overlay. */
export type Rect = { x: number; y: number; width: number; height: number }

/** What the user selected in the frame (maps to a manifest field / slot / item /
 *  style region). */
export type SelectTarget =
  | { kind: 'field'; key: string }
  | { kind: 'slot'; key: string }
  | { kind: 'item'; assetType: LibraryAsset; id: string }
  | { kind: 'style'; key: string }

/** frame → editor. A custom site carries its own edit-list (manifest) on `ready`,
 *  so the editor never hardcodes a custom site's regions (SITE_STYLING_PLAN.md D-D).
 *
 *  This union is exactly what is SENT today. A `geometry` variant (live scroll/resize
 *  tracking) was declared here with no sender and no receiver and has been removed —
 *  add it back with the selection overlay that needs it, since only then is its shape
 *  knowable. `select` already carries a `rect`. */
export type FrameMessage =
  | { v: number; source: typeof FRAME_SOURCE; type: 'ready'; manifest?: TemplateManifest }
  | { v: number; source: typeof FRAME_SOURCE; type: 'select'; target: SelectTarget; rect: Rect }
  | { v: number; source: typeof FRAME_SOURCE; type: 'deselect' }

/** editor → frame. `init-data` hands the frame its draft so a custom site in edit
 *  mode renders it without its own DB access (D-C); `apply-style` previews a
 *  class-string change optimistically before the debounced save.
 *
 *  `init-data` carries the WIRE shape (`PublicSitePayload` — what get_public_site
 *  returns), NOT `SiteData`. A custom site resolves media paths against its own
 *  Supabase URL, so it needs the raw `path`; `SiteData` has already replaced that
 *  with a lone-star-built `url` and would blank every image. Only custom sites
 *  consume this — the built-in `/edit-frame` reads its own draft server-side.
 *
 *  Like FrameMessage, this is exactly what is SENT today. `highlight`, `set-device`
 *  and `refresh` were declared here with no sender and no receiver in either repo and
 *  have been removed. Deleting them was free: skeen's own copy of this protocol
 *  (`lib/frameBridge.ts`) names only apply-field / apply-style / init-data and routes
 *  anything else through an open `{ type: string }` catch-all, so those three never
 *  reached the wire and BRIDGE_VERSION does not move. `set-device` in particular
 *  described a design the viewport-scaling frame replaced — the editor resizes the
 *  iframe itself and the site just reflows. */
export type EditorMessage =
  | { v: number; source: typeof EDITOR_SOURCE; type: 'apply-field'; key: string; value: string }
  | { v: number; source: typeof EDITOR_SOURCE; type: 'apply-style'; key: string; className: string }
  | { v: number; source: typeof EDITOR_SOURCE; type: 'init-data'; site: PublicSitePayload }

function isVersionedFrom(x: unknown, source: string): x is { v: number; source: string; type: string } {
  if (typeof x !== 'object' || x === null) return false
  const m = x as Record<string, unknown>
  return m.source === source && m.v === BRIDGE_VERSION && typeof m.type === 'string'
}

/** True iff `x` is a bridge message from the frame at the current version. Callers
 *  must still validate `event.origin` before trusting the payload. */
export function isFrameMessage(x: unknown): x is FrameMessage {
  return isVersionedFrom(x, FRAME_SOURCE)
}

/** True iff `x` is a bridge message from the editor at the current version. */
export function isEditorMessage(x: unknown): x is EditorMessage {
  return isVersionedFrom(x, EDITOR_SOURCE)
}

// Distributive Omit — `Omit<Union, K>` collapses a union to its shared keys, which
// would drop variant-specific props (target/rect/key/value); distribute instead.
type Payload<T> = T extends unknown ? Omit<T, 'v' | 'source'> : never

/** Stamp the current version + source onto a frame message payload. */
export function frameMessage(msg: Payload<FrameMessage>): FrameMessage {
  return { ...msg, v: BRIDGE_VERSION, source: FRAME_SOURCE } as FrameMessage
}

/** Stamp the current version + source onto an editor message payload. */
export function editorMessage(msg: Payload<EditorMessage>): EditorMessage {
  return { ...msg, v: BRIDGE_VERSION, source: EDITOR_SOURCE } as EditorMessage
}
