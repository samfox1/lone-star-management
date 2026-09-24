# Brand page rebuild — plan of record (2026-09-23)

The spec is the prototype: `prototypes/brand_variants_20260923.html` (layout "A Ledger"),
published at https://claude.ai/artifact/LTgzExhihuFrQb8ksKRcgy. Where this file and the
prototype disagree, this file wins (it carries Sam's later calls and the data model).
`BRAND_COLORS_PLAN.md` is superseded by the Colors section below.

## Sam's decisions (all 2026-09-23)

- **Layout A, "Ledger".** No cards. Mono section word on the left, rows split by hairlines,
  label left, control right. Content fills the width up to ~1180px.
- **Brand gets sub-tabs** like Settings: **Logos · Colors · Fonts · Tab icon**. The sub-panel
  sizes to its longest label; a label never wraps or truncates ("Tab icon" pushes the page over).
  No Press photos tab (the Images page already holds photos).
- **Dashboard now, sites later.** Every control is built and saved now. The websites start
  reading the home-screen icon, browser-bar colour and brand colours in a later round.
  No bridge release, no site deploy, in this round.
- **One Publish bar, bottom of the screen, bigger,** red dot + "<what changed> · not on the
  site yet", Revert + Publish. It is **hidden until a real change** and slides up. Opening a
  modal, focusing a field or picking the same value is not a change.
- **Icons, not words,** for row actions, each with a small dark hover label under it
  ("Edit", "Preview", "Upload new", "Remove", "Add logo", "Change font", "Remove background").
  Hover labels open *above* the control when the control sits at the bottom of a modal.
- **Modal footer button says "Save"** everywhere, never "Done" (site-wide rule).
- **Titles:** built-in rows (Primary logo, Secondary logo, Primary, Secondary, Tab icon,
  Home-screen icon, Browser bar) have a fixed title and fixed grey guide text. Everything the
  user adds, and every colour, has a renamable title and an editable note: click → a thin
  underline only, type, Enter or click away saves. Empty note shows "Add a note…".
  (This guide text is an approved exception to the no-instruction-copy rule, Brand only.)
- **Add flow, every list:** "+ Add logo / color / font" (hover turns it black, no box) →
  name field with ✓ (blue on hover) and × (red on hover) → focus lands in the new row's note
  (hint still showing) → Enter moves focus to the row's **+** (full black, blue focus ring) →
  that + does the thing (upload the logo, pick the colour, pick the font).
  A row is **saved when it gets its thing** (logo file, colour hex, font). Until then it is
  client-only; abandoning it leaves nothing behind. New colours pre-fill "Color N", selected.
- **Delete added rows:** a trash icon at the end of an added row, faint until the row is
  hovered, asks to confirm (`useConfirm`). Built-in rows cannot be deleted.
- **No "used in N places".** Custom sites announce their regions only at runtime, over the
  frame, so the dashboard cannot count honestly.

## Tabs

### Logos (`/artists/[id]/brand`)
- Rows: Primary logo, Secondary logo (built-in), then added logos. Tile shows the logo on a
  checkerboard; empty tile says "Add".
- Row icon: **pencil** (Edit) when a file exists, **+** (Add logo) when empty. No eye.
- **Logo editor modal** (Sam, 2026-09-23 later: "the wrong size"): the card hugs the 320px
  square board — one column, no thumbnail in the header. Under the board, one bar: **+**
  (Upload new / Add logo) bottom-LEFT, background circles centred (**Transparent · Light ·
  Dark · one per brand colour**, hover label = name), **trash** (Remove, disabled when empty)
  bottom-RIGHT. Warnings stack under that. **No sliders on logos.**
- **Upload warnings** shown in the modal after an upload: low resolution, a flat opaque
  background ("This logo has a white box behind it."), very large file. When the background
  is flat: an eraser icon **Remove background** runs the flat-colour cut-out, shows it on the
  board at once, and keeps the original (`media.source_path`). If the background isn't flat,
  say so instead of trying. No AI version.

### Colors (`/artists/[id]/brand/colors`)
- **Primary** and **Secondary** are built-in rows (fixed title + guide text, empty until
  picked — Sam, 2026-09-23 later), then a plain palette of added colours **Color 3, …** — no
  other roles. Row: renamable name, note, swatch +
  hex field. Click the swatch → the site-styled colour panel opens **to the left**, never over
  the row: "On the site" swatches, a shade square, a hue bar, a hex box. Typing a hex on the
  row + Enter works too. **Standing rule: this is `ColorPalette`** (extend it with a
  presentation variant; do not write a second picker).
- **Eye → playground modal:** a sample card (editable title "Test", a line of text, a link, a
  Tickets button). On the right the user picks which of their colours is **Background, Text,
  Border, Accent**; it updates live. Under it, plain words: **"Easy to read"** or red
  **"Hard to read"** (text on background, WCAG 4.5:1). No numbers anywhere. The playground is
  for trying combinations; it saves nothing.
- Colours save as you go (dashboard-only this round) and appear first in the **site editor's
  swatches**, by name.

### Fonts (`/artists/[id]/brand/fonts`)
- Rows = font slots. **Primary, Secondary** built-in (fixed title + guide text). Added fonts
  use the custom slots (max 3; the Add row hides when full) with a renamable title + note.
- Row: font name in its own face, sized by **measured capital height** (13px caps; thin or
  short-capped faces like Skeen's Sorg get more px — Sam: "super small"), **chevrons-up-down** icon (Change font), eye.
  Empty added row: grey "No font yet" + **+** (Add font); once a font is chosen, the + becomes
  the chevrons and the eye appears.
- Change → a small menu to the left: the artist's fonts (each in its face, current one bold),
  then **"Upload a font…"**. Picking the same font does nothing.
- Under the note: the file's **weight** (Regular, Medium, Bold…). If Bold is missing, a red
  "no Bold" (browsers fake it). Weight is read from the file (OS/2 usWeightClass) for
  ttf/otf/woff; for woff2 the upload asks.
- Eye → preview modal in that font, "Test" editable, with the font's name under the sample.
- Custom slot titles are what the **site editor's font list** shows.

### Tab icon (`/artists/[id]/brand/icons`)
- Rows (built-in, guide text, no notes):
  - **Tab icon** — 64px preview + pencil. Editor: board, **+** (upload its own image) and a
    **"Select a logo…"** dropdown (Primary, Secondary, added logos), Size and Up/down sliders,
    Reset. Transparent/light/dark circles not needed here.
  - **Home-screen icon** — same editor, its own source and framing, preview in a rounded
    phone-icon shape. Generates a 180px PNG (like the favicon).
  - **Browser bar** — swatch + hex via `ColorPanel`. Saves as you go.

### Brand kit
- A download icon, top right of every Brand tab ("Download brand kit"). Downloads a zip of
  what is **live on the site**: logos, tab + home-screen icons, font files for published
  slots, and `colors.txt` (name, hex, RGB). A real link to a route that checks ownership.

## Data model — one migration, not pushed until Sam says yes

- `media`: add `note text` (dashboard-only, NOT in the publish snapshot), add
  `source_path text` (original file kept after a background cut-out; storage GC must treat it
  as referenced). Widen `media_purpose_check` with `logo` (added logos, `label` = title),
  `home_icon` (generated 180px PNG), `icon_source` (an image uploaded just for an icon).
- `artists`: `favicon_source_media_id uuid null` and `home_icon_source_media_id uuid null`
  (null = the primary logo; FK to media, on delete set null), `home_icon_zoom`,
  `home_icon_offset_y` (same checks as the favicon's), `theme_color text` (hex check).
  None of these join the published snapshot this round.
- `brand_colors`: `id, artist_id, name, hex, note, sort_order, created_at`. `hex` checked
  `^#[0-9a-f]{6}$`, `name` 1–40 chars with no CR/LF, cap per artist (24) enforced in the
  database. RLS `is_admin() or is_manager_of(artist_id)`. Grants per AGENTS.md: revoke from
  `public, anon`, grant to `authenticated, service_role`. Not publishable this round.
- `artist_font_slots`: add `label text` (custom slots' title; null for primary/secondary) and
  `note text`. Not in the snapshot.
- `artist_fonts`: add `weight smallint` (100–900, nullable).
- Brand publish stays `media` + `artist_font`. The bar's "dirty" must be **brand-scoped**
  (brand purposes + font slots), not every media row on the account.

## Rules for every builder

- Read `AGENTS.md` first. Tests must be able to fail: see each new test red for the right
  reason (test-first) or delete the guard once to watch it go red, then restore. Denials need
  a planted witness and the specific error code. Derive fixtures from registries.
- Tests go in `tests/unit|components|integration/<subject>/`. Pure modules with DB-free tests
  go on the `mutate` list in `stryker.config.json`.
- Never `npx supabase`, never `supabase db push` (the orchestrator pushes after Sam's yes),
  never `supabase db reset`, never any seed-skeen / pull-skeen / skeen-* script.
- Do not kill or restart the dev server on :3000. Run the gstack `browse` tool only with the
  scratchpad as the working directory, never from inside the repo (its log files make
  Turbopack rebuild every second).
- Do not commit, push, or publish the site-bridge package. Do not touch `packages/site-bridge`
  except for type-only widening if the compiler requires it, and say so.
- Reuse: `modal-kit.tsx`, `card-modal.tsx`, `PortalModal`, `toast` (refusals are `'error'`),
  `useConfirm`, `UploadField`, `ColorPalette`, the site's own `<Icon>` set.
- Stay inside the files you own. If you need a change in someone else's file, say so in your
  report instead of making it.
