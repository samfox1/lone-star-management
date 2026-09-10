/**
 * PHONE-SCOPED CONTROLS: in the editor's mobile view, the Size and Padding controls
 * write `sizesm-[…]` / `padsm-[…]` — a second value that only applies below 640px —
 * instead of the desktop tokens. Same slider, device-scoped by context.
 *
 * The properties that keep the two scopes honest:
 *   - DISJOINT ownership. The desktop control must never own a phone token (editing
 *     desktop would silently delete the phone override) and vice versa.
 *   - Gated twice: the phone scope needs BOTH the phone view AND a 0.19+ site. An older
 *     site in phone view keeps the ordinary desktop-scoped controls.
 */
import { describe, expect, it } from 'vitest'
import {
  applyStyleValue,
  buildItemStyleControls,
  buildStyleControls,
  buildTextItemStyleControls,
  buildVideoItemStyleControls,
  readStyleValue,
  sliderIndex,
  sliderSteps,
  withStyleVars,
  type EditorStyleOptions,
  type StyleControl,
} from '@/lib/site-editor/style-controls'
import { cleanClassText } from '@/lib/site-editor/save'
import { bridgeSupportsMobileVars } from '@/lib/site-editor/manifest'

const byId = (controls: StyleControl[], id: string) => controls.find((c) => c.id === id)!

const onPhone = (version = '0.19.0'): EditorStyleOptions => ({
  ...withStyleVars({ fonts: [] }, version),
  mobileView: true,
})
const onDesktop = withStyleVars({ fonts: [] }, '0.19.0')

describe('the phone-scoped size control', () => {
  it('offers the ladder as sizesm tokens, labelled as before', () => {
    const c = byId(buildStyleControls(onPhone()), 'size')
    const offered = c.kind === 'select' ? c.options : []
    expect(offered.length).toBeGreaterThan(10)
    for (const o of offered.slice(1)) expect(o.value).toMatch(/^sizesm-\[\d+px\]$/)
  })

  it('carries the phoneScoped flag — the row renders a bold (Mobile) tag from it', () => {
    // Scope moved OFF the label text (Sam, 2026-08-17): the tag renders per-control,
    // bold and parenthesised, because only SOME controls are phone-scoped — colours and
    // effects stay global, and a header tag would have claimed them all.
    expect(byId(buildStyleControls(onPhone()), 'size').phoneScoped).toBe(true)
    expect(byId(buildStyleControls(onPhone()), 'size').label).toBe('Size')
    expect(byId(buildStyleControls(onDesktop), 'size').phoneScoped).toBeUndefined()
  })

  it('the whole text set twins in phone scope, colours stay global', () => {
    const phone = buildStyleControls(onPhone('0.22.0'))
    for (const id of ['weight', 'align', 'leading', 'tracking', 'uppercase', 'italic']) {
      const c = phone.find((x) => x.id === id)
      // leading/tracking live in the text-item builder; section builder has the rest
      if (!c) continue
      expect(c.phoneScoped, id).toBe(true)
    }
    const item = buildTextItemStyleControls(onPhone('0.22.0'))
    expect(byId(item, 'leading').phoneScoped).toBe(true)
    expect(byId(item, 'tracking').phoneScoped).toBe(true)
    expect(phone.find((c) => c.id === 'textColor')!.phoneScoped).toBeUndefined()
    // Twins write the sm shape and translate back for reading — never the desktop token.
    const weight = byId(phone, 'weight')
    const offered = weight.kind === 'select' ? weight.options : []
    expect(offered.find((o) => o.label === 'Bold')!.value).toBe('weightsm-[700]')
    expect(applyStyleValue('grid weight-[900]', weight, 'weightsm-[700]'))
      .toBe('grid weight-[900] weightsm-[700]')
    const upper = byId(phone, 'uppercase')
    expect(upper.kind === 'toggle' && upper.onClass).toBe('casesm-[uppercase]')
    expect(readStyleValue(upper, 'grid casesm-[uppercase]')).toBe('on')
    expect(readStyleValue(upper, 'grid case-[uppercase]')).toBe('')
  })

  it('the whole-set twins need the 0.22 floor; size/pad only 0.19', () => {
    const mid = buildStyleControls(onPhone('0.19.0'))
    expect(byId(mid, 'size').phoneScoped).toBe(true)
    expect(byId(mid, 'weight').phoneScoped).toBeUndefined()
  })

  it('CRITICAL: applying a phone size PRESERVES the desktop one, and vice versa', () => {
    const phone = byId(buildStyleControls(onPhone()), 'size')
    const desktop = byId(buildStyleControls(onDesktop), 'size')
    // Phone edit keeps the desktop token…
    expect(applyStyleValue('grid size-[48px]', phone, 'sizesm-[18px]'))
      .toBe('grid size-[48px] sizesm-[18px]')
    // …desktop edit keeps the phone token…
    expect(applyStyleValue('grid size-[48px] sizesm-[18px]', desktop, 'size-[60px]'))
      .toBe('grid sizesm-[18px] size-[60px]')
    // …and each replaces its OWN prior value.
    expect(applyStyleValue('grid sizesm-[18px]', phone, 'sizesm-[16px]'))
      .toBe('grid sizesm-[16px]')
  })

  it('reads only its own scope', () => {
    const phone = byId(buildStyleControls(onPhone()), 'size')
    const desktop = byId(buildStyleControls(onDesktop), 'size')
    const stored = 'grid size-[48px] sizesm-[18px]'
    expect(readStyleValue(phone, stored)).toBe('sizesm-[18px]')
    expect(readStyleValue(desktop, stored)).toBe('size-[48px]')
    // Unset on the phone reads Default — the site's own responsive rendering.
    expect(readStyleValue(phone, 'grid size-[48px]')).toBe('')
  })

  it('the item slider gets the same treatment', () => {
    const phone = byId(buildTextItemStyleControls(onPhone()), 'size')
    for (const s of sliderSteps(phone)) {
      if (s.value === '') continue
      expect(s.value).toMatch(/^sizesm-\[\d+px\]$/)
    }
  })
})

describe('the phone-scoped padding control', () => {
  it('offers padsm tokens and preserves the desktop padding', () => {
    const phone = byId(buildStyleControls(onPhone()), 'pad')
    for (const s of sliderSteps(phone)) {
      if (s.value === '') continue
      expect(s.value).toMatch(/^padsm-\[\d+px\]$/)
    }
    expect(applyStyleValue('grid pad-[24px]', phone, 'padsm-[12px]'))
      .toBe('grid pad-[24px] padsm-[12px]')
    const desktop = byId(buildStyleControls(onDesktop), 'pad')
    expect(applyStyleValue('grid pad-[24px] padsm-[12px]', desktop, 'pad-[32px]'))
      .toBe('grid padsm-[12px] pad-[32px]')
  })
})

describe('per-item scale twins — the hero-logo case', () => {
  it('phone view scales write scalesm and PRESERVE the desktop scale', () => {
    const phone = byId(buildItemStyleControls(onPhone('0.23.0')), 'size')
    expect(phone.phoneScoped).toBe(true)
    for (const s of sliderSteps(phone)) {
      if (s.value === '') continue
      expect(s.value).toMatch(/^scalesm-\[\d+\]$/)
    }
    // The exact cross-talk Sam hit, both directions:
    expect(applyStyleValue('opacity-30 scale-135', phone, 'scalesm-[80]'))
      .toBe('opacity-30 scale-135 scalesm-[80]')
    const desktop = byId(buildItemStyleControls(withStyleVars({}, '0.23.0')), 'size')
    expect(applyStyleValue('opacity-30 scale-135 scalesm-[80]', desktop, 'scale-150'))
      .toBe('opacity-30 scalesm-[80] scale-150')
    // Reading stays scoped, and ranks land on the same step either era.
    expect(readStyleValue(phone, 'scale-135 scalesm-[80]')).toBe('scalesm-[80]')
    expect(readStyleValue(desktop, 'scale-135 scalesm-[80]')).toBe('scale-135')
    // Same STEP by label, not index — the twin drops the '' step (unset means
    // "inherit desktop"), so the two lists are offset by one.
    expect(sliderSteps(phone)[sliderIndex(phone, 'scalesm-[135]').idx].label)
      .toBe(sliderSteps(desktop)[sliderIndex(desktop, 'scale-135').idx].label)
  })

  it('video item Size twins the same way; 0.22 sites keep the desktop scale', () => {
    const phone = byId(buildVideoItemStyleControls('embed', onPhone('0.23.0')), 'size')
    expect(phone.phoneScoped).toBe(true)
    const old = byId(buildItemStyleControls(onPhone('0.22.0')), 'size')
    expect(old.phoneScoped).toBeUndefined()
  })
})

describe('gates', () => {
  it('phone view on a pre-0.19 site keeps the desktop-scoped controls', () => {
    expect(bridgeSupportsMobileVars('0.18.0')).toBe(false)
    expect(bridgeSupportsMobileVars('0.19.0')).toBe(true)
    const c = byId(buildStyleControls(onPhone('0.18.0')), 'size')
    const offered = c.kind === 'select' ? c.options : []
    expect(offered.every((o) => !o.value.startsWith('sizesm-'))).toBe(true)
    expect(c.label).not.toContain('phone')
  })

  it('every phone token survives the save validator', () => {
    for (const c of buildStyleControls(onPhone())) {
      const values =
        c.kind === 'select' ? c.options.map((o) => o.value)
        : c.kind === 'slider' ? sliderSteps(c).map((s) => s.value)
        : []
      for (const v of values.filter((x) => x.includes('sm-['))) {
        expect(cleanClassText(`grid ${v}`), v).not.toBeNull()
      }
    }
  })
})
