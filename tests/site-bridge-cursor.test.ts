// @vitest-environment jsdom
/**
 * Site-wide cursor + trail (2026-08-11). DB-free: the settings mappers, the DOM
 * applier's contract (cursor value, click swap, trail layer lifecycle, idempotency),
 * the frame's `apply-cursor` / `init-data` routing, and the editor-side value gate
 * (cursorValueError) that stands between the Site panel and the CSS url() sink.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  CURSOR_CONTENT_KEYS,
  CURSOR_TRAIL_STYLES,
  applyCursor,
  cursorSettingsFrom,
  needsDownscale,
  normalizeCursorSettings,
  type CursorSettings,
} from '@samfox1/site-bridge/cursor'
import { BRIDGE_VERSION, EDITOR_SOURCE, mountFrameBridge } from '@samfox1/site-bridge'
import { CURSOR_KEYS, cursorValueError } from '@/lib/site-content-schema'

const NONE: CursorSettings = { image: '', clickImage: '', trail: '', trailColor: '' }
const at = (x: number, y: number) => new MouseEvent('pointermove', { clientX: x, clientY: y })

afterEach(() => {
  applyCursor(document, NONE) // tear down whatever a test mounted
  document.body.innerHTML = ''
})

describe('cursor settings mappers', () => {
  it('CRITICAL: cursorSettingsFrom reads the four content keys — and degrades an unknown trail', () => {
    // An older deployed site fed a trail style it predates must render "no trail",
    // never throw or pass junk into the DOM path.
    const s = cursorSettingsFrom({
      [CURSOR_CONTENT_KEYS.image]: 'https://x.test/c.png',
      [CURSOR_CONTENT_KEYS.click]: 'https://x.test/k.png',
      [CURSOR_CONTENT_KEYS.trail]: 'dots',
      [CURSOR_CONTENT_KEYS.trailColor]: '#ff0000',
    })
    expect(s).toEqual({ image: 'https://x.test/c.png', clickImage: 'https://x.test/k.png', trail: 'dots', trailColor: '#ff0000' })
    expect(cursorSettingsFrom({ [CURSOR_CONTENT_KEYS.trail]: 'lasers' }).trail).toBe('')
    expect(cursorSettingsFrom(null)).toEqual(NONE)
  })

  it('normalizeCursorSettings survives wire junk', () => {
    expect(normalizeCursorSettings(null)).toEqual(NONE)
    expect(normalizeCursorSettings({ image: 7, trail: 'sparkles', extra: true })).toEqual({
      ...NONE,
      trail: 'sparkles',
    })
  })

  it('the schema registry and the package agree on the key names', () => {
    // Derived, not copied — if this fails someone forked the key list.
    expect([...CURSOR_KEYS].sort()).toEqual(Object.values(CURSOR_CONTENT_KEYS).sort())
  })
})

describe('applyCursor — the DOM contract', () => {
  it('CRITICAL: sets the cursor to the image URL and clears it on empty settings', () => {
    applyCursor(document, { ...NONE, image: 'https://x.test/c.png' })
    expect(document.documentElement.style.cursor).toContain('https://x.test/c.png')
    applyCursor(document, NONE)
    expect(document.documentElement.style.cursor).toBe('')
  })

  it('CRITICAL: swaps to the click image on pointerdown and back on pointerup', () => {
    applyCursor(document, { ...NONE, image: 'https://x.test/c.png', clickImage: 'https://x.test/k.png' })
    document.dispatchEvent(new Event('pointerdown'))
    expect(document.documentElement.style.cursor).toContain('k.png')
    document.dispatchEvent(new Event('pointerup'))
    expect(document.documentElement.style.cursor).toContain('c.png')
  })

  it('pointercancel and window blur ALSO restore the resting cursor', () => {
    // A touch-scroll fires pointercancel, dragging out of the window fires blur —
    // without these two the click cursor sticks permanently after either.
    const settings = { ...NONE, image: 'https://x.test/c.png', clickImage: 'https://x.test/k.png' }
    applyCursor(document, settings)
    document.dispatchEvent(new Event('pointerdown'))
    document.dispatchEvent(new Event('pointercancel'))
    expect(document.documentElement.style.cursor).toContain('c.png')
    document.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('blur'))
    expect(document.documentElement.style.cursor).toContain('c.png')
  })

  it('CRITICAL: teardown removes the click listeners, not just the layers', () => {
    // The idempotency promise is about LISTENERS too: a stale pointerdown handler from
    // a previous mount would write its old clickValue over whatever is applied now.
    applyCursor(document, { ...NONE, image: 'https://x.test/c.png', clickImage: 'https://x.test/k.png' })
    applyCursor(document, NONE)
    document.dispatchEvent(new Event('pointerdown'))
    expect(document.documentElement.style.cursor).toBe('')
  })

  it('CRITICAL: a dots trail spawns fading nodes as the pointer moves', () => {
    applyCursor(document, { ...NONE, trail: 'dots', trailColor: '#00ff00' })
    const layer = document.querySelector('[data-lse-cursor-trail="dots"]')
    expect(layer).not.toBeNull()
    document.dispatchEvent(at(40, 30))
    expect(layer!.childElementCount).toBe(1)
    const dot = layer!.firstElementChild as HTMLElement
    expect(dot.style.background).toBe('rgb(0, 255, 0)') // jsdom normalizes hex
    expect(dot.style.left).toBe('40px')
  })

  it('re-applying replaces the mount — one layer, never a stack', () => {
    applyCursor(document, { ...NONE, trail: 'dots' })
    applyCursor(document, { ...NONE, trail: 'sparkles' })
    expect(document.querySelectorAll('[data-lse-cursor-trail]')).toHaveLength(1)
    expect(document.querySelector('[data-lse-cursor-trail="sparkles"]')).not.toBeNull()
    applyCursor(document, NONE)
    expect(document.querySelector('[data-lse-cursor-trail]')).toBeNull()
  })

  it('CRITICAL: a STALE teardown handle cannot unregister the current mount', () => {
    // t1 belongs to a mount that was already replaced. If calling it deletes the
    // CURRENT registration, the next applyCursor finds nothing to tear down and the
    // replaced mount's layer + listeners leak forever.
    const t1 = applyCursor(document, { ...NONE, trail: 'dots' })
    applyCursor(document, { ...NONE, trail: 'sparkles' })
    t1() // stale — its cleanups already ran; it must not touch the registry
    applyCursor(document, NONE)
    expect(document.querySelector('[data-lse-cursor-trail]')).toBeNull()
  })

  it('an image trail with no cursor image degrades to no trail at all', () => {
    applyCursor(document, { ...NONE, trail: 'image' })
    expect(document.querySelector('[data-lse-cursor-trail]')).toBeNull()
  })

  it('a line trail mounts its canvas and survives movement without a 2d context', () => {
    // jsdom has no canvas backend; the draw loop must no-op, not throw.
    applyCursor(document, { ...NONE, trail: 'line' })
    const canvas = document.querySelector('canvas[data-lse-cursor-trail="line"]')
    expect(canvas).not.toBeNull()
    expect(() => document.dispatchEvent(at(10, 10))).not.toThrow()
  })

  it('the downscale decision: anything over 64px on either edge gets redrawn', () => {
    // Only the PURE half is pinnable: jsdom's Image never fires onload, so the loader
    // around it (fittedCursorUrl — canvas redraw, taint fallback, the !pressed
    // re-apply guard) runs untested here. Browsers ignore cursor images past ~128px
    // and often cap at 32, so a wrong decision means a silent default arrow.
    expect(needsDownscale(64, 64)).toBe(false)
    expect(needsDownscale(65, 64)).toBe(true)
    expect(needsDownscale(32, 200)).toBe(true)
  })

  it('every declared trail style actually mounts something', () => {
    // Registry-derived (rule 4): a style added to the package that the applier
    // silently ignores would pass every hand-picked case above.
    for (const trail of CURSOR_TRAIL_STYLES) {
      applyCursor(document, { ...NONE, image: 'https://x.test/c.png', trail })
      expect(document.querySelector('[data-lse-cursor-trail]'), trail).not.toBeNull()
    }
  })
})

describe('the frame routes cursor messages to the applier', () => {
  const editorSays = (msg: Record<string, unknown>) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://editor.test',
        data: { v: BRIDGE_VERSION, source: EDITOR_SOURCE, ...msg },
      }),
    )
  const mount = () =>
    mountFrameBridge({
      editorOrigin: 'https://editor.test',
      onInitData: () => {},
      editList: { fields: [], slots: [], styles: [], links: [] },
      target: { postMessage: () => {} } as unknown as Window,
    })

  it('CRITICAL: apply-cursor reaches the document', () => {
    const teardown = mount()
    editorSays({ type: 'apply-cursor', settings: { image: 'https://x.test/via-msg.png' } })
    expect(document.documentElement.style.cursor).toContain('via-msg.png')
    teardown()
  })

  it('CRITICAL: init-data applies the cursor from site_content — no panel touch needed', () => {
    const teardown = mount()
    editorSays({
      type: 'init-data',
      site: { site_content: { [CURSOR_CONTENT_KEYS.image]: 'https://x.test/via-init.png' } },
    })
    expect(document.documentElement.style.cursor).toContain('via-init.png')
    teardown()
  })
})

describe('cursorValueError — the write gate', () => {
  it('CRITICAL: only an https URL can become a cursor image', () => {
    // These strings end up inside `cursor: url("…")` on the artist's site.
    expect(cursorValueError(CURSOR_CONTENT_KEYS.image, 'https://x.test/c.png')).toBeNull()
    // http:// included: mixed content on an https site is silently dropped by the
    // browser, so letting it store would ship an invisible failure.
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://x/c.png', 'http://x.test/c.png', 'https://x.test/a b', 'https://x.test/",evil']) {
      expect(cursorValueError(CURSOR_CONTENT_KEYS.image, bad), bad).not.toBeNull()
      expect(cursorValueError(CURSOR_CONTENT_KEYS.click, bad), bad).not.toBeNull()
    }
  })

  it('trail must be a declared style; color must be a hex; blank always clears', () => {
    for (const style of CURSOR_TRAIL_STYLES) expect(cursorValueError(CURSOR_CONTENT_KEYS.trail, style)).toBeNull()
    expect(cursorValueError(CURSOR_CONTENT_KEYS.trail, 'confetti')).not.toBeNull()
    expect(cursorValueError(CURSOR_CONTENT_KEYS.trailColor, '#9c4221')).toBeNull()
    expect(cursorValueError(CURSOR_CONTENT_KEYS.trailColor, 'red')).not.toBeNull()
    for (const key of CURSOR_KEYS) expect(cursorValueError(key, '')).toBeNull()
    expect(cursorValueError('cursor_bogus', 'x')).not.toBeNull()
  })
})
