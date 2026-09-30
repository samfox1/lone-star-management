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
| Meta AI | Meta-WebIndexer | Let it in (**not tested yet**) |
| Alexa | Amzn-SearchBot | Let it in (**not tested yet**) |
| DuckDuckGo | Mostly Bing + DuckAssistBot | Bing + let DuckAssistBot in (**not tested yet**) |
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

## The honest pitch

Say: **"We do everything Google, Microsoft and the AI companies document to get your site found,
we make sure no AI crawler is ever locked out, and we show you the numbers."** That's true and
provable.

Don't say "you'll be picked up by AI" or "guaranteed". Google says AI Overviews need nothing
special beyond being indexed; Bing says its guidance "doesn't guarantee citations"; research says
coverage on OTHER sites (press, databases) matters more than anything on the artist's own site.
No vendor except Google and Microsoft documents reading schema markup for answers.
