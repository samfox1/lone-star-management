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
import type { LibraryAsset } from '@/lib/site-editor/manifest'

/** Bump when the message shape changes incompatibly; both sides pin to it. */
export const BRIDGE_VERSION = 1

export const FRAME_SOURCE = 'lse-frame'
export const EDITOR_SOURCE = 'lse-editor'

/** A region's on-screen box, for drawing the editor's selection overlay. */
export type Rect = { x: number; y: number; width: number; height: number }

/** What the user selected in the frame (maps to a manifest field / slot / item). */
export type SelectTarget =
  | { kind: 'field'; key: string }
  | { kind: 'slot'; key: string }
  | { kind: 'item'; assetType: LibraryAsset; id: string }

/** frame → editor. */
export type FrameMessage =
  | { v: number; source: typeof FRAME_SOURCE; type: 'ready' }
  | { v: number; source: typeof FRAME_SOURCE; type: 'select'; target: SelectTarget; rect: Rect }
  | { v: number; source: typeof FRAME_SOURCE; type: 'geometry'; target: SelectTarget; rect: Rect }
  | { v: number; source: typeof FRAME_SOURCE; type: 'deselect' }

/** editor → frame. */
export type EditorMessage =
  | { v: number; source: typeof EDITOR_SOURCE; type: 'apply-field'; key: string; value: string }
  | { v: number; source: typeof EDITOR_SOURCE; type: 'highlight'; target: SelectTarget | null }
  | { v: number; source: typeof EDITOR_SOURCE; type: 'set-device'; device: 'desktop' | 'mobile' }
  | { v: number; source: typeof EDITOR_SOURCE; type: 'refresh' }

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

/** Stamp the current version + source onto a frame message payload. */
export function frameMessage<T extends Omit<FrameMessage, 'v' | 'source'>>(
  msg: T,
): T & { v: number; source: typeof FRAME_SOURCE } {
  return { ...msg, v: BRIDGE_VERSION, source: FRAME_SOURCE }
}

/** Stamp the current version + source onto an editor message payload. */
export function editorMessage<T extends Omit<EditorMessage, 'v' | 'source'>>(
  msg: T,
): T & { v: number; source: typeof EDITOR_SOURCE } {
  return { ...msg, v: BRIDGE_VERSION, source: EDITOR_SOURCE }
}
