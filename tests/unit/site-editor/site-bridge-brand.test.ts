// Brand colours, fonts and the browser bar, as the CSS and head values a site wears.
/**
 * The bridge's brand builders (BRAND_SYNC_PLAN, phase 2 — site-bridge 0.41.0).
 *
 * Everything `brandColorCss` / `brandFontCss` / `brandCss` return is dropped into a
 * `<style>` on every page of a fan-facing site, so each value is a CSS-injection sink:
 * colour keys become property names, hexes become values, a Google family name goes into
 * a quoted string AND a URL, a font path into `url('…')`. The hostile-input tests below
 * are the security boundary, not decoration — each one was seen passing a payload through
 * verbatim when its guard was removed (see the MUTATION CHECKS note at the bottom).
 *
 * Imported by RELATIVE path, not through the `@samfox1/site-bridge` symlink: that is the
 * only way Stryker can ever mutate this module (stryker.config.json, workspace caveat).
 *
 * The Skeen fixture is BRAND_SYNC_PLAN's seed, typed `satisfies PublicSitePayload` so a
 * wire field renamed later is a compile error here rather than a silently unexercised
 * branch.
 */
import { describe, expect, it } from 'vitest'
import type { PublicSitePayload, SiteBrand, SiteFont } from '../../../packages/site-bridge/src/payload'
import { FONT_SLOTS } from '../../../packages/site-bridge/src/payload'
import {
  GOOGLE_FONT_WEIGHTS,
  brandColorCss,
  brandCss,
  brandFontCss,
  brandHead,
  googleFontsHref,
} from '../../../packages/site-bridge/src/brand'
// The APP's reserved list: an independent source, so the bridge's copy is checked against
// what lone-star refuses rather than against itself.
import { RESERVED_FAMILIES as APP_RESERVED } from '@/lib/fonts'

const SB = 'https://sb.co'
const OPTS = { supabaseUrl: SB }
const SORG_PATH = 'a1/fonts/0b6c1a2e-5f1d-4c1e-9a55-3f7e2b1c9d10.woff2'
const W = GOOGLE_FONT_WEIGHTS.join(';')

/** Skeen's seed, straight from BRAND_SYNC_PLAN "Sam's calls". */
const SKEEN_BRAND: SiteBrand = {
  colors: [
    { key: 'primary', name: 'Red', hex: '#c63a2a' },
    { key: 'secondary', name: 'Sky', hex: '#8dbfd5' },
    { key: 'cream', name: 'Cream', hex: '#f4f1ea' },
    { key: 'black', name: 'Black', hex: '#0a0a0a' },
    { key: 'charcoal', name: 'Charcoal', hex: '#17191c' },
  ],
  theme_color: '#0a0a0a',
}

// Rows exactly as the Phase 1 door sends them: a Google row has `path`/`format` null and
// Google's spelling in `google_family`; an upload row has `source: 'upload'` and no
// `google_family` key at all.
const ARCHIVO: SiteFont = { family: 'archivo', label: 'Archivo', path: null, format: null, source: 'google', google_family: 'Archivo' }
const INTER: SiteFont = { family: 'inter', label: 'Inter', path: null, format: null, source: 'google', google_family: 'Inter' }
const SORG: SiteFont = { family: 'sorg', label: 'Sorg', path: SORG_PATH, format: 'woff2', source: 'upload' }

function skeen(over: Partial<PublicSitePayload> = {}): PublicSitePayload {
  return {
    artist: {
      id: 'a1',
      slug: 'skeen',
      name: 'Skeen',
      bio: null,
      hero_image_url: null,
      template: 'custom',
      spotify_artist_id: null,
    },
    tracks: [],
    tour_dates: [],
    merch: [],
    links: [],
    videos: [],
    media: [
      { id: 'm1', purpose: 'logo_primary', path: 'a1/brand/logo.png' },
      { id: 'm2', purpose: 'favicon', path: 'a1/brand/favicon.png' },
      { id: 'm3', purpose: 'home_icon', path: 'a1/brand/home-icon.png' },
      { id: 'm4', purpose: 'icon_source', path: 'a1/brand/source.png' },
      { id: 'm5', purpose: 'logo', path: 'a1/brand/alt-logo.png', label: 'Stamp' },
    ],
    site_content: {},
    styles: {},
    fonts: [ARCHIVO, INTER, SORG],
    font_slots: { primary: 'archivo', secondary: 'inter', custom_1: 'sorg' },
    brand: SKEEN_BRAND,
    ...over,
  } satisfies PublicSitePayload
}

/** A payload exactly as a 0.40 door serves it: no `brand`, fonts without `source` or
 *  `google_family`. It must still type-check against today's PublicSitePayload — the
 *  `satisfies` IS the back-compat assertion, and `tsc` is what runs it. */
function payload040(): PublicSitePayload {
  return {
    artist: { id: 'a1', slug: 'skeen', name: 'Skeen', bio: null, hero_image_url: null, template: 'custom', spotify_artist_id: null },
    tracks: [],
    tour_dates: [],
    merch: [],
    links: [],
    videos: [],
    media: [{ purpose: 'favicon', path: 'a1/brand/favicon.png' }],
    site_content: {},
    styles: {},
    fonts: [{ family: 'sorg', label: 'Sorg', path: SORG_PATH, format: 'woff2' }],
    font_slots: { custom_1: 'sorg' },
  } satisfies PublicSitePayload
}

const SORG_FACE =
  `@font-face{font-family:'sorg';src:url('${SB}/storage/v1/object/public/fonts/${SORG_PATH}') format('woff2');font-display:swap}` +
  `.font-sorg{font-family:'sorg',sans-serif}`

/* ── Colours ──────────────────────────────────────────────────────────────── */

describe('brandColorCss', () => {
  it("emits Skeen's seed as --brand-<key> on :root, in the published order", () => {
    expect(brandColorCss(SKEEN_BRAND)).toBe(
      ':root{--brand-primary:#c63a2a;--brand-secondary:#8dbfd5;--brand-cream:#f4f1ea;--brand-black:#0a0a0a;--brand-charcoal:#17191c}',
    )
  })

  it('emits NOTHING for an absent, null or empty brand (the site keeps its own colours)', () => {
    expect(brandColorCss(undefined)).toBe('')
    expect(brandColorCss(null)).toBe('')
    expect(brandColorCss({ colors: [], theme_color: null })).toBe('')
    // A shape an older or broken writer could send: not an array.
    expect(brandColorCss({ colors: 'primary' as unknown as SiteBrand['colors'], theme_color: null })).toBe('')
  })

  it('SECURITY: drops every key that is not [a-z0-9-]+ — a key is a property NAME', () => {
    const hostile = [
      'Primary', // uppercase: not a key the door ever writes
      'brand primary',
      'x:red}body{display:none',
      'x;--y',
      'x/*',
      'crème',
      '',
      'x\n',
      'k'.repeat(65), // absurd length
    ]
    const brand: SiteBrand = {
      colors: [...hostile.map((key) => ({ key, name: 'n', hex: '#123456' })), { key: 'ok-2', name: 'n', hex: '#abcdef' }],
      theme_color: null,
    }
    expect(brandColorCss(brand)).toBe(':root{--brand-ok-2:#abcdef}')
    // The length cap is a ceiling, not an off-by-one: 64 is a key, 65 is not.
    const k64 = 'k'.repeat(64)
    expect(brandColorCss({ colors: [{ key: k64, name: 'n', hex: '#123456' }], theme_color: null })).toBe(`:root{--brand-${k64}:#123456}`)
  })

  it('SECURITY: drops every hex that is not #rrggbb — a hex is a property VALUE', () => {
    const hostile = [
      'red',
      '#fff',
      '#c63a2a80', // 8-digit
      '#c63a2g',
      'c63a2a',
      ' #c63a2a',
      '#c63a2a ',
      '#c63a2a\n',
      '#c63a2a;}body{display:none',
      'var(--x)',
      'url(https://evil.example/x)',
    ]
    const brand: SiteBrand = {
      colors: hostile.map((hex, i) => ({ key: `c${i}`, name: 'n', hex })),
      theme_color: null,
    }
    expect(brandColorCss(brand)).toBe('')
  })

  it('accepts an uppercase hex and emits it lowercase', () => {
    expect(brandColorCss({ colors: [{ key: 'primary', name: 'Red', hex: '#C63A2A' }], theme_color: null })).toBe(
      ':root{--brand-primary:#c63a2a}',
    )
  })

  it('never lets the manager-typed NAME reach the CSS', () => {
    const css = brandColorCss({ colors: [{ key: 'primary', name: "Red'}body{x:y}", hex: '#c63a2a' }], theme_color: null })
    expect(css).toBe(':root{--brand-primary:#c63a2a}')
  })

  it('a duplicated key keeps the FIRST (published order wins, not the later row)', () => {
    expect(
      brandColorCss({
        colors: [
          { key: 'primary', name: 'Red', hex: '#c63a2a' },
          { key: 'primary', name: 'Other', hex: '#000000' },
        ],
        theme_color: null,
      }),
    ).toBe(':root{--brand-primary:#c63a2a}')
  })

  it('skips non-object rows and non-string fields instead of throwing', () => {
    // `['#abcdef']` stringifies to a valid hex, so only a type check keeps it out.
    const colors = [null, 7, 'x', { key: 1, hex: '#123456' }, { key: 'a', hex: 0x123456 }, { key: 'z', hex: ['#abcdef'] }, { key: 'b', name: 'B', hex: '#010203' }]
    expect(brandColorCss({ colors: colors as unknown as SiteBrand['colors'], theme_color: null })).toBe(':root{--brand-b:#010203}')
  })
})

/* ── Fonts ────────────────────────────────────────────────────────────────── */

describe('googleFontsHref', () => {
  it('one css2 request for every Google family, URL-encoded, the sensible weights, display=swap', () => {
    expect(googleFontsHref([ARCHIVO, INTER, SORG])).toBe(
      `https://fonts.googleapis.com/css2?family=Archivo:wght@${W}&family=Inter:wght@${W}&display=swap`,
    )
  })

  it('discrete weights, never a range: css2 answers 400 to wght@100..900 on a static family', () => {
    // Probed 2026-09-24: `Anton:wght@100..900` → 400 (the whole stylesheet fails), while a
    // discrete list naming weights Anton lacks → 200 with the weights it has.
    const href = googleFontsHref([ARCHIVO])!
    expect(href).not.toContain('..')
    expect(GOOGLE_FONT_WEIGHTS).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900])
  })

  it('encodes spaces as + (a family name is the only free text in the URL)', () => {
    const noto: SiteFont = { family: 'noto-sans-jp', label: 'Noto', path: null, format: null, source: 'google', google_family: 'Noto Sans JP' }
    expect(googleFontsHref([noto])).toBe(`https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@${W}&display=swap`)
  })

  it('null when there is no Google font (uploads alone need no stylesheet)', () => {
    expect(googleFontsHref([SORG])).toBeNull()
    expect(googleFontsHref([])).toBeNull()
    expect(googleFontsHref(undefined)).toBeNull()
  })

  it('names a family once even when two tokens point at it', () => {
    const again: SiteFont = { ...ARCHIVO, family: 'archivo-2' }
    expect(googleFontsHref([ARCHIVO, again])).toBe(`https://fonts.googleapis.com/css2?family=Archivo:wght@${W}&display=swap`)
  })

  it('SECURITY: drops every Google family outside [A-Za-z0-9] words joined by single spaces', () => {
    const hostile = [
      "Archivo'); } body { display:none } /*",
      'Inter&family=Evil',
      'Inter:wght@100..900',
      'Inter\n',
      ' Inter',
      'Inter ',
      'Noto  Sans',
      'Inter%27',
      'Crème',
      '',
      'A'.repeat(65),
    ]
    const fonts = hostile.map(
      (g, i): SiteFont => ({ family: `g${i}`, label: 'x', path: null, format: null, source: 'google', google_family: g }),
    )
    expect(googleFontsHref(fonts)).toBeNull()
    expect(brandFontCss(fonts, {}, OPTS)).toBe('')
    // 64 is the ceiling, not an off-by-one.
    const g64 = 'A'.repeat(64)
    expect(googleFontsHref([{ ...ARCHIVO, google_family: g64 }])).toContain(`family=${g64}:`)
  })
})

describe('brandFontCss', () => {
  it("Skeen's seed: the Google stylesheet first, a class per font, @font-face only for the upload, the slots last", () => {
    expect(brandFontCss(skeen().fonts, skeen().font_slots, OPTS)).toBe(
      `@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@${W}&family=Inter:wght@${W}&display=swap');` +
        `.font-archivo{font-family:'Archivo',sans-serif}` +
        `.font-inter{font-family:'Inter',sans-serif}` +
        SORG_FACE +
        `:root{--font-primary:'Archivo';--font-secondary:'Inter';--font-custom-1:'sorg'}`,
    )
  })

  it('a multi-word Google family: the class and the variable use GOOGLE’S spelling, never the token', () => {
    // The token alone only works for a one-word family: `'big-shoulders-display'` is a
    // family no stylesheet declares.
    const big: SiteFont = {
      family: 'big-shoulders-display',
      label: 'Big Shoulders Display',
      path: null,
      format: null,
      source: 'google',
      google_family: 'Big Shoulders Display',
    }
    expect(brandFontCss([big], { primary: 'big-shoulders-display' }, OPTS)).toBe(
      `@import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@${W}&display=swap');` +
        `.font-big-shoulders-display{font-family:'Big Shoulders Display',sans-serif}` +
        `:root{--font-primary:'Big Shoulders Display'}`,
    )
  })

  it('a Google font never gets an @font-face (Google’s stylesheet declares it)', () => {
    const css = brandFontCss([ARCHIVO], { primary: 'archivo' }, OPTS)
    expect(css).not.toContain('@font-face')
    expect(css).not.toContain('/storage/')
  })

  it('googleImport:false leaves the stylesheet to the site’s own <link> and keeps everything else', () => {
    expect(brandFontCss([ARCHIVO], { primary: 'archivo' }, { ...OPTS, googleImport: false })).toBe(
      `.font-archivo{font-family:'Archivo',sans-serif}:root{--font-primary:'Archivo'}`,
    )
  })

  it("BACK-COMPAT: a 0.40 font (no source) is an upload, and the CSS is exactly today's", () => {
    const p = payload040()
    expect(brandFontCss(p.fonts, p.font_slots, OPTS)).toBe(SORG_FACE + `:root{--font-custom-1:'sorg'}`)
  })

  it('every slot in FONT_SLOTS becomes its --font-<kebab> variable, in FONT_SLOTS order', () => {
    // Derived from the registry (AGENTS.md rule 4): a sixth slot is covered the day it lands.
    const slots = Object.fromEntries(FONT_SLOTS.map((s) => [s, 'sorg']))
    const vars = FONT_SLOTS.map((s) => `--font-${s.replace(/_/g, '-')}:'sorg'`).join(';')
    expect(brandFontCss([SORG], slots, OPTS)).toBe(SORG_FACE + `:root{${vars}}`)
  })

  it('a slot is emitted only when its font survived (a variable at a missing face looks deliberate)', () => {
    expect(brandFontCss([SORG], { primary: 'ghost', secondary: 'sorg' }, OPTS)).toBe(
      SORG_FACE + `:root{--font-secondary:'sorg'}`,
    )
    // Keys outside the vocabulary are ignored, whatever they point at.
    expect(brandFontCss([SORG], { heading: 'sorg' } as never, OPTS)).toBe(SORG_FACE)
    expect(brandFontCss([SORG], null, OPTS)).toBe(SORG_FACE)
  })

  it('byte-stable: sorted by family, first row wins a duplicated family', () => {
    const b: SiteFont = { family: 'b-face', label: 'B', path: 'a1/fonts/b.woff', format: 'woff' }
    const a: SiteFont = { family: 'a-face', label: 'A', path: 'a1/fonts/a.ttf', format: 'ttf' }
    const aAgain: SiteFont = { family: 'a-face', label: 'A2', path: 'a1/fonts/a2.otf', format: 'otf' }
    expect(brandFontCss([b, a, aAgain], {}, OPTS)).toBe(
      `@font-face{font-family:'a-face';src:url('${SB}/storage/v1/object/public/fonts/a1/fonts/a.ttf') format('truetype');font-display:swap}` +
        `.font-a-face{font-family:'a-face',sans-serif}` +
        `@font-face{font-family:'b-face';src:url('${SB}/storage/v1/object/public/fonts/a1/fonts/b.woff') format('woff');font-display:swap}` +
        `.font-b-face{font-family:'b-face',sans-serif}`,
    )
  })

  it('SECURITY: drops a family token that is not lone-star’s sanitized shape, or is reserved', () => {
    const hostile = [
      "sorg'}body{display:none}",
      'Sorg',
      'sorg face',
      'a--b',
      '-a',
      'a-',
      'x'.repeat(33),
      // Reserved: a slot's own class, or a Tailwind font utility every bold word wears.
      'primary',
      'custom-1',
      'bold',
      'sans',
    ]
    const fonts = hostile.map((family): SiteFont => ({ family, label: 'x', path: SORG_PATH, format: 'woff2' }))
    expect(brandFontCss(fonts, {}, OPTS)).toBe('')
    // The same guard holds for a Google font's token.
    expect(brandFontCss([{ ...ARCHIVO, family: 'bold' }], {}, OPTS)).toBe('')
    // A number stringifies to a valid token; only the type check keeps it out.
    expect(brandFontCss([{ ...SORG, family: 123 as never }], {}, OPTS)).toBe('')
    // 32 is the ceiling, not an off-by-one.
    const f32 = 'f'.repeat(32)
    expect(brandFontCss([{ ...SORG, family: f32 }], {}, OPTS)).toContain(`.font-${f32}{`)
  })

  it('SECURITY: refuses every family lone-star itself refuses (derived from the app’s list)', () => {
    expect(APP_RESERVED.length).toBeGreaterThan(10) // the import found the list
    for (const family of APP_RESERVED) {
      expect(brandFontCss([{ ...SORG, family }], {}, OPTS), family).toBe('')
    }
  })

  it('SECURITY: drops an upload whose path could leave url(\'…\') or its folder', () => {
    const hostile = [
      "a1/fonts/x.woff2') }body{display:none}/*",
      "a1/fonts/x'.woff2",
      'a1/fonts/x.woff2)',
      '../b2/fonts/x.woff2',
      'a1/../../b2/x.woff2',
      '/a1/fonts/x.woff2',
      'a1/fonts/x y.woff2',
      'a1\\fonts\\x.woff2',
      '',
      null, // an upload row with no file
      `a1/${'x'.repeat(200)}.woff2`,
    ]
    const fonts = hostile.map((path, i): SiteFont => ({ family: `f${i}`, label: 'x', path, format: 'woff2' }))
    expect(brandFontCss(fonts, {}, OPTS)).toBe('')
    // 200 characters is the ceiling, not an off-by-one.
    const p200 = `a1/${'x'.repeat(191)}.woff2`
    expect(p200).toHaveLength(200)
    expect(brandFontCss([{ ...SORG, path: p200 }], {}, OPTS)).toContain(`/fonts/${p200}'`)
  })

  it('SECURITY: drops an unknown format (never guess a format() hint)', () => {
    for (const format of ['svg', 'eot', "woff2') ;", '', 'WOFF2', null, 'constructor', '__proto__', ['woff2'] as never]) {
      expect(brandFontCss([{ ...SORG, format }], {}, OPTS)).toBe('')
    }
  })

  it('each stored format gets its CSS keyword (ttf and otf are NOT their extension)', () => {
    const hints = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' }
    for (const [format, hint] of Object.entries(hints)) {
      expect(brandFontCss([{ ...SORG, format }], {}, OPTS)).toContain(` format('${hint}');`)
    }
  })

  it('SECURITY: drops uploads when the site’s supabaseUrl is not a bare http(s) origin', () => {
    for (const supabaseUrl of ['', 'javascript:alert(1)', "https://sb.co')}", 'https://sb.co/x y', 'sb.co', 'xhttps://sb.co', 'https://sb.co:8a', undefined]) {
      expect(brandFontCss([SORG], {}, { supabaseUrl: supabaseUrl as string })).toBe('')
    }
    // A trailing slash is a config habit, not an attack; nor is plain http on a local port.
    expect(brandFontCss([SORG], {}, { supabaseUrl: `${SB}/` })).toBe(SORG_FACE)
    expect(brandFontCss([SORG], {}, { supabaseUrl: `${SB}//` })).toBe(SORG_FACE)
    expect(brandFontCss([SORG], {}, { supabaseUrl: 'http://127.0.0.1:54321' })).toContain(
      "src:url('http://127.0.0.1:54321/storage/v1/object/public/fonts/",
    )
  })

  it('an unknown source, or a Google font with no family name, is dropped rather than guessed', () => {
    expect(brandFontCss([{ ...SORG, source: 'adobe' as never }], {}, OPTS)).toBe('')
    expect(brandFontCss([{ ...ARCHIVO, google_family: null }], {}, OPTS)).toBe('')
    expect(brandFontCss([{ ...ARCHIVO, google_family: undefined }], {}, OPTS)).toBe('')
  })

  it('an upload ignores a stray google_family, and a Google font ignores a stray path', () => {
    expect(brandFontCss([{ ...SORG, google_family: 'Inter' }], {}, OPTS)).toBe(SORG_FACE)
    expect(brandFontCss([{ ...ARCHIVO, path: SORG_PATH, format: 'woff2' }], {}, { ...OPTS, googleImport: false })).toBe(
      `.font-archivo{font-family:'Archivo',sans-serif}`,
    )
  })

  it('empty in, empty out', () => {
    expect(brandFontCss([], {}, OPTS)).toBe('')
    expect(brandFontCss(undefined, undefined, OPTS)).toBe('')
    expect(brandFontCss([null, 3] as unknown as SiteFont[], {}, OPTS)).toBe('')
  })
})

/* ── Together ─────────────────────────────────────────────────────────────── */

describe('brandCss', () => {
  it('fonts then colours, so the @import stays the FIRST rule (an @import after any rule is ignored)', () => {
    const css = brandCss(skeen(), OPTS)
    expect(css).toBe(brandFontCss(skeen().fonts, skeen().font_slots, OPTS) + brandColorCss(SKEEN_BRAND))
    expect(css.startsWith("@import url('https://fonts.googleapis.com/css2?")).toBe(true)
  })

  it("BACK-COMPAT: a 0.40 payload gets exactly today's font CSS and no colours", () => {
    expect(brandCss(payload040(), OPTS)).toBe(SORG_FACE + `:root{--font-custom-1:'sorg'}`)
  })

  it('nothing published, nothing emitted', () => {
    expect(brandCss(null, OPTS)).toBe('')
    expect(brandCss(undefined, OPTS)).toBe('')
  })
})

/* ── Head ─────────────────────────────────────────────────────────────────── */

describe('brandHead', () => {
  it('theme-color from brand.theme_color; apple-touch-icon from the home_icon row', () => {
    expect(brandHead(skeen(), OPTS)).toEqual({
      themeColor: '#0a0a0a',
      appleTouchIcon: `${SB}/storage/v1/object/public/media/a1/brand/home-icon.png`,
    })
  })

  it('falls back to the favicon when no home_icon is published (a 0.40 payload)', () => {
    expect(brandHead(payload040(), OPTS)).toEqual({
      themeColor: null,
      appleTouchIcon: `${SB}/storage/v1/object/public/media/a1/brand/favicon.png`,
    })
  })

  it('never offers a logo, an icon source or anything else as the home-screen icon', () => {
    const media = skeen().media.filter((m) => m.purpose !== 'home_icon' && m.purpose !== 'favicon')
    expect(brandHead(skeen({ media }), OPTS).appleTouchIcon).toBeNull()
  })

  it('SECURITY: a hostile theme_color is null, not passed through; uppercase is lowercased', () => {
    for (const theme_color of ['red', '#fff', '#0a0a0a"><script>', ' #0a0a0a', 'javascript:x']) {
      expect(brandHead(skeen({ brand: { ...SKEEN_BRAND, theme_color } }), OPTS).themeColor).toBeNull()
    }
    expect(brandHead(skeen({ brand: { ...SKEEN_BRAND, theme_color: '#0A0A0A' } }), OPTS).themeColor).toBe('#0a0a0a')
  })

  it('SECURITY: a hostile home_icon path is skipped and the favicon used instead', () => {
    const media = skeen().media.map((m) => (m.purpose === 'home_icon' ? { ...m, path: '../b2/brand/x.png' } : m))
    expect(brandHead(skeen({ media }), OPTS).appleTouchIcon).toBe(`${SB}/storage/v1/object/public/media/a1/brand/favicon.png`)
    // Skipped, not the end of the search: a later good home_icon row still wins.
    const twice = [...media, { id: 'm9', purpose: 'home_icon' as const, path: 'a1/brand/home-2.png' }]
    expect(brandHead(skeen({ media: twice }), OPTS).appleTouchIcon).toBe(`${SB}/storage/v1/object/public/media/a1/brand/home-2.png`)
  })

  it('a null media row or a non-string theme colour is skipped, not thrown on', () => {
    const media = [null, ...skeen().media] as unknown as PublicSitePayload['media']
    const brand = { ...SKEEN_BRAND, theme_color: ['#0a0a0a'] as unknown as string }
    expect(brandHead(skeen({ media, brand }), OPTS)).toEqual({
      themeColor: null,
      appleTouchIcon: `${SB}/storage/v1/object/public/media/a1/brand/home-icon.png`,
    })
  })

  it('SECURITY: no icon URL is built on a supabaseUrl that is not a bare http(s) origin', () => {
    expect(brandHead(skeen(), { supabaseUrl: 'javascript:alert(1)' }).appleTouchIcon).toBeNull()
  })

  it('nothing published: both null', () => {
    expect(brandHead(null, OPTS)).toEqual({ themeColor: null, appleTouchIcon: null })
  })
})

/*
 * MUTATION CHECKS, 2026-09-24 — by hand, because packages/site-bridge is not in
 * stryker.config.json's `mutate` list. Each guard in brand.ts was broken once and the
 * named suite went red; all 33 were restored:
 *   colour key regex / length · hex check · hex lowercasing · colour-key dedupe ·
 *   family regex / length / reserved set · Google family regex / length · path regex /
 *   `..` / length · origin regex / trailing-slash trim · format allowlist · unknown
 *   source · font dedupe · font sort · Google name dedupe · no @font-face for Google ·
 *   googleImport:false · slot-survival · brandCss order (fonts before colours) · icon
 *   purpose filter / home_icon preferred / favicon fallback / icon path check / icon
 *   origin check · the nine weights · Google spelling (not the token) in the CSS ·
 *   `source ?? 'upload'` back-compat · space → + encoding.
 * The drop-everything tests (hostile keys, hexes, families, paths) PASS against a stub
 * that returns '' — they are only worth anything because of these checks.
 *
 * Then Stryker, targeted without touching the config
 * (`npx stryker run --mutate packages/site-bridge/src/brand.ts`): 88.12% on the first run,
 * whose survivors were real gaps (length ceilings never probed at the boundary, a
 * non-string that stringifies to a valid value, the `http` origin, `otf`, the Tailwind
 * half of the reserved list, a second home_icon row) or redundant checks, which were
 * DELETED rather than tested. Now 276 killed, 1 survived (99.64%), and that one is
 * equivalent: `<` → `<=` in the sort comparator, where tokens are unique by then and
 * never compare equal.
 */
