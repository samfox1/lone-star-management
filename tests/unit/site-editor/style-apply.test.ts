// Applying a style to a region or an item, and which parts of the class string survive it.
import { describe, it, expect } from 'vitest'
import {
  isItemKey,
  mergeStyle,
  resolveRegionStyle,
  resolveStyle,
  siteSwatches,
  usedColors,
} from '@/lib/site-editor/style-apply'
import { buildVideoItemStyleControls } from '@/lib/site-editor/style-controls'

describe('resolveStyle — arbitrary colours leave the class string', () => {
  it('lifts border/text/background hexes into inline CSS', () => {
    expect(resolveStyle('border-[#123abc]')).toEqual({ className: '', style: { borderColor: '#123abc' } })
    expect(resolveStyle('text-[#fff]')).toEqual({ className: '', style: { color: '#fff' } })
    expect(resolveStyle('bg-[#00ff0080]')).toEqual({ className: '', style: { backgroundColor: '#00ff0080' } })
  })

  it('lifts the WHOLE owned item vocabulary inline — a class can be uncompiled or outranked', () => {
    // Classes fail two ways inline styles cannot: the site's build may never have
    // compiled them, and a same-property base class (border-4 vs border-[6px]) wins or
    // loses by STYLESHEET order, which nobody controls. So everything the item sliders
    // emit resolves to inline CSS.
    const r = resolveStyle('scale-110 opacity-50 border-[4px] border-[#ff0000] rounded-[6px] shadow-lg')
    expect(r.className).toBe('')
    expect(r.style).toEqual({
      scale: '1.1',
      opacity: '0.5',
      borderWidth: '4px',
      borderStyle: 'solid',
      borderColor: '#ff0000',
      borderRadius: '6px',
      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    })
  })

  it('leaves tokens it does not own as classes — site vocabulary passes through', () => {
    const r = resolveStyle('w-full object-cover rounded-md font-momo')
    expect(r.className).toBe('w-full object-cover rounded-md font-momo')
    expect(r.style).toEqual({})
  })

  it('leaves named colour utilities alone — the site compiles its own tokens', () => {
    const r = resolveStyle('bg-flash-1 text-red-500 border-2')
    expect(r.className).toBe('bg-flash-1 text-red-500 border-2')
    expect(r.style).toEqual({})
  })

  it('is empty for an empty string, and the last token of a property wins', () => {
    expect(resolveStyle('')).toEqual({ className: '', style: {} })
    expect(resolveStyle('border-[#000000] border-[#ffffff]').style).toEqual({ borderColor: '#ffffff' })
  })

  it('ignores a prefix with no colour meaning, and a malformed arbitrary value', () => {
    expect(resolveStyle('ring-[#ff0000]').className).toBe('ring-[#ff0000]') // not a managed prop
    expect(resolveStyle('border-[#xyz]').className).toBe('border-[#xyz]') // not a hex
  })
})

describe('resolveStyle — playback speed leaves the class string too', () => {
  it('lifts speed-[Nx] into playbackRate (a DOM property, never CSS)', () => {
    expect(resolveStyle('speed-[1.5x]')).toEqual({ className: '', style: {}, playbackRate: 1.5 })
    expect(resolveStyle('speed-[0.25x] opacity-50')).toEqual({
      className: '',
      style: { opacity: '0.5' },
      playbackRate: 0.25,
    })
  })

  it('omits playbackRate when there is no speed token — the consumer resets to 1', () => {
    expect(resolveStyle('scale-110')).not.toHaveProperty('playbackRate')
  })

  it('rejects a malformed or non-positive speed (stays a class, inert)', () => {
    expect(resolveStyle('speed-[fast]').className).toBe('speed-[fast]')
    expect(resolveStyle('speed-[0x]').className).toBe('speed-[0x]')
  })

  it('last speed token wins, matching every other property', () => {
    expect(resolveStyle('speed-[0.5x] speed-[2x]').playbackRate).toBe(2)
  })

  /**
   * A media element only accepts roughly 0.0625×–16×; WebKit THROWS NotSupportedError
   * outside that range. Both consumers (`applyStyleToDom` here and skeen's mirror) assign
   * `video.playbackRate` unguarded, so an out-of-range stored token doesn't merely
   * misbehave — it throws mid-apply and aborts the rest of that style update, leaving the
   * element half-styled. Clamping in `speedToken` means an impossible rate resolves to
   * null and stays an inert class, which is what every other malformed token does.
   *
   * Reported from the skeen mirror diff, 2026-08-04: skeen already clamps, so until this
   * lands the two sides disagree about what `speed-[50x]` means.
   */
  it('CRITICAL: rejects a speed no media element can play (stays an inert class)', () => {
    expect(resolveStyle('speed-[50x]').className).toBe('speed-[50x]')
    expect(resolveStyle('speed-[50x]')).not.toHaveProperty('playbackRate')
    expect(resolveStyle('speed-[0.001x]').className).toBe('speed-[0.001x]')
    expect(resolveStyle('speed-[0.001x]')).not.toHaveProperty('playbackRate')
  })

  it('accepts the boundaries of the playable range', () => {
    expect(resolveStyle('speed-[16x]').playbackRate).toBe(16)
    expect(resolveStyle('speed-[0.0625x]').playbackRate).toBe(0.0625)
  })

  it('every speed the item panel can emit survives the clamp', () => {
    // The clamp must never reject the product's own vocabulary — read the REAL steps from
    // the panel, so a new step here cannot silently fall outside the playable range.
    const speed = buildVideoItemStyleControls('file').find((c) => c.id === 'speed')
    if (!speed || speed.kind !== 'slider') throw new Error('file videos lost their Speed slider')
    const emitted = speed.steps.filter((s) => s.value !== '') // '' is Normal: no token to clamp
    expect(emitted.length).toBeGreaterThan(0)
    for (const step of emitted) {
      const rate = Number(step.value.match(/^speed-\[(.+)x\]$/)?.[1])
      expect(resolveStyle(step.value).playbackRate).toBe(rate)
    }
  })
})

describe('isItemKey', () => {
  it('reads the colon convention: items are prefixed, sections are bare', () => {
    expect(isItemKey('slot:polaroid_1_photo')).toBe(true)
    expect(isItemKey('image:1f0a4c2e-0000-4000-8000-000000000000')).toBe(true)
    expect(isItemKey('hero_wordmark')).toBe(false)
    expect(isItemKey('footer')).toBe(false)
  })
})

describe('mergeStyle — items add, sections replace', () => {
  const BASE = 'absolute inset-0 h-full w-full object-cover'

  it('a section override REPLACES the base (the manager edited the whole string)', () => {
    expect(mergeStyle('hero_video', BASE, 'h-32 w-32')).toBe('h-32 w-32')
  })

  it('an item overlay is APPENDED to the base, and wins on equal specificity', () => {
    expect(mergeStyle('slot:polaroid_1_photo', BASE, 'scale-110 rounded-[6px]')).toBe(
      `${BASE} scale-110 rounded-[6px]`,
    )
  })

  it('an item overlay on an unstyled element is just the overlay', () => {
    expect(mergeStyle('image:abc', '', 'scale-110')).toBe('scale-110')
  })

  it('a blank override falls back to the base for BOTH kinds — clearing restores', () => {
    expect(mergeStyle('hero_video', BASE, '')).toBe(BASE)
    expect(mergeStyle('slot:polaroid_1_photo', BASE, '   ')).toBe(BASE)
  })
})

describe('usedColors — what the site already uses', () => {
  it('collects every hex across all regions, most-used first', () => {
    const styles = {
      hero_wordmark: 'text-[#ff0000]',
      'slot:polaroid_1_photo': 'border-[4px] border-[#123abc]',
      'slot:polaroid_2_photo': 'border-[#123abc]',
      footer: 'bg-[#123abc] text-[#ff0000]',
    }
    expect(usedColors(styles)).toEqual(['#123abc', '#ff0000'])
  })

  it('treats #FFF and #ffffff as one colour', () => {
    expect(usedColors({ a: 'text-[#FFF]', b: 'bg-[#ffffff]' })).toEqual(['#ffffff'])
  })

  it('keeps first-seen order when counts tie, so the row does not reshuffle', () => {
    expect(usedColors({ a: 'text-[#111111]', b: 'text-[#222222]' })).toEqual(['#111111', '#222222'])
  })

  it('ignores non-colour classes, empty strings and named tokens', () => {
    expect(usedColors({ a: 'scale-110 border-[4px] bg-flash-1', b: '', c: 'rounded-full' })).toEqual([])
    expect(usedColors({})).toEqual([])
  })

  it('caps the list so the swatch row cannot run away', () => {
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`r${i}`, `text-[#${i.toString(16).padStart(6, '0')}]`]),
    )
    expect(usedColors(many)).toHaveLength(12)
    expect(usedColors(many, 3)).toHaveLength(3)
  })
})

describe('siteSwatches — the site palette, then its one-offs', () => {
  const OPTIONS = {
    textColors: [
      { value: 'text-flash-1', label: 'Red', hex: '#c63a2a' },
      { value: 'text-black', label: 'Black', hex: '#000000' },
    ],
    bgColors: [
      { value: 'bg-cream', label: 'Cream', hex: '#f4f1ea' },
      { value: 'bg-flash-1', label: 'Red', hex: '#c63a2a' }, // same colour, one swatch
    ],
  }

  it('offers the declared palette first, then colours only used in saved styles', () => {
    expect(siteSwatches(OPTIONS, { footer: 'border-[#123abc]' })).toEqual([
      '#c63a2a',
      '#000000',
      '#f4f1ea',
      '#123abc',
    ])
  })

  it('never lists a palette colour twice, however it was reached', () => {
    // Using a palette colour on an item must not duplicate its swatch.
    expect(siteSwatches(OPTIONS, { 'slot:a': 'border-[#C63A2A]' })).toEqual([
      '#c63a2a',
      '#000000',
      '#f4f1ea',
    ])
  })

  it('ignores colour options that declare no hex — a class name is not a colour', () => {
    // This is why skeen showed nothing at first: it declared `text-flash-1` with no hex,
    // and the editor has no access to the site's stylesheet to look it up.
    expect(siteSwatches({ textColors: [{ value: 'text-flash-1', label: 'Red' }] }, {})).toEqual([])
  })

  it('works with no palette at all, and caps the row', () => {
    expect(siteSwatches(undefined, { a: 'border-[#111111]' })).toEqual(['#111111'])
    expect(siteSwatches(undefined, {}, 5)).toEqual([])
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`r${i}`, `text-[#${i.toString(16).padStart(6, '0')}]`]),
    )
    expect(siteSwatches(OPTIONS, many, 6)).toHaveLength(6)
  })
})

describe('resolveRegionStyle — the whole pipeline', () => {
  it('merges the overlay, then lifts the owned tokens out of it — the base stays classes', () => {
    expect(resolveRegionStyle('slot:polaroid_1_photo', 'w-full object-cover', 'border-[4px] border-[#123abc]')).toEqual({
      className: 'w-full object-cover',
      style: { borderWidth: '4px', borderStyle: 'solid', borderColor: '#123abc' },
    })
  })

  it('a cleared item leaves the base untouched and NO inline colour', () => {
    expect(resolveRegionStyle('slot:polaroid_1_photo', 'w-full object-cover', '')).toEqual({
      className: 'w-full object-cover',
      style: {},
    })
  })

  /**
   * PROVENANCE (the 2026-08-03 review's rule, previously undefended — a mutation sweep
   * on 2026-08-04 found that flipping the section path to a full lift broke nothing).
   *
   * A SECTION string lifts colours only. Its vocabulary is site-compiled classes, and
   * those legitimately carry variant pairs (`hover:`, `md:`) plus utilities like
   * `opacity-0` and `rounded-full` that only MEAN anything as classes. Inlining them
   * would silently destroy the variant — an inline style has no hover state — so
   * `opacity-0` on a section must stay a class even though the identical token on an
   * item is lifted.
   */
  it('CRITICAL: a SECTION string lifts colours only — item tokens stay classes', () => {
    expect(resolveRegionStyle('hero_wordmark', 'text-6xl', 'opacity-50 rounded-full text-[#ff0000]')).toEqual({
      className: 'opacity-50 rounded-full',
      style: { color: '#ff0000' },
    })
  })

  it('CRITICAL: the SAME token is lifted on an item and left alone on a section', () => {
    const onItem = resolveRegionStyle('image:abc', 'w-full', 'opacity-50')
    const onSection = resolveRegionStyle('hero_wordmark', 'w-full', 'opacity-50')

    expect(onItem.style.opacity).toBe('0.5')
    expect(onItem.className).toBe('w-full')

    expect(onSection.style.opacity).toBeUndefined()
    expect(onSection.className).toContain('opacity-50')
  })

  it('a section string keeps hover: variants as classes rather than inlining them', () => {
    const resolved = resolveRegionStyle('hero_wordmark', 'text-6xl', 'hover:opacity-50 shadow-lg')
    expect(resolved.className).toContain('hover:opacity-50')
    expect(resolved.style.boxShadow).toBeUndefined()
  })
})
