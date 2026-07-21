/**
 * The no-code style controls (lib/site-editor/style-controls): each control owns a slice
 * of a Tailwind class string, reads the current utility, and swaps it on apply while
 * PRESERVING everything it doesn't own (layout, spacing, z-index).
 */
import { describe, expect, it } from 'vitest'
import {
  applyStyleValue,
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
