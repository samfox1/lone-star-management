# The visibility toolkit: free and cheap tools for every Digital Tapir site (2026-09-30)

**The checklist to run per site is VISIBILITY_RECIPE.md.** This file is the research behind it.

Research by three agents (Google, Microsoft, everyone else), official sources only; anything a
source didn't confirm is marked UNCONFIRMED. Builds on AI_VISIBILITY_AUDIT.md and
ADD_WEBSITE_PLAN.md (registration with Google and Bing is already planned there and not repeated).

Sam, 2026-09-30: "I want to tell the client you have the best chance of your site getting seen and
picked up by AI when working with us."

## Where each AI assistant looks

| Assistant | Searches | How a site gets in |
|---|---|---|
| ChatGPT search | Bing + OpenAI's own index (OAI-SearchBot) | Bing registration (planned) + let OAI-SearchBot in (tested) |
| Copilot | Bing | Bing registration (planned) |
| Gemini, AI Overviews, AI Mode | Google | Google registration (planned) |
| Claude, Mistral Le Chat | **Brave Search** (Anthropic subprocessor list, 2025; recheck quarterly) | Be in Brave's index; Brave follows the Googlebot rules. Submit form only, no API |
| Perplexity | Its own index | Let PerplexityBot in (tested). No submission exists |
| Siri, Spotlight, Apple Intelligence | Applebot | Let Applebot in (tested) |
| Meta AI | Meta-WebIndexer | Let it in (tested since 2026-10-01) |
| Alexa | Amzn-SearchBot | Let it in (tested since 2026-10-01) |
| DuckDuckGo | Mostly Bing + DuckAssistBot | Bing + let DuckAssistBot in (tested since 2026-10-01) |
| Grok | Not disclosed; also X posts | The artist's X profile |

## DO NOW: what Tapir does for every site

**Get found**
1. Google + Bing registration and sitemaps: ADD_WEBSITE_PLAN.md.
2. **Brave index check** (Claude's search): a weekly `site:` search through the Brave Search API.
   $5 free credit a month ≈ 1,000 searches. If a site is missing, submit it by hand at
   search.brave.com/submit-url.
3. **Perplexity index check**: the same through Perplexity's Search API, about $5 per 1,000
   searches (cents a month). Measuring is the only lever: Perplexity has no submission.
4. IndexNow (already on every publish) now also reaches Amazon, the Internet Archive and Yep.
   FIX: send only changed and removed pages, not the whole sitemap every time (IndexNow FAQ).

**Never get blocked**
5. **Three more crawlers in the site tests**: Meta-WebIndexer, Amzn-SearchBot, DuckAssistBot.
6. **Copilot tag check**: a `noarchive` tag keeps a page out of Copilot answers; `nocache` shrinks
   it to title + snippet. Today's `bing` test only fails on noindex (found.ts:550). FIX: fail on
   noarchive, warn on nocache/nosnippet.
7. Keep Search Console's new "Search generative AI control" on its default (include) per site.

**Show the proof (measure)**
8. **Google Search Console performance** per site (clicks, impressions, queries) through the API,
   with the planned service account. AI Overviews/AI Mode are counted inside "Web" (the API can't
   split them). Owners also get hacking/phishing alerts for free.
9. **Google's Generative AI performance report** (all sites since 2026-08-31): how often each page
   appeared in AI Overviews/AI Mode. Screen + CSV only, no API yet.
10. **Bing numbers** through the same Bing key: search clicks/impressions (web + Copilot mixed),
    crawl stats and an in-index count per site (what `InIndex` counts is UNCONFIRMED).
11. **Bing AI Performance report**: citations, cited pages and the phrases Copilot used. Free,
    screen only (no API); an artist can be given read-only access through the API.
12. **Microsoft Clarity Citations + Topic Insights**: which pages AI answers cite, and a free
    "who gets cited for these questions" probe (10 a week). Set up by hand per site. UNCONFIRMED
    whether it works without the Clarity script; try Skeen first.
13. **Vercel AI Bots ruleset in Log mode**: free on all plans, records which AI crawlers really
    visit. Log, never Deny.

**Keep the site healthy**
14. **PageSpeed Insights API** weekly and after each publish (Lighthouse: speed, accessibility,
    SEO). Free with a key.
15. **Uptime checks**: UptimeRobot (free, 50 sites, business use allowed) or Google Cloud
    Monitoring (1M free runs ≈ 38 sites at 5-minute checks). A site that's down can't be read.

**Identity**
16. **Knowledge Graph check**: does Google have an entity for the artist, pointing at their site?
    Free (100,000 a day). An info check beside MusicBrainz, not pass/fail.
17. **YouTube checklist** for the artist: the site in the channel's links; an Official Artist
    Channel through the distributor.

## LATER

- Common Crawl check (monthly crawls feed future AI training; nobody can request inclusion).
- Real-visitor speed data through the bridge (small sites get no Chrome field data).
- Web Risk API on ticket/merch/social links (100,000 a month free).
- Claim the Google knowledge panel once one exists; Google Search profile (US, 10k followers).
- Clarity script (heatmaps, recordings): needs a consent banner in the EU/UK.
- Bing backlinks + keyword data (which press links to the artist; name search volume).
- Merchant Center free listings (Google and Microsoft) through Shopify, when merch is unparked.
- A live "Ask Gemini about me" (Gemini API with Search grounding; storing its answers breaks the
  terms, so live only).
- Apple Music for Artists profile facts; press coverage (the biggest real lever, not automatable).

## SKIP (and why)

Cloudflare in front of Vercel (Vercel advises against it) · llms.txt (no AI vendor says it reads
them) · Google Indexing API (jobs and livestreams only) · a Rich Results Test API (doesn't exist) ·
Google Business Profile and Bing Places (need a physical place) · Brave Goggles · Perplexity's
publisher program · Apple Business Connect · Tapir writing Wikipedia articles (paid-editing rules) ·
GA4 (duplicates Tapir's analytics) · Bing URL/Content Submission APIs (IndexNow does it) · Clarity
Bot Activity (no Vercel support).

## Round 2 (2026-09-30): music profiles, asking the AIs, new standards

Three more research agents, official sources first. Sam: "What other tools or apis can I call to
improve my site's AI visibility."

**Corrections to what we had**
- **Spotify has no website field.** Its profile only takes Instagram, Facebook, X, TikTok,
  Wikipedia and WhatsApp. Put the city, genre and site name in the bio text instead.
- **Apple Music and Amazon Music bios come from AllMusic/Xperi** (both say so). One email
  (apple.coverage.support@xperi.com per Apple, content.music@tivo.com per Amazon: bio, a JPEG at
  least 800px, releases) updates both. See Round 3.
- **Google retired FAQ rich results** (2026-05-07). /faqsheet's FAQPage JSON-LD earns nothing in
  Google any more. It's harmless and AI still reads the page; just never call it a rich result.
- **Google's event results need one page per event** ("a leaf page"). Our MusicEvent nodes on the
  home page can't qualify. Listing shows on ticketing/event platforms is the easy route.
- **llms.txt: still skip.** In June 2026 Google added a line saying it isn't needed; no vendor
  says it reads it.
- **Perplexity's Sonar API ended 2026-09-27.** Build on its Agent API.

**DO (new)**
1. **AI answers check** (AUTO). Sam, 2026-09-30: later, MONTHLY, and never relying on the Claude
   API: use Perplexity and OpenAI only. The original design, weekly, about $3-5 per artist a month: Ask Perplexity (Agent API),
   OpenAI (`web_search`) and Claude (web search) 5 questions, 3 runs each: who is the artist,
   the latest release, the next show, the official site, how to book. Grade: is the site cited,
   is the artist named, do the facts match `get_public_site`. Report a rate ("cited 7 of 9"),
   never one answer: answers change run to run. Pin the location to the artist's city.
   NOT Gemini grounding or Bing grounding: their terms ban storing or analysing answers.
   It shows "what this AI's search finds", not exactly what fans see in the app.
2. **Wikidata check** (AUTO, free, no key): find the artist's item by MusicBrainz ID (P434) or
   official site (P856). Show "no item yet" as info. Never create or edit items as Tapir
   (self-promotion is discouraged; paid edits must be disclosed).
3. **AllMusic/Xperi email** (YOU): the Apple Music and Amazon Music bio. The most direct route
   toward Siri and Alexa.
4. **Bandsintown for Artists** (YOU): claim it and list every show. Bandsintown says it sends
   events to Google, Spotify, YouTube, Apple, Shazam and Amazon Music.
5. **Resident Advisor** (YOU, DJs): claim or create the profile, add bio + site. Manual only (its
   terms ban bots). CHECK NAME CLASHES: ra.co/dj/skeen looked like a Glasgow DJ (search snippet
   only; RA blocks fetching).
6. **One Discogs release** (YOU): creates the Discogs page; its ID links MusicBrainz and Wikidata,
   which helps tell same-named artists apart.
7. **VideoObject `creator`** (bridge, tiny): point it at the artist's `@id` (Google, 2026-09-24).
8. **Search Console platform properties** (YOU, free): add the artist's YouTube, Instagram, TikTok
   and X to see the Google traffic to those posts.
9. **Preferred sources link** (`google.com/preferences/source?q=<domain>`): fans who pick the site
   see more of it in Top Stories, AI Mode and AI Overviews. Check the site qualifies first.
10. **Shopify Agentic Storefronts**, when merch is unparked: lists products in ChatGPT, AI Mode,
    Gemini, Copilot and Meta. On by default for eligible stores.

**MAYBE**
- **Per-show pages** (`/shows/[id]`) with full MusicEvent markup: the only way the site itself
  reaches Google's event results.
- **LLMrefs** ($79/mo for 500 prompts, 8 engines, API included, about $0.80 per artist): a monthly
  reading of the consumer apps beside our own check. How it collects answers is UNCONFIRMED.
- **ProfilePage on /about**, **Google Trends API** (alpha, by application), **WebMCP** (booking
  forms for in-browser agents, later).

**SKIP (new)**
- NLWeb
- a site MCP server or ChatGPT app
- ACP/UCP checkout directly (Shopify covers both)
- the IETF AI-preferences draft
- speakable
- Gemini and Bing grounding for checks (their terms)
- scraping consumer AI apps (OpenAI's terms)
- Last.fm, Genius, Songkick
- the pricier trackers: Profound, Peec, AthenaHQ, Semrush, Ahrefs

**Never (new):** block AI agents acting for a person (Google-Agent, ChatGPT agent, Claude-User).

## Round 3 (2026-09-30): outside profiles, what we can read and write

Sam: "If we can write and read data through connecting to these APIs, lets do it." **None of the
four lets Tapir WRITE an artist profile by API.** What each allows:

| Platform | Read | Write | What Tapir builds | The artist does |
|---|---|---|---|---|
| **Bandsintown** | Yes, free. Key: Bandsintown for Artists > Settings > General > Get API Key (no email needed now); one key per artist. Terms: a PAID service needs written approval; session-only caching; branding + Track/RSVP buttons | No API. **CSV bulk upload** (25 rows per file, lands as drafts), manual entry, or auto-import from Ticketmaster, AXS, Eventbrite, See Tickets | **"Export to Bandsintown"**: a CSV of our shows in their template. Our own data, so the API terms don't apply. A read check only after written approval | Claim the page; invite Tapir as Editor; connect Apple Music + Amazon Music once; upload the CSV |
| **Discogs** | Yes, free (token; 60/min; a unique User-Agent). Artist names/notes/links are CC0. Showing data needs a "Data provided by Discogs" link | No ("Artists are read-only") | **A check**: the artist's Discogs page lists the site; add it to `sameAs`. Link out, don't show their data | Submit one release that is sold or downloadable (not streaming-only). Skeen's page will be **"Skeen (2)"** (id 1230117 is someone else). Then add a factual profile + the site under Sites |
| **AllMusic / Xperi** | No (paid licence) | **Email only**: apple.coverage.support@xperi.com (Apple's page) and content.music@tivo.com (Amazon's). Months, not guaranteed | **A "bio pack"** email: bio, photo, releases (UPC/ISRC) filled from our data | Send it. Fill Apple Music for Artists' "in your own words" Q&A meanwhile |
| **Resident Advisor** | No. Terms ban bots; pages 403 to scripts | No API. RA Pro by hand | A checklist line only | Check ra.co/dj/skeen (maybe a Glasgow DJ); claim (content@ra.co) or create (ra.co/pro/dj-create.aspx, photo required, ~72 h) |
| **Wikidata** | Yes, free. `haswbstatement:P434=<mbid>\|P856=<url>` search, then the REST API. User-Agent with "bot" required; 200/min | Tapir never. The artist may create an item once independent press exists | **The Wikidata check** in the AI test (try each spelling of the site URL: the match is exact) | Wait for press, then create the item with P856 + P434, each backed by that source |

**Worth knowing:** RA's robots.txt blocks GPTBot, ClaudeBot, PerplexityBot, Applebot and Amazonbot,
so an RA page helps Google and fans, not most AI answers. Bandsintown sends shows to Spotify,
YouTube, Google, Apple Music and Maps, Shazam and Amazon Music in 24-48 hours (official).

## The honest pitch

Say: **"We do everything Google, Microsoft and the AI companies document to get your site found,
we make sure no AI crawler is ever locked out, and we show you the numbers."** That's true and
provable.

Don't say "you'll be picked up by AI" or "guaranteed". Google says AI Overviews need nothing
special beyond being indexed; Bing says its guidance "doesn't guarantee citations"; research says
coverage on OTHER sites (press, databases) matters more than anything on the artist's own site.
No vendor except Google and Microsoft documents reading schema markup for answers.
