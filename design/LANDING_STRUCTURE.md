# Lone Star landing page — a structure to design into

Drafted 2026-09-17. Sections in order, what each has to do, and what it must not do. Design
into these rather than a blank frame; move or drop any of them once you can see it.

**The one idea, from SERVICE_MODEL_PLAN.md:** Lone Star is the artist's *brand system of
record*, with a human service layer that fills it. The website is one renderer of that
system. A tour poster is another. That sentence is the page. Every section either proves it
or goes.

**Who is reading:** an artist or their manager, on a phone, sent by someone they trust. They
are not comparing feature tables. They want to know whether this is for them in five
seconds, and what happens next.

---

## 1. Hero
One line saying what it is, one line saying who it is for, one action.

Not "the artist operating system". That names a category nobody searches for. Name the
thing they recognise: their site, their songs, their shows, their brand, in one place, kept
current without a developer.

- **Motion:** the one place worth spending it. Something that suggests one system rendering
  onto many surfaces. A poster, a site, a cover, sharing the same colours as they change.
- **Action:** one button. See the work, or get in touch. Not both.

## 2. The work — Sam's ask
The sites, as images or video. Today that is **Skeen** and **FTBK**; the section has to
still look right with two, and with nine.

- **Video beats a screenshot** for a site with motion. A 6-10s silent loop, scrolling the
  real page, is the strongest thing on this page. Autoplay muted, `playsinline`, poster
  frame for the first paint.
- **A laptop or phone frame** around each keeps two very different designs from fighting.
- **Name the artist and link to the live site.** The link is the proof; without it these are
  just pictures.
- **Two is thin, and that is fine** if each is big. Do not pad with mockups of sites that do
  not exist.

**Blocker to clear first:** FTBK has no live URL. Its `custom_site_url` is
`http://localhost:3004`, which in production means the artist falls back to a template site
(that guard exists on purpose). It needs a real deploy before it can be linked or filmed.

## 3. The numbers — Sam's ask
Roster-wide totals only. No per-artist figures on the live page (Sam, 2026-09-17), and
**nothing before 12 Sep 2026**: rows before the cut-over were written without bot filtering,
so they are not a number to stand behind.

### What is actually there, 12-17 Sep 2026 (six days, four artists)
Read on 2026-09-17. Six days is a short window; these grow.

| | |
| --- | --- |
| Views | **1,162** |
| Visits | **904** (visitor-days: one fan on three days counts three. Never call it "unique fans".) |
| Clicks out to platforms, socials, links | **394** |
| Songs played | **82** |
| Countries | **53** |
| Cities | **355** |
| Bots filtered out | 13 |

All-time, not from this window, and worth checking for test rows before they go on a page:
**10** booking enquiries, **8** newsletter signups.

### The metrics that make the case
Pick four or five. A wall of numbers reads as padding.

1. **Views.** The plain one everybody understands.
2. **Clicks out.** 394 against 1,162 views is about **one visit in three ending in a click**
   to a song, a social or a link. That RATE is the strongest number on the page, and it
   stays strong while the totals are small — which they are, for now.
3. **Reach.** 53 countries and 355 cities for a roster of four is a genuinely good line.
4. **Songs played** — the thing an artist cares about.
5. **Booking enquiries.** The only metric here that is money. Check the row count is real
   first.

Not yet: ticket and merch clicks are **zero** in this window, so leave them off rather than
show a nought. "Unique fans" cannot be said honestly at all — the visitor hash rotates
daily, by design, so nobody can be counted twice across days.

### Mock numbers while designing
Sam, 2026-09-17: mock data is fine for now. Two rules so it never ships.

- **Label it in the frame**, e.g. `MOCK` beside the block, or a magenta text style used
  nowhere else. Whatever is obvious at a glance in a screenshot.
- **Use plausible shapes, not fantasies.** 50k views under a four-artist roster reads as a
  lie to anyone who looks. Multiply what is above by three or four.
- Before launch these get swapped for live figures pulled from the same readers the
  dashboard uses, or for written ones with a date beside them.

## 4. What Lone Star offers — Sam's ask
The base subscription, then the three named add-ons: **Words**, **Identity**, **Assets**.

- **The base is everything already built**: the site, the visual editor, publishing and
  version history, media, music, tour, EPK, enquiries, analytics. One line each at most,
  and a screenshot carrying the weight.
- **The add-ons get one line each**, plus the rule that makes them different from an agency:
  the work lands inside the system as something reusable, not as a file emailed over. A bio
  goes into the bio field; a logo goes into the brand library and renders a poster next
  March without anyone being paid again.
- **Show, don't list.** The click-to-edit editor mid-edit is worth more than any bullet.

## 5. Reviews — Sam's ask
What the artists say, in their words.

- **Real quotes only, attributed, with a photo.** Two honest sentences from Skeen and FTBK
  beat six invented ones, and invented ones are not an option.
- **You do not have these yet.** Ask both, today, in a message: what was annoying before,
  what changed, one sentence each. That is the whole section.
- **Design it to hold two.** A three-column grid with one empty cell looks like someone left.
- Until the quotes arrive, design the block with the real question in it as placeholder
  text, so nobody mistakes it for finished.

## 6. Who it is for
Short and honest. A working artist with releases and shows, or their manager. Not a label's
roster of two hundred. Saying who it is not for is what makes the rest believable.

## 7. Price
Say something, even before it is settled: what the base covers, that add-ons are named
packages and not a menu of fifteen line items. Silence here reads as expensive.

## 8. The close
One action, the same one as the hero. An email or a form, not a signup wall — there is no
self-serve product behind it yet, and a fake "Start free" is a broken promise.

---

## Rules for the whole page

- **Two type faces, the ones you already ship:** Instrument Sans for everything you read,
  Space Mono for labels, numbers and small caps. No third face.
- **Black, white, one blue.** `#2563eb` is the only accent. Colour comes from the artist
  work you show, not from the page.
- **4px grid, 8px corners on controls, 12px on panels.** Same as the product, so the page
  and the app look like one company.
- **Desktop first** (Sam, 2026-09-17), then check 390px before it is built. Most of this
  traffic arrives as a link in a DM, so the phone frame decides whether it survives — but
  the wide frame is the easier one to think in, and the work section needs the room.
- **Every screenshot is real.** A mockup of a screen that does not exist is the one thing
  that makes the rest of the page suspect.

## Motion, where it earns its place

Three moments, not twelve: the hero's one idea, the site videos in section 2 (which move by
themselves), and whatever shows the editor being used. Everything else can be still.

Write each as a sentence when you hand it over — what moves, how far, how long, in what
order. That is what turns into code.

---

# References Sam sent (2026-09-17), and how each one is actually made

I opened all three and read what they load. They are three different techniques, not three
versions of the same one, and that matters for what we copy.

## internetartclub.com — art direction, cheap technology
Next.js. **No WebGL, no canvas, no animation library at all.** Five SVGs and a pile of
images. Every bit of its personality is *taste*: a scanned gilt picture frame around the
whole viewport, cut-out collage (a nun with an iPod, pixel clouds, a Windows error dialog,
Kirby), one serif wordmark, one bordered Enter button on black.

The lesson: the most distinctive of the three is the one with the least technology. What it
costs is not engineering, it is a collection of images and the nerve to place them.

## leoburnett.com — one full-screen WebGL scene
Next.js with a single `<canvas>` at viewport size running WebGL: a drifting starfield, the
script-lettering logo and a lion mark floating in it, pill-shaped nav on black, one acid
green accent.

The lesson: one idea, done at full bleed, carrying the whole page. Everything else is
restrained to the point of plainness so the scene reads.

## theheavybear.com — a shader tool, embedded
WordPress, and the motion comes from **`unicornStudio.umd.js`**: Unicorn Studio, a visual
tool for building shader scenes that you embed. (It did not render in my headless browser —
worth opening yourself to see what it does.)

The lesson, and it is the useful one for Sam: that class of motion is now a *tool you design
in*, not code someone writes by hand. Same category as Rive.

## What this means for Lone Star

Two routes, and they can be mixed:

1. **Art direction** (Internet Art Club). Collage, texture, a frame, deliberate ugliness.
   Costs image-making, not engineering. Suits a company whose product is other people's
   brands — but it competes with the artist work on the page for attention.
2. **One scene** (Leo Burnett, Heavy Bear). A single WebGL or shader idea behind
   near-plain type, built in Rive or Unicorn Studio and embedded, or written by hand.

Lone Star's own idea points at a third thing that neither reference does: **one brand
system rendering onto many surfaces**. A hero where a poster, a site, a cover and an EPK
share one palette, and the palette changes, is a motion idea that is *about the product*
rather than decoration on top of it. That is the one worth prototyping first.

---

# The brand-colour idea (Sam, 2026-09-17)

> "Instead of branding my site with the blue and red… have the artist choose two colours, a
> primary and secondary of their own brand, then the blue and red turn to that artist's
> colours, so the experience is aligned with their branding."

**This is the strongest idea in the whole page, because it is the product's own argument
performed on the homepage.** Lone Star is the brand system of record; a site that can wear
any artist's brand is that sentence, demonstrated, before a word is read.

Built in `design/variants/m-collage.html`: every accent is `--brand-1` / `--brand-2`, and a
switcher at the foot re-skins the page. Blue and red are simply Lone Star's own entry in
that list, not the site's identity.

**Where the colours come from, for real.** Not hand-set. Each connected site already
declares its palette (`styleOptions`, `CONNECTING.md` §4), and `get_public_site` returns it,
so the landing page can read every artist's real two colours at build time. The mock hard-
codes them; the real one should not, or it drifts the day an artist restyles.

**Three ways to drive it, worth deciding before it is built:**
1. **The visitor picks**, from a row of artists. Playful, and it makes the roster the
   control. What the mock does.
2. **It follows the work on screen** — as the collage brings a Skeen cover past, the page
   is in Skeen's colours. Strongest idea, hardest to make legible.
3. **One artist per visit**, chosen at random. Quietest, and every visitor sees a coherent
   page rather than a toy.

**The trap:** an artist's palette can be low-contrast against white, or two colours that
fight. The page needs a floor — check contrast against the paper and fall back to ink for
text, using the colour only for accents. Skeen's cyan on white is already the case that
breaks naive use.

## The collage (same file)

The wall is no longer screenshots of pages. It is the real material, pulled from the
database and cached in `design/variants/assets/` (74 items: 11 song covers, 8 release
covers, 38 video stills, 17 photographs), mixed with the product's own components — a stat
card, a tour date, a merch tile, a press-kit button — so Lone Star's work sits inside the
artists'. Video stills carry a play badge in the artist's secondary colour.

Two things learned building it: a page opened from disk cannot `fetch()` a file beside it
(its origin is `null`), so the asset list is inlined; and at 1:1 the tiles must be small —
fourteen columns, not nine — or you only ever see five of them.
