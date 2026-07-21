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
import { FIELD_ATTR, ITEM_ATTR, LINK_ATTR, SLOT_ATTR, STYLE_ATTR, parseItemMarker } from '@/lib/site-editor/markers'
import {
  type EditorMessage,
  type Rect,
  type SelectTarget,
  frameMessage,
  isEditorMessage,
} from '@/lib/site-editor/bridge'

const MARKED = `[${FIELD_ATTR}],[${SLOT_ATTR}],[${ITEM_ATTR}],[${STYLE_ATTR}],[${LINK_ATTR}]`

/** The nearest ancestor (or self) carrying any `data-lse-*` marker, or null. An
 *  inner item wins over its enclosing slot because `closest` walks up. */
export function markedAncestor(el: Element): Element | null {
  return el.closest(MARKED)
}

/** The SelectTarget a marked element represents (field > item > slot > style > link),
 *  or null if its marker is malformed. Style/link are lowest so an element that is BOTH
 *  content and re-styleable/link-powered selects its content on click; its style/link is
 *  reached from the inspector (which reads the element's marker alongside). */
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
  const style = marked.getAttribute(STYLE_ATTR)
  if (style) return { kind: 'style', key: style }
  const link = marked.getAttribute(LINK_ATTR)
  if (link) return { kind: 'link', key: link }
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

/** Optimistically apply an edited class string onto the styled region. REPLACE
 *  semantics (D-B): the stored string is the region's full class set, so we swap
 *  the element's `class` wholesale. No-op if the region isn't present. Region keys
 *  A ':' in a per-item key is fine inside a quoted attribute selector. */
export function applyStyleToDom(root: ParentNode, key: string, className: string): void {
  const el = root.querySelector(`[${STYLE_ATTR}="${key}"]`)
  if (!el) return
  el.setAttribute('class', className)
}

/** Optimistically set a link-powered element's href by key. No-op if the region isn't
 *  present. A blank url clears the href (the button falls back to inert). */
export function applyLinkToDom(root: ParentNode, key: string, url: string): void {
  const el = root.querySelector(`[${LINK_ATTR}="${key}"]`)
  if (!el) return
  if (url) el.setAttribute('href', url)
  else el.removeAttribute('href')
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
    else if (e.data.type === 'apply-style') applyStyleToDom(document, e.data.key, e.data.className)
    else if (e.data.type === 'apply-link') applyLinkToDom(document, e.data.key, e.data.url)
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
