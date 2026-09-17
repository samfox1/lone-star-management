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
