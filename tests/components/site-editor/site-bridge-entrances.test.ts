// @vitest-environment jsdom
// Entrance animations, and the root-attribute guard that keeps a site from hiding its own
//   content.
/**
 * Slice-3 motion: the entrances runtime + the derived effects CSS. The load-bearing
 * safety rule is the ROOT-ATTRIBUTE GUARD: entrance hidden-states apply only under
 * `html[data-lse-entrances]`, which only the runtime sets — a site that ships the CSS
 * but never mounts the runtime must show everything, not hide content forever.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ENTRANCE_OPTIONS,
  ENTRANCE_SPEED_STEPS,
  ENTRANCE_TRAVEL_STEPS,
  HOVER_OPTIONS,
  effectsCss,
} from '@samfox1/site-bridge/vocabulary'
import { MANAGED_STYLE_PROPS } from '@samfox1/site-bridge/styles'
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

// rAF stubbed synchronous alongside: the runtime releases an element two frames after
// it intersects (so the hidden state PAINTS first — the anti-flash rule); tests want
// the outcome, not the frame timing.
const withIO = () => {
  vi.stubGlobal('IntersectionObserver', FakeIO)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (cb(0), 0))
}
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

  it('CRITICAL: on TEXT elements, Lift shadows the glyphs, not the container', () => {
    // A box-shadow around a heading draws a floating rectangle (Sam, 2026-08-11:
    // "It should be around the text when its applied to text").
    const css = effectsCss()
    const textRule = css.split('\n').find((l) => l.startsWith(':where(') && l.includes('.hover-lift:hover'))
    expect(textRule).toBeTruthy()
    expect(textRule).toContain('box-shadow:none')
    expect(textRule).toContain('text-shadow:')
    // Source order is the tiebreak (:where keeps specificity equal) — the text
    // override must come AFTER the box rule or it never wins.
    expect(css.indexOf(textRule!)).toBeGreaterThan(css.indexOf('.hover-lift:hover{'))
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

  it('CRITICAL: travel rides the custom property — off-screen entrances, nothing recompiled', () => {
    // The directional hidden states read the distance var (fade/zoom/blur do not
    // move, so travel is a silent no-op on them). Defaults preserve the pre-slider
    // look: 28px for the vertical pair, 36px for the slides.
    const css = effectsCss()
    expect(css).toContain('translateY(var(--lse-enter-distance, 28px))') // rise
    expect(css).toContain('translateY(calc(-1 * var(--lse-enter-distance, 28px)))') // fall
    expect(css).toContain('translateX(calc(-1 * var(--lse-enter-distance, 36px)))') // slide from the left
    expect(css).toContain('translateX(var(--lse-enter-distance, 36px))') // slide from the right
    expect(resolveStyle('enterdist-[480px]').style['--lse-enter-distance']).toBe('480px')
    expect(resolveStyle('enterdist-[100vw]').style['--lse-enter-distance']).toBe('100vw')
    // Derived from the step table (test rule #4): every step the slider offers must
    // lift, or a position on the knob silently does nothing.
    for (const s of ENTRANCE_TRAVEL_STEPS) {
      if (!s.value) continue
      expect(resolveStyle(s.value).style['--lse-enter-distance'], s.value).toBeTruthy()
    }
    // And the clear list can reset it, or a removed slider sticks forever.
    expect(MANAGED_STYLE_PROPS).toContain('--lse-enter-distance')
  })

  it('an armed document clips horizontal overflow — an off-screen "from" must not widen the page', () => {
    // A hidden state parked 100vw to the right adds a horizontal scrollbar for the
    // whole page until the element enters. Clipped only under the root attribute, so
    // a site that never mounts the runtime keeps its own overflow behaviour.
    expect(effectsCss()).toContain('html[data-lse-entrances]{overflow-x:clip}')
  })

  it('CRITICAL: hover colour — the marker rule is compiled, the hex lifts, the clear list can reset it', () => {
    const css = effectsCss()
    expect(css).toContain('.hovercolor:hover{color:var(--lse-hover-color')
    expect(css).toContain('.hovercolor{transition:color') // eases like every hover effect
    expect(resolveStyle('hovercolor-[#ff0055]').style['--lse-hover-color']).toBe('#ff0055')
    expect(resolveStyle('hovercolor').className).toBe('hovercolor') // marker survives as a class
    expect(MANAGED_STYLE_PROPS).toContain('--lse-hover-color')
  })

  it('entrance and hover classes SURVIVE resolution — compiled CSS, never lifted', () => {
    for (const o of [...ENTRANCE_OPTIONS, ...HOVER_OPTIONS]) {
      if (!o.value) continue
      expect(resolveStyle(o.value).className, o.value).toBe(o.value)
    }
  })
})

describe('mountEntrances — the runtime', () => {
  it('CRITICAL: the release is DEFERRED past a paint — sync release means no transition', () => {
    // The flash bug (Sam, 2026-08-11): the observer's initial callback fires in the
    // same frame as observe(); setting data-lse-entered there means the hidden state
    // never paints and the element pops instead of animating. The attribute must NOT
    // appear until the queued frames run.
    vi.stubGlobal('IntersectionObserver', FakeIO)
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (frames.push(cb), frames.length))
    const target = el('enter-rise')
    teardown = mountEntrances(document)
    FakeIO.instances[0].reveal(target)
    expect(target.hasAttribute(ENTERED_ATTR)).toBe(false) // still hidden this frame
    while (frames.length) frames.shift()!(0)
    expect(target.hasAttribute(ENTERED_ATTR)).toBe(true)
  })

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

  it('the speed scale reaches 4s and rests at a 1.2s default', () => {
    // "It moves way too fast" (Sam, 2026-08-12): with Travel able to start a full
    // screen away, 0.7s was violent and 2.0s the ceiling. The default is a real
    // point mid-scale, exactly once, and steps stay ordered low→high.
    expect(effectsCss()).toContain('var(--lse-enter-duration, 1.2s)')
    const defaults = ENTRANCE_SPEED_STEPS.filter((s) => s.value === '')
    expect(defaults).toHaveLength(1)
    expect(defaults[0].label).toBe('1.2s')
    const values = ENTRANCE_SPEED_STEPS.map((s) =>
      s.value === '' ? 1200 : Number(/\[(\d+)ms\]/.exec(s.value)![1]),
    )
    expect(Math.max(...values)).toBe(4000)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('CRITICAL: replay SNAPS back to hidden — a reverse transition replays only a sliver', () => {
    // Removing the entered attribute re-applies the hidden state THROUGH the
    // element's transition, so the element is still a few px into its journey back
    // when the re-release fires two frames later — the "entrance" then covers a
    // sliver of the distance and no slider number matches what plays. The replay
    // must suppress the transition while it re-hides, then release from the true
    // hidden state.
    withIO()
    const q: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (q.push(cb), q.length))
    const target = el('enter-rise')
    target.setAttribute('data-lse-style', 'hero_name')
    teardown = mountEntrances(document)
    const io = FakeIO.instances[0]
    io.reveal(target)
    q.splice(0).forEach((cb) => cb(0))
    q.splice(0).forEach((cb) => cb(0))
    expect(target.hasAttribute(ENTERED_ATTR)).toBe(true)

    replayEntrances(document, '[data-lse-style="hero_name"]')
    // The snap window: hidden again, transitions suppressed.
    expect(target.hasAttribute(ENTERED_ATTR)).toBe(false)
    expect(target.hasAttribute('data-lse-replaying')).toBe(true)
    q.splice(0).forEach((cb) => cb(0))
    q.splice(0).forEach((cb) => cb(0))
    expect(target.hasAttribute('data-lse-replaying')).toBe(false)
    expect(io.observed.has(target)).toBe(true)
    // And the sheet turns the attribute into "no transition" — without the rule the
    // attribute is decoration.
    expect(effectsCss()).toContain('[data-lse-replaying]{transition:none')
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

describe('the frame replays ALL entrances on replay-entrances', () => {
  it('CRITICAL: the toolbar message re-hides and re-arms every entranced element', () => {
    withIO()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (cb(0), 0))
    const a = el('enter-rise')
    const b = el('enter-fade')
    a.setAttribute(ENTERED_ATTR, '')
    b.setAttribute(ENTERED_ATTR, '')
    const stop = mountFrameBridge({
      editorOrigin: 'https://editor.test',
      onInitData: () => {},
      editList: { fields: [], slots: [], styles: [], links: [] },
      target: { postMessage: () => {} } as unknown as Window,
    })
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://editor.test',
        data: { v: BRIDGE_VERSION, source: EDITOR_SOURCE, type: 'replay-entrances' },
      }),
    )
    expect(a.hasAttribute(ENTERED_ATTR)).toBe(false)
    expect(b.hasAttribute(ENTERED_ATTR)).toBe(false)
    stop()
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
