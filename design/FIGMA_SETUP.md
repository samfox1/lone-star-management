# Designing Lone Star in Figma

Written 2026-09-17, for designing Lone Star's landing page and, later, artist sites that
Claude builds in code. The tokens in `lone-star-tokens.json` were read out of the code the
same day; the CSS stays the source of truth.

## What the free plan gives you, and what it doesn't

Figma's Starter plan: **3 design files, 3 pages each, 1 project, 30 days of version
history, and one mode for variables. Dev Mode is not included.**
([Starter plan overview](https://help.figma.com/hc/en-us/articles/13838684089751-Starter-plan-overview),
[plans and features](https://help.figma.com/hc/en-us/articles/360040328273-Figma-plans-and-features))

None of that blocks this work.

- **One mode is enough.** One palette per file: Lone Star's landing page is light, the
  artist template is dark. Two files, not two modes.
- **Dev Mode is for reading CSS out of a design.** You do not need it: this file already
  holds every value, and what Claude works from is a screenshot plus these numbers.
- **3 files** is the real limit to plan around. Suggested: `Lone Star — landing`,
  `Artist site — template`, and one spare.

## Set the file up once

1. **Fonts.** Instrument Sans and Space Mono are Google fonts, so Figma has them. Archivo
   too, for artist sites. Nothing to install.
2. **Variables.** Open the Variables panel and add the colors from
   `lone-star-tokens.json` in two collections: `color` (Lone Star) and `cinematic`
   (artist sites). There are 17 and 8. Typing them in takes five minutes and needs no
   plugin; a free variables-import plugin can read the JSON if you would rather.
3. **Grid.** Nudge = 4px (Preferences → Nudge amount → Big nudge 4). Every spacing token
   is a multiple of it.
4. **Text styles**, from the `type` block: Label (Space Mono 700, 10px, uppercase,
   0.12em), Button (Space Mono 700, 11px, uppercase, 0.06em), Body (Instrument Sans 400,
   14px), Stat (Space Mono 700, 25px, -0.02em).
5. **Corner radii**: 8px for controls, 12px for panels. Nothing else.

## What to send Claude

Not the file. Three things:

1. **A screenshot** of the frame. Drag the PNG straight into the chat.
2. **Anything that is not in the token list** — a new color, a size you invented. Name it
   and give the value.
3. **Motion in words.** No design tool exports motion into code. Write what should happen:
   *"on scroll into view, each card rises 12px and fades in over 300ms, 60ms apart,
   ease-out."* A screen recording of a site you like works just as well.

That is the whole handoff. A comp plus numbers plus a sentence about movement.

## Two things worth knowing before you design motion

- **Entrance animations are currently switched off on Skeen** (paused 2026-08-12): the
  scroll watcher measures the moving box, so an element that starts off-screen never
  arrives. Design entrances knowing that; if a scheme needs them, say so and it gets fixed
  properly rather than worked around.
- **Artist sites are token-driven.** The editor can only change what a site declares —
  colors, sizes, fonts, per region (`CONNECTING.md` §4). A design whose every section has
  its own bespoke spacing is one the manager cannot edit afterwards. Design the system,
  then the page.

## Keeping this file honest

`lone-star-tokens.json` is a mirror, not the source. If the CSS changes, it drifts, and
nothing here will notice. Re-read `src/app/globals.css` before trusting it for a new page.
