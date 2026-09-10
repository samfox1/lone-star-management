/**
 * recommendAlt — the ONE alt-text rule the editor's preset and every site share
 * (SEO_GEO_PLAN B6b). Sam, 2026-08-26: "I want the system to recommend the best name
 * possible" — and "Tour w: Jigitz" alone is not it: it says where, not who.
 */
import { describe, expect, it } from 'vitest'
import { recommendAlt, recommendSlug, tidyCaption } from '@samfox1/site-bridge/alt'

describe('recommendAlt', () => {
  it('photo: who, then what — the artist leads, the caption follows, shorthand expanded', () => {
    expect(recommendAlt({ artist: 'Skeen', caption: 'Tour w: Jigitz' })).toBe('Skeen, Tour with Jigitz')
  })

  it('artwork: what by whom', () => {
    expect(recommendAlt({ artist: 'FTBK', caption: 'Blue Study', kind: 'artwork' })).toBe('Blue Study by FTBK')
    expect(recommendAlt({ artist: 'FTBK', caption: '', kind: 'artwork' })).toBe('Artwork by FTBK')
  })

  it('falls back to the artist alone, and to nothing at all — never "image"', () => {
    expect(recommendAlt({ artist: 'Skeen', caption: null })).toBe('Skeen')
    expect(recommendAlt({ artist: '', caption: '' })).toBe('')
    expect(recommendAlt({})).toBe('')
  })

  it('recommendSlug: the alt as a file name — lowercase ascii, single dashes, no edges', () => {
    expect(recommendSlug('Skeen, Tour with Jigitz')).toBe('skeen-tour-with-jigitz')
    expect(recommendSlug('  Éclat — Nº 3!  ')).toBe('eclat-no-3')
    expect(recommendSlug('')).toBe('')
    expect(recommendSlug('x'.repeat(100)).length).toBe(80)
  })

  it('tidyCaption: w/ and feat., whitespace, trailing dots', () => {
    expect(tidyCaption('  Live   w/ Jigitz feat. Mara. ')).toBe('Live with Jigitz featuring Mara')
  })
})
