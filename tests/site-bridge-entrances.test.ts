// @vitest-environment jsdom
/**
 * Slice-3 motion: the entrances runtime + the derived effects CSS. The load-bearing
 * safety rule is the ROOT-ATTRIBUTE GUARD: entrance hidden-states apply only under
 * `html[data-lse-entrances]`, which only the runtime sets — a site that ships the CSS
 * but never mounts the runtime must show everything, not hide content forever.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ENTRANCE_OPTIONS,
  HOVER_OPTIONS,
  effectsCss,
} from '@samfox1/site-bridge/vocabulary'
import {
  ENTERED_ATTR,
  ENTRANCES_ROOT_ATTR,
  mountEntrances,
  replayEntrances,
} from '@samfox1/site-bridge/entrances'
import { BRIDGE_VERSION, EDITOR_SOURCE, mountFrameBridge, resolveStyle } from '@samfox1/site-bridge'

/** A controllable IntersectionObserver: tests fire visibility by hand. */
class FakeIO {
  static instances: FakeIO[] = []
  observed = new Set<Element>()
  constructor(private cb: IntersectionObserverCallback) {
    FakeIO.instances.push(this)
  }
  observe(el: Element) {
    this.observed.add(el)
  }
  unobserve(el: Element) {
    this.observed.delete(el)
  }
  disconnect() {
    this.observed.clear()
  }
  takeRecords() { return [] }
  root = null
  rootMargin = ''
  thresholds = []
  reveal(el: Element) {
    this.cb([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

let teardown: (() => void) | null = null
afterEach(() => {
  teardown?.()
  teardown = null
  FakeIO.instances = []
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute(ENTRANCES_ROOT_ATTR)
})

const withIO = () => vi.stubGlobal('IntersectionObserver', FakeIO)
const el = (cls: string) => {
  const d = document.createElement('div')
  d.className = cls
  document.body.appendChild(d)
  return d
}

describe('effectsCss — the derived rules', () => {
  it('CRITICAL: every entrance hidden-state is GUARDED by the runtime root attribute', () => {
    // Without the guard, a site that compiles tokens.css but never mounts the runtime
    // hides every entranced element forever — the worst failure this feature has.
    const css = effectsCss()
    for (const o of ENTRANCE_OPTIONS) {
      if (!o.value) continue
      expect(css, o.value).toContain(`html[${ENTRANCES_ROOT_ATTR}] .${o.value}:not([${ENTERED_ATTR}])`)
      expect(css, `${o.value} transition`).toContain(`.${o.value}{transition:`)
    }
  })

  it('every hover option has a :hover rule, and speed rides the custom property', () => {
    const css = effectsCss()
    for (const o of HOVER_OPTIONS) {
      if (!o.value) continue
      expect(css, o.value).toContain(`.${o.value}:hover{`)
    }
    expect(css).toContain('var(--lse-enter-duration')
    expect(resolveStyle('enterdur-[400ms]').style['--lse-enter-duration']).toBe('400ms')
  })

  it('entrance and hover classes SURVIVE resolution — compiled CSS, never lifted', () => {
    for (const o of [...ENTRANCE_OPTIONS, ...HOVER_OPTIONS]) {
      if (!o.value) continue
      expect(resolveStyle(o.value).className, o.value).toBe(o.value)
    }
  })
})

describe('mountEntrances — the runtime', () => {
  it('CRITICAL: arms the document, releases an element when it intersects, once', () => {
    withIO()
    const target = el('enter-rise')
    teardown = mountEntrances(document)
    expect(document.documentElement.hasAttribute(ENTRANCES_ROOT_ATTR)).toBe(true)
    const io = FakeIO.instances[0]
    expect(io.observed.has(target)).toBe(true)
    io.reveal(target)
    expect(target.hasAttribute(ENTERED_ATTR)).toBe(true)
    expect(io.observed.has(target)).toBe(false) // once — no replay on re-entry
  })

  it('CRITICAL: no IntersectionObserver → the document is NEVER armed (content stays visible)', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    el('enter-fade')
    teardown = mountEntrances(document)
    expect(document.documentElement.hasAttribute(ENTRANCES_ROOT_ATTR)).toBe(false)
  })

  it('an element ADDED after mount joins the watch', async () => {
    withIO()
    teardown = mountEntrances(document)
    const late = el('enter-zoom')
    await vi.waitFor(() => expect(FakeIO.instances[0].observed.has(late)).toBe(true))
  })

  it('a class applied by the EDITOR after mount joins the watch', async () => {
    withIO()
    const plain = el('font-serif')
    teardown = mountEntrances(document)
    plain.className = 'font-serif enter-fade'
    await vi.waitFor(() => expect(FakeIO.instances[0].observed.has(plain)).toBe(true))
  })

  it('remount replaces; a stale handle cannot unregister the current mount', () => {
    withIO()
    const t1 = mountEntrances(document)
    teardown = mountEntrances(document)
    t1()
    expect(document.documentElement.hasAttribute(ENTRANCES_ROOT_ATTR)).toBe(true)
  })

  it('replayEntrances re-hides and re-arms the matching element', () => {
    withIO()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (cb(0), 0))
    const target = el('enter-rise')
    target.setAttribute('data-lse-style', 'hero_name')
    teardown = mountEntrances(document)
    const io = FakeIO.instances[0]
    io.reveal(target)
    expect(target.hasAttribute(ENTERED_ATTR)).toBe(true)
    replayEntrances(document, '[data-lse-style="hero_name"]')
    expect(target.hasAttribute(ENTERED_ATTR)).toBe(false)
    expect(io.observed.has(target)).toBe(true)
  })
})

describe('the frame replays an entrance when the editor applies one', () => {
  it('CRITICAL: apply-style with an enter class re-runs the animation for that region', () => {
    withIO()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (cb(0), 0))
    const region = el('enter-rise')
    region.setAttribute('data-lse-style', 'hero_name')
    region.setAttribute(ENTERED_ATTR, '')
    const stop = mountFrameBridge({
      editorOrigin: 'https://editor.test',
      onInitData: () => {},
      editList: { fields: [], slots: [], styles: [{ key: 'hero_name', label: 'Hero' }], links: [] },
      target: { postMessage: () => {} } as unknown as Window,
      regionBase: () => '',
    })
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://editor.test',
        data: { v: BRIDGE_VERSION, source: EDITOR_SOURCE, type: 'apply-style', key: 'hero_name', className: 'enter-rise' },
      }),
    )
    expect(region.hasAttribute(ENTERED_ATTR)).toBe(false)
    stop()
  })
})
