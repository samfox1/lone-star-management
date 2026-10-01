# The visibility recipe: every Digital Tapir site

Sam, 2026-09-30: "When I build more websites on digital tapir, I want a recipe for visibility that
works for all."

This is the checklist. Run it top to bottom for every new site, and keep it true: when a step is
built, changed or dropped, update its line here in the same commit. The details live in the
linked docs:

- CONNECTING.md §10 (site code)
- ADD_WEBSITE_PLAN.md (registration)
- VISIBILITY_TOOLKIT.md (research, what we skip and why)

Who does each step:

- **SITE**: the site's own code, through the bridge. The §7 tests check it on every build.
- **AUTO**: Tapir does it on its own.
- **YOU**: a person, once.

State: **live**, **building** (in progress now), **planned** (in TODO.md).

## 1. Build the site (SITE)

| Step | How | State |
|---|---|---|
| robots.txt lets every search and AI crawler in, and names the sitemap | `robotsRules(origin)` | live |
| sitemap.xml lists every public page, **each with its own last-changed date** | `sitemapEntries` (§10) | live, per-page dates **building** (bridge 0.45) |
| One address: the other spelling (www ↔ bare) redirects permanently (308) to the real one | the domain settings | live, the AI test checks it |
| Each page's canonical tag points at itself | `resolveSeo` / page metadata | live, the AI test checks it |
| Google and Bing ownership codes on every page, always | `siteVerification` in the root `generateMetadata` | live (0.44) |
| IndexNow key file at `/indexnow.txt` | `indexNowKeyFile` | live (0.42) |
| Title, description, share image; the fact sheet (JSON-LD); one h1 and an h2 per section; alt text on every image; an /about page; /faqsheet; /edit set to noindex | §10 builders | live |
| No `noindex` or `noarchive` on public pages (`noarchive` keeps a page out of Copilot) | the AI test | noindex live, noarchive check **planned** (step 3) |

## 2. Launch day (once per site)

1. **Deploy on the real domain.** Never a `*.vercel.app` preview.
2. **Publish once from Tapir.** This puts the IndexNow key live.
3. **Register:** `npm run site:register -- <slug>`. Tapir's robot becomes the owner in Google Search
   Console and Bing Webmaster Tools, Sam is added as an owner too, and both get the sitemap.
   *Later:* the Add website button on the admin page.
4. **Run the AI test.** Fix every red row.
5. **YOU: ask Google to list each page it hasn't yet.** In the AI test, click the page's
   Request indexing link (**building**), then click Request indexing in Search Console. It takes
   about 2 minutes. Google allows no API for this button.
6. **YOU: outside profiles.** Links from other places are the biggest lever of all.
   - MusicBrainz (the AI test checks it).
   - Bandsintown for Artists, with every show. It feeds Google, Spotify, Apple and Amazon.
   - An email to AllMusic/Xperi (content.music@tivo.com). It writes the Apple Music and Amazon
     Music bios.
   - Resident Advisor for DJs, after checking for a same-named artist.
   - One Discogs release.
   - The site link in the YouTube and Instagram bios. Spotify has no website field, so put the
     city, genre and site name in its bio text.
   Details: VISIBILITY_TOOLKIT.md "Round 2".
7. **Brave:** if the Brave check says the site is missing, submit it at
   search.brave.com/submit-url (**planned**).

## 3. Every publish (AUTO)

| What | State |
|---|---|
| IndexNow tells Bing, Yandex, Naver, Seznam, Amazon, the Internet Archive and Yep which pages changed | live. Sending only the changed pages is **planned** (step 3) |
| The sitemap is resent to Google when content changed | **building** |
| The AI test runs again once the live site shows the publish | live |
| A style-only publish (Brand) pings nothing and moves no sitemap date | pings: live. Dates: **building** |

## 4. Keep checking (AUTO; a person reads the results)

- **The AI test, live:** 24 checks, plus "How crawlers see your site". That section covers
  robots.txt, the sitemap, canonicals, crawler visits, whether Google lists each page, and when
  Bing last visited.
- **Planned (VISIBILITY_TOOLKIT.md):**
  - later: a monthly AI answers check on Perplexity and OpenAI (never relying on the Claude API)
  - a Wikidata check
  - Brave and Perplexity index checks
  - PageSpeed
  - uptime
  - Search Console and Bing numbers
  - the Knowledge Graph check

## 5. Never

- **The Google Indexing API for artist pages.** Google allows it only for job ads and livestreams,
  and misuse risks the robot account that owns every client site.
- **Blocking a search or AI crawler,** or an AI agent acting for a person (Google-Agent, ChatGPT
  agent, Claude-User). Vercel's AI Bots rule stays on Log, never Deny.
- **Storing answers from Gemini or Bing grounding.** Their terms forbid it, so they are live-only.
- **Creating or editing Wikidata or Wikipedia entries as Tapir.**
- **A sitemap date that changes on every request,** or that moves on every page at once.
- **Ownership tags shown only sometimes.** A missing tag un-verifies the site.
- **Saying "listed on Bing".** Bing only tells us when it last visited.

## What a new site costs a person

- **Once:** the register command, the Request indexing clicks, and the outside profiles.
- **After that:** nothing. Every publish does the rest.
