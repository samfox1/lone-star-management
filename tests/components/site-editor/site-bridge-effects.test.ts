// @vitest-environment jsdom
/**
 * The 0.40.0 effects: Glitch and Magnetic on hover, the tap family for touch, the kids
 * marker that points a rule at a container's children, and the runtime that feeds
 * Magnetic and wakes iOS's `:active`.
 */
import { describe, expect, it } from 'vitest'
import { effectsCss, HOVER_OPTIONS, KIDS_CLASS, TAP_OPTIONS } from '@samfox1/site-bridge/vocabulary'
import { familyOf, resolveStyle } from '@samfox1/site-bridge/styles'
import { mountEffects } from '@samfox1/site-bridge/effects'

describe('effectsCss — the 0.40.0 rules', () => {
  const css = effectsCss()

  it('CRITICAL: every tap option has an :active rule, under hover:none, in both forms', () => {
    const touch = css.slice(css.indexOf('@media (hover: none){'))
    for (const o of TAP_OPTIONS) {
      if (!o.value) continue
      expect(touch, o.value).toContain(`.${o.value}:where(:not(.${KIDS_CLASS})):active,.${KIDS_CLASS}.${o.value} > :active{`)
    }
    // A mouse click never plays one: the whole family sits under the touch query.
    expect(css.indexOf('.tap-press:where')).toBeGreaterThan(css.indexOf('@media (hover: none){'))
  })

  it('CRITICAL: the kids marker points a hover rule at the children, and never the container', () => {
    // A row with `lse-fx-kids hover-grow`: hovering an icon grows the icon; hovering the
    // row's own padding grows nothing, because the self rule excludes marked containers.
    expect(css).toContain(`.hover-grow:where(:not(.${KIDS_CLASS})):hover,.${KIDS_CLASS}.hover-grow > :hover{transform:scale(var(--lse-fx-scale, 1.05))}`)
  })

  it('CRITICAL: the dials ride vars with the old timings as fallbacks (0.40.0)', () => {
    // Speed: every hover transition's duration reads --lse-fx-speed (the "Hover speed"
    // slider lifts fxspeed-[Nms] inline). Unset, the fallback IS the old fixed timing,
    // so a site that never touches the dial renders exactly as before.
    expect(css).toContain('transition:transform var(--lse-fx-speed, 0.25s) ease,filter var(--lse-fx-speed, 0.25s) ease')
    // Magnet keeps its snappier default and its ease-out.
    expect(css).toContain('var(--lse-fx-speed, 0.12s) ease-out')
    // Amount: grow and tilt read --lse-fx-scale; shrink stays FIXED — "amount" means
    // how big it grows, and a grow-scaled shrink would silently invert.
    expect(css).toContain('rotate(2deg) scale(var(--lse-fx-scale, 1.02))')
    expect(css).toContain('transform:scale(0.95)')
    expect(css).not.toContain('shrink > :hover{transform:scale(var(')
  })

  it('glitch ghosts a text and an icon alike, and stills for reduced motion', () => {
    expect(css).toContain('.hover-glitch:where(:not(.lse-fx-kids)):hover,.lse-fx-kids.hover-glitch > :hover{text-shadow:-2px 0 var(--lse-glitch-a, #c63a2a),2px 0 var(--lse-glitch-b, #2ee6e6);animation:lse-jitter')
    // Light ghost first: chained drop-shadows compound, and this order hides the stray copy.
    expect(css).toContain('> :hover svg{filter:drop-shadow(3px 0 var(--lse-glitch-b, #2ee6e6)) drop-shadow(-3px 0 var(--lse-glitch-a, #c63a2a))}')
    expect(css).toContain('@keyframes lse-jitter{')
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\{\.hover-glitch[^}]*\{animation:none\}/)
  })

  it('every effect class SURVIVES resolution and has a family, so deltas store it', () => {
    for (const o of [...HOVER_OPTIONS, ...TAP_OPTIONS]) {
      if (!o.value) continue
      expect(resolveStyle(o.value).className, o.value).toBe(o.value)
      expect(familyOf(o.value), o.value).toBe(o.value.startsWith('tap-') ? 'tap' : 'hover')
    }
  })
})

describe('mountEffects — the runtime', () => {
  it('CRITICAL: listens for touchstart, so iOS applies :active at all', () => {
    const calls: string[] = []
    const orig = document.addEventListener.bind(document)
    document.addEventListener = ((type: string, ...rest: unknown[]) => {
      calls.push(type)
      return (orig as (...a: unknown[]) => void)(type, ...rest)
    }) as typeof document.addEventListener
    try {
      const off = mountEffects(document)
      expect(calls).toContain('touchstart')
      off()
    } finally {
      document.addEventListener = orig
    }
  })

  it('CRITICAL: magnetic leans a .hover-magnet toward the mouse, and rests when it leaves', () => {
    document.body.innerHTML = '<nav class="lse-fx-kids hover-magnet"><a id="a">Contact</a></nav><a id="lone" class="hover-magnet">x</a>'
    const a = document.getElementById('a')!
    a.getBoundingClientRect = () => ({ left: 100, top: 100, width: 100, height: 40, right: 200, bottom: 140, x: 100, y: 100, toJSON() {} }) as DOMRect
    const off = mountEffects(document)
    const move = (target: Element, x: number, y: number) =>
      target.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }), { pointerType: 'mouse' }))
    move(a, 190, 130) // 40px right, 10px below the centre (150,120)
    expect(a.style.getPropertyValue('--lse-magnet-x')).toBe('14.0px') // 40 * 0.35
    expect(a.style.getPropertyValue('--lse-magnet-y')).toBe('3.5px')
    // Off the element: the vars go, the transition carries it home.
    move(document.body, 0, 0)
    expect(a.style.getPropertyValue('--lse-magnet-x')).toBe('')
    // A finger is not a pointer that hovers: nothing written.
    a.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX: 190, clientY: 130 }), { pointerType: 'touch' }))
    expect(a.style.getPropertyValue('--lse-magnet-x')).toBe('')
    off()
    document.body.innerHTML = ''
  })
})

describe('the dial tokens lift inline and survive deltas', () => {
  it('CRITICAL: fxspeed/fxscale lift to the vars the rules read, and carry a family', () => {
    // The class never reaches the DOM; the var does — same shape as enterdur.
    expect(resolveStyle('fxspeed-[700ms]')).toEqual({ className: '', style: { '--lse-fx-speed': '700ms' } })
    expect(resolveStyle('fxscale-[1.02]')).toEqual({ className: '', style: { '--lse-fx-scale': '1.02' } })
    // Bracket prefixes are their own family, so a delta stores a dial move.
    expect(familyOf('fxspeed-[700ms]')).toBe('fxspeed')
    expect(familyOf('fxscale-[1.02]')).toBe('fxscale')
  })
})

describe('familyOf — the whole prefix is the family (0.40.0 site-declared effects)', () => {
  it("CRITICAL: a site's own hover-*/tap-* class routes into the family", () => {
    // The manifest channel (SiteStyleOptions.hoverEffects / .tapEffects) names classes
    // the shared vocabulary has never heard of; the PREFIX is what lets such a pick be
    // stored in a delta, swept by the select, and parked on read-back. An enum here
    // would silently drop every custom pick on save.
    expect(familyOf('hover-spin')).toBe('hover') // skeen's ×-turn
    expect(familyOf('hover-subtlegrow')).toBe('hover')
    expect(familyOf('tap-brackets')).toBe('tap')
  })

  it('CRITICAL: the hovercolor pair never sweeps into the hover family', () => {
    // Named WITHOUT a dash for exactly this reason (see motionControls); this pins the
    // naming so a rename cannot quietly hand both tokens to the effect select.
    expect(familyOf('hovercolor')).toBe('hovercolor')
    expect(familyOf('hovercolor-[#c63a2a]')).not.toBe('hover')
  })
})
