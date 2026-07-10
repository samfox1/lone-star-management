/**
 * The FRAME side of the bridge (SITE_EDITOR_PLAN.md, phase 1). Runs inside the
 * edit-mode site frame: a click resolves to the nearest marked region and is
 * reported to the editor (the parent window) over the postMessage bridge; editor
 * messages (highlight / apply-field / set-device / refresh) are applied back.
 *
 * `markedAncestor` / `targetOf` / `rectOf` are pure DOM reads (unit-tested in
 * jsdom); `mountFrameBridge` wires the live listeners and is exercised in the
 * browser. No React here.
 */
import { FIELD_ATTR, ITEM_ATTR, SLOT_ATTR, parseItemMarker } from '@/lib/site-editor/markers'
import {
  type EditorMessage,
  type Rect,
  type SelectTarget,
  frameMessage,
  isEditorMessage,
} from '@/lib/site-editor/bridge'

const MARKED = `[${FIELD_ATTR}],[${SLOT_ATTR}],[${ITEM_ATTR}]`

/** The nearest ancestor (or self) carrying any `data-lse-*` marker, or null. An
 *  inner item wins over its enclosing slot because `closest` walks up. */
export function markedAncestor(el: Element): Element | null {
  return el.closest(MARKED)
}

/** The SelectTarget a marked element represents (field > item > slot), or null if
 *  its marker is malformed. */
export function targetOf(marked: Element): SelectTarget | null {
  const field = marked.getAttribute(FIELD_ATTR)
  if (field) return { kind: 'field', key: field }
  const item = marked.getAttribute(ITEM_ATTR)
  if (item !== null) {
    const parsed = parseItemMarker(item)
    return parsed ? { kind: 'item', assetType: parsed.assetType, id: parsed.id } : null
  }
  const slot = marked.getAttribute(SLOT_ATTR)
  if (slot) return { kind: 'slot', key: slot }
  return null
}

/** A region's viewport box, for the editor's selection overlay. */
export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/** Optimistically apply an edited field value into the frame's DOM: an image
 *  field updates its `src`, any other (text) field updates its text. No-op if the
 *  field isn't present. Keys are identifier-safe, so plain attribute selection. */
export function applyFieldToDom(root: ParentNode, key: string, value: string): void {
  const el = root.querySelector(`[${FIELD_ATTR}="${key}"]`)
  if (!el) return
  if (el instanceof HTMLImageElement) el.src = value
  else el.textContent = value
}

/**
 * Wire the live frame bridge. Reports selects to `target` (default the parent
 * window), and applies editor messages onto the DOM. Returns a teardown. The
 * caller (the edit-mode client) passes the trusted editor origin; we only act on
 * messages from it.
 */
export function mountFrameBridge(options: {
  editorOrigin: string
  onEditorMessage?: (msg: EditorMessage) => void
  target?: Window
}): () => void {
  const target = options.target ?? window.parent

  const post = (msg: object) => target.postMessage(msg, options.editorOrigin)

  const onClick = (e: MouseEvent) => {
    const el = e.target as Element | null
    const marked = el && markedAncestor(el)
    if (!marked) return post(frameMessage({ type: 'deselect' }))
    // In edit mode a click SELECTS the region; don't let it navigate / submit.
    e.preventDefault()
    const sel = targetOf(marked)
    if (sel) post(frameMessage({ type: 'select', target: sel, rect: rectOf(marked) }))
  }

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== options.editorOrigin || !isEditorMessage(e.data)) return
    // apply-field updates the DOM here (generic frame behaviour); everything else
    // goes to the caller.
    if (e.data.type === 'apply-field') applyFieldToDom(document, e.data.key, e.data.value)
    else options.onEditorMessage?.(e.data)
  }

  document.addEventListener('click', onClick, true)
  window.addEventListener('message', onMessage)
  post(frameMessage({ type: 'ready' }))

  return () => {
    document.removeEventListener('click', onClick, true)
    window.removeEventListener('message', onMessage)
  }
}
