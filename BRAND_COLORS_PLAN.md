# Brand colours — plan

_Drafted 2026-09-17 from Sam's call: "when the artist onboards they select their brand
colours. They can choose multiple, and if it's super light maybe we add a warning. This can
also be updated in the brand page of manager tools."_

This is a small feature with a wide blast radius, because a brand colour is the first thing
that every other surface reads. Worth settling before it is built.

## What exists today, and the gap

The editor's colour picker offers a swatch row built by `siteSwatches`
(`src/lib/site-editor/style-apply.ts`): **the SITE's declared palette first**, then any
colour already used in saved styles. A site declares its palette in `styleOptions` as
class + hex pairs; sites that declare no hex contribute nothing.

So the colours a manager reaches for today come from *the website's code*. Nothing anywhere
records **the artist's brand**. That is the gap. A brand colour outlives any one website —
it belongs on the artist, not on a site's Tailwind config, and it is what a poster, a cover
template, an EPK and the Lone Star landing page all need to read.

## The shape

**Artist-level, ordered, few.** `brand_colors` on the artist: an ordered list of hexes.
Order IS the meaning — the first is primary, the second secondary, the rest are supporting.
No named roles beyond that, because every extra role is a decision an artist has to make
about a word rather than a colour.

- **Multiple, but capped.** Six. Past that it is a mood board, not a brand, and nothing
  downstream can decide which two to use.
- **Two is the working minimum.** Everything that renders a brand (the landing page, a
  poster, the EPK header) needs a primary and a secondary. One colour is allowed, and those
  surfaces fall back to ink for the second.
- **Hex only**, canonicalised the way the existing picker already does it.

## The lightness warning

Sam: "if it's super light maybe we add a warning." Concretely, and as a PURE function so it
can be tested and mutation-checked:

- Compute WCAG contrast against white paper (`#fff`) and against ink (`#111`).
- **Below 3:1 on white → warn, never block.** "Too light to read on white. We'll use it as
  a fill, not for text." The artist keeps the colour; the surfaces stop putting text in it.
- **Carry that verdict downstream** rather than re-deriving it per surface, so the landing
  page, the EPK and the site all make the same call. A colour that cannot hold text is a
  fill-only colour everywhere, or the rule is meaningless.
- Skeen's cyan against white is the live case that breaks naive use. Test with it.

## Where it is set

1. **Onboarding.** One step, after the artist's name and before anything else: pick your
   colours. The questionnaire is already the planned shape (`SITE_EDITOR_PLAN.md`).
2. **Brand page** (`src/app/artists/[id]/(dashboard)/brand/page.tsx`), which today has four
   rows: Primary logo, Secondary logo, Tab icon, Fonts. **Colours is the fifth row**, in the
   same grammar — left-aligned label, value on the right, no instructional copy.

The control is `ColorPalette` (`editor/color-picker.tsx`), per the standing rule: a custom
picker plus swatches, never a palette-class select. Reordering sets primary and secondary,
so the interaction is drag-to-reorder, not a dropdown labelled "role".

## Where it is read, and the precedence question

- **The editor's swatch row.** `siteSwatches` gains a source that comes FIRST: the artist's
  brand colours, then the site's declared palette, then colours already used.
- **The Lone Star landing page**, which re-skins to an artist's two colours
  (`design/variants/m-collage.html` is the mock). It must read the real record, not a
  hand-written list, or it drifts the day an artist restyles.
- **Later:** posters, covers, the EPK, anything the "Identity" add-on delivers into the
  system (`SERVICE_MODEL_PLAN.md`).

**Open, and worth Sam's call:** what happens when the artist's brand colours and the site's
declared palette disagree? Three answers: the site wins (it is what actually renders), the
artist wins (the brand is the record), or they are shown as two rows and the manager
chooses. The editor already has a drift-and-rebase pattern for exactly this shape
(`npm run rebase:styles`); the honest default is probably to show both and mark the
mismatch, since an artist's brand changing is the moment their site should be restyled.

## Building it

- Migration: `brand_colors jsonb` (an array of hexes) on `artists`, default `[]`, with a
  CHECK on shape and length. A setter RPC rather than a table write, so validation lives in
  one place: `set_brand_colors(p_artist_id, p_colors)`, `security invoker`, **revoked from
  `public, anon` and granted to `authenticated, service_role`** — the grant rule in
  AGENTS.md, and `npm run audit:grants` afterwards.
- Pure module `src/lib/brand-colors.ts`: canonicalise, cap, contrast verdicts, primary and
  secondary accessors. Add it to `mutate` in `stryker.config.json`.
- Tests that must bite: the cap; the contrast verdict at the 3:1 boundary from BOTH sides;
  that reordering changes primary; that a denied write leaves row state unchanged (asserted
  via the service client, not the return value); that the editor's swatch row puts brand
  colours first.
- The landing page reads it through `get_public_site`, so the payload gains the two colours
  and `CONNECTING.md` gains a line.

## What this is not

Not a full brand book, not typography (Fonts already has its own row), not per-surface
overrides. Those exist already, above this layer. This is the two-to-six colours an artist
would name if you asked them what their colours are.
