/**
 * The no-code style controls (lib/site-editor/style-controls): each control owns a slice
 * of a Tailwind class string, reads the current utility, and swaps it on apply while
 * PRESERVING everything it doesn't own (layout, spacing, z-index).
 */
import { describe, expect, it } from 'vitest'
import {
  applyStyleValue,
  buildItemStyleControls,
  buildStyleControls,
  readStyleValue,
  type SiteStyleOptions,
} from '@/lib/site-editor/style-controls'

const PALETTE: SiteStyleOptions = {
  fonts: [
    { value: 'font-display', label: 'Display' },
    { value: 'font-momo', label: 'Momo' },
  ],
  textColors: [
    { value: 'text-flash-1', label: 'Flash' },
    { value: 'text-foreground', label: 'Foreground' },
  ],
  bgColors: [
    { value: 'bg-background', label: 'Background' },
    { value: 'bg-black', label: 'Black' },
  ],
}

const controls = buildStyleControls(PALETTE)
const byId = (id: string) => controls.find((c) => c.id === id)!

describe('buildStyleControls', () => {
  it('includes the universal controls always, palette controls only when declared', () => {
    const ids = controls.map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['size', 'weight', 'align', 'uppercase', 'italic', 'font', 'textColor', 'bgColor']))
    // No palette → no font/colour controls.
    const bare = buildStyleControls().map((c) => c.id)
    expect(bare).toEqual(['size', 'weight', 'align', 'uppercase', 'italic'])
  })
})

describe('buildItemStyleControls (per-image/video)', () => {
  const item = buildItemStyleControls()
  const itemById = (id: string) => item.find((c) => c.id === id)!

  it('offers exactly the visual controls: size, transparency, border, border colour, corners, shadow', () => {
    expect(item.map((c) => c.id)).toEqual(['size', 'opacity', 'borderWidth', 'borderColor', 'radius', 'shadow'])
  })

  it('size, transparency, border, corners + shadow are SLIDERS; border colour is a palette', () => {
    expect(itemById('size').kind).toBe('slider')
    expect(itemById('opacity').kind).toBe('slider')
    expect(itemById('borderWidth').kind).toBe('slider')
    expect(itemById('radius').kind).toBe('slider')
    expect(itemById('shadow').kind).toBe('slider')
    // A full palette: any hex, so the control carries no option list to choose from.
    expect(itemById('borderColor').kind).toBe('color')
    expect('options' in itemById('borderColor')).toBe(false)
    expect('steps' in itemById('borderColor')).toBe(false)
  })

  it('the border colour owns ANY hex, not a shortlist', () => {
    const color = itemById('borderColor')
    for (const hex of ['#000', '#3b82f6', '#123abc', '#ff00ff80'])
      expect(color.owns(`border-[${hex}]`)).toBe(true)
    expect(color.owns('border-[4px]')).toBe(false) // a width
    expect(color.owns('border-red-500')).toBe(false) // a named token, not ours
  })

  it('size steps run 50%→150% in 5% increments, 100% as the default (no class)', () => {
    const size = itemById('size')
    if (size.kind !== 'slider') throw new Error('size should be a slider')
    expect(size.steps).toHaveLength(21) // (150-50)/5 + 1
    expect(size.steps[0]).toEqual({ value: 'scale-50', label: '50%' })
    expect(size.steps[10]).toEqual({ value: '', label: '100%' }) // 100% → no class
    expect(size.steps[12]).toEqual({ value: 'scale-110', label: '110%' })
    expect(size.steps[20]).toEqual({ value: 'scale-150', label: '150%' })
  })

  it('each control owns ONLY its own utilities — border WIDTH vs border COLOUR (arbitrary hex) do not collide', () => {
    // A full item class string with one utility per control; the colour is an arbitrary hex.
    const cls = 'scale-110 opacity-50 border-2 border-[#ff0000] rounded-[6px] shadow-lg'
    expect(readStyleValue(itemById('size'), cls)).toBe('scale-110')
    expect(readStyleValue(itemById('opacity'), cls)).toBe('opacity-50')
    expect(readStyleValue(itemById('borderWidth'), cls)).toBe('border-2') // width, not the colour
    expect(readStyleValue(itemById('borderColor'), cls)).toBe('border-[#ff0000]') // colour, not the width
    expect(readStyleValue(itemById('radius'), cls)).toBe('rounded-[6px]')
    expect(readStyleValue(itemById('shadow'), cls)).toBe('shadow-lg')
  })

  it('applying a control swaps its utility and preserves the rest (additive overlay)', () => {
    let cls = ''
    cls = applyStyleValue(cls, itemById('size'), 'scale-125')
    cls = applyStyleValue(cls, itemById('borderWidth'), 'border-[4px]')
    cls = applyStyleValue(cls, itemById('borderColor'), 'border-[#3b82f6]')
    expect(cls.split(' ').sort()).toEqual(['border-[#3b82f6]', 'border-[4px]', 'scale-125'])
    // Changing the border colour keeps the width + size.
    cls = applyStyleValue(cls, itemById('borderColor'), 'border-[#ffffff]')
    expect(cls.split(' ').sort()).toEqual(['border-[#ffffff]', 'border-[4px]', 'scale-125'])
    // Clearing size (Default) drops only the scale.
    cls = applyStyleValue(cls, itemById('size'), '')
    expect(cls.split(' ').sort()).toEqual(['border-[#ffffff]', 'border-[4px]'])
  })
})

describe('readStyleValue', () => {
  const cls = 'relative z-0 bg-black text-flash-1 text-4xl font-momo font-bold uppercase'
  it('reads size / weight / font / colours distinctly (all share text-/font- prefixes)', () => {
    expect(readStyleValue(byId('size'), cls)).toBe('text-4xl')
    expect(readStyleValue(byId('weight'), cls)).toBe('font-bold')
    expect(readStyleValue(byId('font'), cls)).toBe('font-momo')
    expect(readStyleValue(byId('textColor'), cls)).toBe('text-flash-1')
    expect(readStyleValue(byId('bgColor'), cls)).toBe('bg-black')
  })
  it('reads a toggle as on/off', () => {
    expect(readStyleValue(byId('uppercase'), cls)).toBe('on')
    expect(readStyleValue(byId('italic'), cls)).toBe('')
  })
  it('returns Default ("") when the control has no matching token', () => {
    expect(readStyleValue(byId('align'), cls)).toBe('')
    expect(readStyleValue(byId('size'), 'relative z-0')).toBe('')
  })
})

describe('applyStyleValue', () => {
  it('swaps the owned utility and PRESERVES everything else', () => {
    const out = applyStyleValue('relative z-0 bg-black text-4xl', byId('size'), 'text-lg')
    expect(out.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'z-0', 'bg-black', 'text-lg']))
    expect(out).not.toContain('text-4xl')
  })
  it('setting Default ("") removes the owned utility, leaving the rest', () => {
    expect(applyStyleValue('relative bg-black font-bold', byId('weight'), '')).toBe('relative bg-black')
  })
  it('does not confuse size with alignment or colour (both text-*)', () => {
    // Changing size must leave text-center (align) and text-flash-1 (colour) untouched.
    const out = applyStyleValue('text-center text-flash-1 text-2xl', byId('size'), 'text-5xl')
    expect(out.split(/\s+/).sort()).toEqual(['text-5xl', 'text-center', 'text-flash-1'])
  })
  it('toggles a class on and off', () => {
    expect(applyStyleValue('relative', byId('italic'), 'on')).toBe('relative italic')
    expect(applyStyleValue('relative italic', byId('italic'), '')).toBe('relative')
  })
  it('swaps a font family without touching the weight', () => {
    const out = applyStyleValue('font-momo font-bold', byId('font'), 'font-display')
    expect(out.split(/\s+/).sort()).toEqual(['font-bold', 'font-display'])
  })
})
