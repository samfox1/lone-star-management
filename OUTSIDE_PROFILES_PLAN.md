# Outside profiles in the visibility test (plan, 2026-09-30; decided 2026-10-01)

Sam, 2026-09-30:

> "these should be things that you add in the visibility test. If you can see that he hasn't
> updated them in a while … it should suggest him to do it … I am trying to build a longterm
> product that is capable of helping multiple artists, automated in any way possible."

**The problem.** An artist's facts live in many places: Spotify, Instagram, Apple Music, Bandsintown
and others. AI answers mix them all together. When they disagree, or one is empty, AI gets the
artist wrong.

**The goal.** Tapir checks every place it can on its own, and nudges the artist about the rest at the
right moment. A human only does what no API allows.

## The key idea: Tapir knows when the facts change

Platforms almost never say when a bio was last edited, so "hasn't updated in a while" can't be read
from them. But **Tapir knows when the artist's own facts change**: the bio, name, city, genre or
photo, on Publish. That is the moment every outside bio goes out of date.

- **When those facts change on Publish:** the test marks each outside bio "may be out of date since
  <date>", until the manager ticks it updated. This is the main nudge, it needs no API, and it works
  for every artist.
- **For places Tapir can't read:** a "last confirmed" date, and a gentle "check it's still current"
  after about 6 months.
- **For places Tapir CAN read:** compare their text with Tapir's facts. Does it name the site, the
  city and the genre?

## Every profile, and what Tapir can do

| Profile | Tapir can read it? | The check | If it can't read it |
|---|---|---|---|
| MusicBrainz | Yes (live) | the entry exists and links the site | — |
| Wikidata | Yes (being built) | the item exists, with the site (P856) and MusicBrainz ID (P434). Info only until the artist has press | — |
| Discogs | Yes, from the connected link (being built) | the page lists the site | — |
| YouTube | Yes: the channel description, with our YouTube key | it names the site, city and genre | — |
| Bandsintown | Yes, with the artist's key (their terms; fine while Tapir isn't paid) | the shows match Tapir's; "Bandsintown is missing 3 shows" → the CSV export | — |
| Instagram | Maybe: Meta's Business Discovery needs Tapir's own IG business account + Meta app review. **Research first** | the bio names the city and genre; the website field is the site | checklist |
| Spotify | Partly: the API has genres, followers and photos, but **no bio** | a photo exists, the genres are set | the bio: checklist + nudges |
| Apple Music | No (the Apple Music API costs $99/yr, and still has no artist-written text) | the link opens the right country (live) | Q&A + hometown: checklist; the main bio: the AllMusic email (live) |
| SoundCloud, TikTok, X | No | — | checklist + nudges |
| Resident Advisor | No (terms ban bots) | — | checklist; warn about same-name artists by hand |
| AllMusic bio | Sent or not (live, "Mark as sent") | — | after ~3 months: "check Apple Music shows a bio" |

## How it shows up

- **One new group in the AI test, "Outside profiles".** Each row is a profile, with the OUTSIDE TAPIR
  tag. The rows read the same way as today's: a mark, a short value, a card with what we saw and
  what to do.
- **The Profiles tab stays the workshop:** the bio email, the Bandsintown file, the "updated" ticks.
- **A tick is one click** ("updated"), stored in `profile_marks`. Its item list grows: spotify_bio,
  instagram_bio, and so on. That's a migration to widen the CHECK, plus a `confirmed_at` date.

## Decided (Sam, 2026-10-01)

1. **Score:** only the rows Tapir can check AND the artist can fix soon count (MusicBrainz, YouTube,
   Discogs once linked, Bandsintown). Wikidata and the checklist rows show, but don't lower the score.
2. **Nudges:** whenever the artist's facts change on Publish, plus a "still current?" check every
   6 months.
3. **Instagram:** research the Meta review after the rest is built. Until then it's a checklist row.

## Build order (each one small)

1. **The change nudge:** facts changed on Publish → "update these bios", with ticks. No outside APIs,
   so it's the biggest automation win.
2. **YouTube description check** (our key already works).
3. **The checklist rows** with "last confirmed" and the 6-month nudge.
4. **Bandsintown shows vs Tapir's**, when Skeen's account and key exist.
5. **Instagram**, after research.
