# Brand ⇄ sites ⇄ editor sync — plan of record (2026-09-24)

Sam: "websites reading the brand setting. This should be in sync with sites and the
editor." Brand (BRAND_PAGE_PLAN.md) becomes the single source of truth; the published site
and the site editor read it. This supersedes that plan's "dashboard now, sites later".

## Sam's calls (2026-09-24)

- **Colours:** Skeen's brand colours are Red, Sky, Cream, Black and Charcoal, "all used in
  their own respective places". Seed: **Primary = Red #c63a2a, Secondary = Sky #8dbfd5**, then
  added **Cream #f4f1ea, Black #0a0a0a, Charcoal #17191c** (renamable/reorderable later).
- **Fonts:** Brand gets **Google Fonts** (pick any Google family by name) alongside uploads.
  Seed Skeen: **Primary = Archivo, Secondary = Inter** (Google); Polaroids stays the Sorg upload.
- **Bridge:** the other session's 0.40 work is shipped; this round may change the bridge.
- Seeding must not change how Skeen looks today.

## The contract (what the published site receives)

Colours, the browser-bar colour, and fonts now go through **draft → Publish** like the rest of
Brand (so the bar rises for them). Once published, `get_public_site` returns:

```
brand: {
  colors:      [{ key, name, hex }]      // published order; key is STABLE (see below)
  theme_color: '#rrggbb' | null          // the browser-bar colour
}
fonts:      [...existing fields, source: 'upload' | 'google', google_family?: string]
font_slots: { primary: family, secondary: family, custom_1..3 }   // unchanged shape
media:      the existing rows, now including purpose 'home_icon' (180px PNG) and 'favicon'
```

- **Colour keys are stable and never change on rename** (the enquiry-kind slug precedent):
  `primary` and `secondary` for the built-ins; for added colours a slug of the name at
  creation (`cream`, `black`, `charcoal`), de-duplicated per artist, immutable (DB trigger).
- **The bridge** emits CSS custom properties from the payload: `--brand-<key>` for every colour
  (`--brand-primary`, `--brand-secondary`, `--brand-cream`, …), `--font-primary` /
  `--font-secondary` / `--font-custom-N` as today, plus the Google Fonts stylesheet for any
  Google-sourced font. It also exposes head helpers for `theme-color` and the
  `apple-touch-icon` (home_icon, falling back to favicon).
- **Sites map their own tokens onto the brand variables with their current values as the
  fallback**, e.g. Skeen: `--red: var(--brand-primary, #c63a2a)`,
  `--sky: var(--brand-secondary, #8dbfd5)`, `--cream: var(--brand-cream, #f4f1ea)`,
  `--background: var(--brand-black, #0a0a0a)`, `--charcoal: var(--brand-charcoal, #17191c)`.
  Unset or unpublished → the site looks exactly as it does now.
- **The editor** keeps showing brand colours first in its swatches (done) and lists Google
  brand fonts in its font list like uploads: by an ADDED slot's title, else by their own
  name. (Review 2026-09-24: Primary/Secondary no longer retitle a font; the site's own
  "Primary font" entry is the one that follows the slot. `editorFontSlotTitles`.)

## Phases

1. **Dashboard + database** (this repo): migration (colour `key`, colours + theme colour
   publishable, Google font source), payload additions in `get_public_site` and the preview
   payload (`src/lib/site.ts`), Google Fonts picker in the Brand font menu, the Publish bar
   covering colours/theme colour. Migration pushed after review (additive only).
2. **Bridge 0.41.0** (`packages/site-bridge`): payload types, the CSS/head builders, CONNECTING.md
   + CHANGELOG. Published only with Sam's yes (see memory: bridge publish + no-cache redeploy).
3. **Seed Skeen's Brand** from the values above (draft; Sam publishes).
4. **Skeen adoption** (`~/Desktop/Projects/skeen-website`): take 0.41, map tokens to
   `--brand-*` with fallbacks, apply the font variables and Google stylesheet, theme-color and
   apple-touch-icon. Deployed only with Sam's yes (push to main; redeploy without build cache).
5. FTBK later.
