# The Profile tool (plan, 2026-10-02)

Sam, 2026-10-01/02:

> "I think we have profile be its own page, but style it like the brand page."
> "one main profile photo that the user selects … select from those images or upload one to be
> their profile photo that is used throughout"
> "build profile"

The approved mock is `prototypes/profile_tool_20261001.html` (round 3): the + sits inside the
circle, and the image picker is big with no header.

## What it is

**One home for who the artist is.** The site, the press kit, the AI test, the AllMusic bio email
and the outside-bios nudge all read from it.

## Where it sits

- A top-level tool, **Profile**, in the tools rail right after Overview. It gets a new person
  glyph.
- The route is `/artists/[id]/profile`.
- One page, in Brand's ledger grammar:
  - LedgerRow rows, autosaving to the draft
  - the rising Publish bar
  - no sub-tabs

## Rows

| Section | Row | From today |
|---|---|---|
| WHO | Profile photo: one, a round tile with the + inside; it opens a big Images picker (the library + upload, where an upload lands in Images too) | "Site & profile" (template sites only) |
| WHO | Name | Settings › General |
| WHO | Bio, with its word count while writing | SEO/GEO › Facts |
| WHO | Type · Genre · Other names · Started | SEO/GEO › Facts |
| WHERE | Based in: city · region · country | SEO/GEO › Facts |

**What moves out:**

- **SEO/GEO loses the Facts tab.** Its tabs become Details · Answers · AI test · Profiles. The old
  route redirects to `/profile`, the same way the other old SEO routes do.
- **The bio's placement and heading** belong to how the site shows it. They move to the site
  editor; until then they stay where they are.
- **The connected profiles and MusicBrainz parts of Facts** go to SEO/GEO › Profiles.
- **Settings › General** no longer edits the name. It points to Profile.

## What reads the profile photo

- **The press kit** uses it first. Its "add a photo" hint points to Profile.
- **The AllMusic bio email** attaches it by default.
- **The outside-bios nudge:** a new photo counts as a fact change (OUTSIDE_PROFILES_PLAN). The
  photo is the `media` row with purpose `profile_photo`.
- **The site:** no change. The payload already carries media purposes.

## Rules

- **No database change expected.** The fields and the `profile_photo` purpose already exist. If
  one turns out to be needed, ask Sam before pushing.
- **Reuse the existing save and publish actions.** Facts, Settings and Site & profile already
  write these fields. Move the components; don't rewrite the actions.
- **Tests:** LIGHT for the page (one main-path test per row type). Strict only for anything new
  that writes data or checks permission.
- **Nothing looks different elsewhere,** except the rail gaining Profile and SEO/GEO losing Facts.
