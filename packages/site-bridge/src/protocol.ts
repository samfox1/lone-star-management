/**
 * MOVED here from lone-star's `src/lib/site-editor/bridge.ts` verbatim
 * (SITE_BRIDGE_PLAN.md phase 1) — that path re-exports this module, so editor imports
 * are unchanged and a connected site imports the same file instead of mirroring it.
 */
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
import type { LibraryAsset, TemplateManifest } from './manifest'
import type { PublicSitePayload } from './payload'
import type { CursorSettings } from './cursor'

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
  | { kind: 'link'; key: string }

/** A stable string id for a SelectTarget — so a tile can compare itself against the
 *  region the frame reported a click on (matching → focused) without deep-equal. */
export function selectTargetKey(t: SelectTarget): string {
  return t.kind === 'item' ? `item:${t.assetType}:${t.id}` : `${t.kind}:${t.key}`
}

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
 *  `highlight` / `clear-highlight` drive the SELECTION overlay from the editor side:
 *  clicking an image tile in the inspector scrolls the matching region into view in the
 *  frame and outlines it (the reverse of the frame's `select`). They are ADDITIVE — a
 *  frame that doesn't handle them (skeen's current build routes unknown types through an
 *  open `{ type: string }` catch-all) simply ignores them, so BRIDGE_VERSION does not
 *  move. `set-device` and `refresh` were declared here once with no sender/receiver and
 *  stay deleted: the viewport-scaling frame resizes the iframe itself and reflows.
 *
 *  Like FrameMessage, this is exactly what is SENT today. */
/** What a click in the frame DOES. Additive to the protocol: a frame that predates this
 *  message ignores it and stays in `edit`, which is the old behaviour exactly. */
export type FrameMode = 'edit' | 'browse'

export type EditorMessage =
  | { v: number; source: typeof EDITOR_SOURCE; type: 'apply-field'; key: string; value: string }
  /** Repaint ONE image region (a slot placement) without waiting on the revalidate →
   *  full init-data chain — the largest message in the protocol was the only path an
   *  image change had to the preview (skeen brief, 2026-08-03). `url` '' clears it. */
  | { v: number; source: typeof EDITOR_SOURCE; type: 'apply-image'; key: string; url: string }
  | { v: number; source: typeof EDITOR_SOURCE; type: 'apply-style'; key: string; className: string }
  | { v: number; source: typeof EDITOR_SOURCE; type: 'apply-link'; key: string; url: string }
  /** Replay every entrance animation in the frame — the toolbar's "Replay motion".
   *  ADDITIVE: an older frame ignores it; the manager just reloads instead. */
  | { v: number; source: typeof EDITOR_SOURCE; type: 'replay-entrances' }
  /** Pause (false) / resume (true) every playing video in the frame — the toolbar's
   *  pause/play toggle. ADDITIVE like its siblings. */
  | { v: number; source: typeof EDITOR_SOURCE; type: 'set-playback'; playing: boolean }
  /** Re-apply the site-wide cursor (image / click image / trail) live in the preview.
   *  ADDITIVE: the four values are ordinary site_content keys, so a frame that predates
   *  this message still gets the cursor on the next init-data — this just skips the
   *  round trip. Settings are normalized on receipt (normalizeCursorSettings). */
  | { v: number; source: typeof EDITOR_SOURCE; type: 'apply-cursor'; settings: CursorSettings }
  | { v: number; source: typeof EDITOR_SOURCE; type: 'init-data'; site: PublicSitePayload }
  /** Outline + scroll a marked region into view in the frame (editor → frame). */
  | { v: number; source: typeof EDITOR_SOURCE; type: 'highlight'; target: SelectTarget }
  /** Drop the current highlight (the tile was deselected). */
  | { v: number; source: typeof EDITOR_SOURCE; type: 'clear-highlight' }
  /**
   * Whether a click in the frame SELECTS a region or works the site.
   *
   * In `edit` (the default) the frame swallows clicks on marked elements — capture
   * phase, preventDefault and stopImmediatePropagation — so selecting a region never
   * also fires the app underneath it. That was right for a single scrolling page and
   * wrong the moment a site has navigation: on a tabbed site (throwaway #2, 2026-08-10)
   * every click hit the tab BUTTON's style region and the manager could not reach their
   * own other tabs.
   *
   * `browse` stops the interception entirely, so the site behaves exactly as a fan sees
   * it — menus, multi-step flows and forms included. Deliberately a MODE rather than a
   * per-click prompt: a chooser would add a click to every selection, need the site to
   * declare which elements navigate, and still not carry anyone through a two-step flow.
   */
  | { v: number; source: typeof EDITOR_SOURCE; type: 'set-mode'; mode: FrameMode }
  /**
   * "I'm listening — announce yourself." The editor sends this once the iframe has
   * loaded, and the frame answers with `ready`.
   *
   * `ready` alone made the handshake a one-way race: whoever mounted second lost, the
   * message was dropped by the browser with no error, and the editor sat with no
   * manifest — "0 regions", every declared component missing, nothing to debug. Neither
   * side could tell "not connected yet" from "connected and empty".
   *
   * With both sides pushing, connecting no longer depends on who won. Additive: a frame
   * that predates it ignores an unknown type, so BRIDGE_VERSION does not move.
   */
  | { v: number; source: typeof EDITOR_SOURCE; type: 'hello' }

/**
 * Accept the current version and any OLDER one; refuse anything NEWER.
 *
 * An exact match makes the protocol un-bumpable in practice (skeen mirror diff,
 * 2026-08-04): the two sides are separate repos deployed separately, so whichever raises
 * BRIDGE_VERSION first starts dropping EVERY message from the other — `ready` included.
 * The frame then announces into the void and goes quiet with connected:false, which
 * looks identical to a wrong origin or a crashed frame and says nothing in the console.
 * Accepting older senders degrades a bump to "this one message type is ignored", which
 * is the failure mode the additive design already assumes.
 *
 * Newer is still refused: a future message may carry fields this side has no code for,
 * and acting on half-understood input is worse than ignoring it.
 */
function isVersionedFrom(x: unknown, source: string): x is { v: number; source: string; type: string } {
  if (typeof x !== 'object' || x === null) return false
  const m = x as Record<string, unknown>
  return (
    m.source === source &&
    typeof m.v === 'number' &&
    m.v <= BRIDGE_VERSION &&
    typeof m.type === 'string'
  )
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
