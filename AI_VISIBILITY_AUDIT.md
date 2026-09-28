# AI visibility audit (2026-09-28)

Sam: "I want to also run an audit on our SEO/GEO/ and overall AI visibility. I know we have
that page but I have a feeling it is not to the standard that it should be." And the
direction behind it: Tapir as "the tool to get discovered by AI".

Three read-only passes: what crawlers and AI bots get from the live sites, the code and the
dashboard's SEO/GEO page, and the artist's identity off the site. Nothing was changed.
Checked against 2026 guidance (sources at the bottom), not against SEO_GEO_PLAN.md.

## Verdict

- **The plumbing is good.** skeenmusic.com serves everything in plain HTML, every AI crawler
  gets the same 200, and the structured data is broad and valid. Most artist sites have none
  of this.
- **The SEO/GEO page doesn't measure anything and has no priorities.** It is a set of forms.
  Nothing asks an AI engine anything, nothing is stored, and the one check sits on the last
  tab and forgets its result.
- **The biggest gap is off the site.** Skeen isn't in MusicBrainz, Wikidata or Discogs, the
  databases AI answers lean on for musicians, and "Skeen" is a crowded name.
- **Only 1 of 3 sites uses any of it.** ftbk has no sitemap, robots or structured data. The
  Wren test site is gone (Vercel: `DEPLOYMENT_NOT_FOUND`).

## What's good (keep it)

- Bio, songs, shows and links are all in the server HTML. GPTBot, ClaudeBot and PerplexityBot
  don't run JavaScript, so this matters most, and skeen passes.
- 12 crawler user agents (Googlebot, Bingbot, GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot,
  Claude-SearchBot, PerplexityBot, Google-Extended, Applebot-Extended, CCBot, plain curl) all get
  the same bytes, with no bot wall.
- robots.txt and sitemap.xml are valid. Canonicals are self-referencing. There are real 404s,
  and HTTPS with HSTS.
- JSON-LD: MusicGroup, WebSite, 7 MusicAlbum, ImageObject, FAQPage. `sameAs` matches the page's
  links 7 of 7.
- The OG image is exactly 1200×630, alt text is good, there is one h1, and `lang` is set.
- One set of pure builders in the bridge, about 80 tests, and a live check guarded against
  SSRF (requests reaching private addresses).
- AI-assistant referral visits are already counted in analytics
  (`supabase/functions/event/derive.ts:179`), so an outcome number is one query away.

## 1. Quick wins in our code (small, high value)

| # | Sev | What's wrong | Fix |
| --- | --- | --- | --- |
| 1 | HIGH | `<title>SKEEN</title>` on every page. The bare name gives an engine nothing to tell this Skeen from the others. | Default title = name + role + genre + city from the facts ("Skeen · Chicago house DJ and producer"), still overridable. `resolveSeo`, `listing.tsx`. |
| 2 | HIGH | `sameAs` keeps only on-site buttons from the bridge's 16-platform list, so most Connections never reach it. Its profile-URL rule also rejects any link with a type segment (`musicbrainz.org/artist/…`, `ra.co/dj/…`, `deezer.com/us/artist/…`), and it accepts `spotify.com/user/…`, a listener account (`seo.ts:132-160`). | Build `sameAs` from every connected profile, button or not, with a per-platform profile pattern. Drop Spotify `/user/`. |
| 3 | HIGH | No identity connections: MusicBrainz, Discogs and Wikidata aren't services, so even a pasted link never reaches `sameAs`. | Add them as link-only connections (not social buttons). They feed `sameAs` and `identifier`. |
| 4 | HIGH | Nothing tells search engines when something is published. | IndexNow ping on Publish (Bing, Yandex, Naver, Seznam; Bing feeds Copilot and ChatGPT search), for the changed URLs only. |
| 5 | HIGH | Shows can't be Cancelled or Postponed. Every show says `EventScheduled` (`seo.ts:205`). | A tour-date `status` mapped to `eventStatus`. Keep cancelled shows in the graph until their date passes. |
| 6 | MED | Every ticketed show claims `InStock`, an invented fact (`seo.ts:226`). | Omit `availability` unless the manager sets it. |
| 7 | MED | No answer to "when is Skeen playing next?" when there are no upcoming shows. The question is silently dropped. | State "no shows scheduled; recent: …" in the fact sheet and on the page. |
| 8 | MED | Every sitemap URL gets one site-wide `lastmod`, so a merch tweak re-dates /about. Google ignores lastmod it can't trust. | Per-page lastmod from a hash of each page's inputs. Drop changefreq and priority. |
| 9 | MED | `logo` = the 1600×800 hero photo. | `logo` from the Brand page's logo, or leave it out. |
| 10 | MED | A written answer to "next show" or "latest release" wins forever and goes stale. | Make those two answers automatic-only. |
| 11 | LOW | Shows have no time or timezone, releases have no ISRC or UPC, there are no `og:image:width/height` tags, the FAQ `about` points at an @id that isn't defined on that page, `inLanguage` is hard-coded, and `creditText` names the artist as the photographer. | Small fixes each (details in the code pass). |
| 12 | LOW | Doc drift: CONNECTING.md §10 names a `mediaUrl` option that doesn't exist. `src/lib/seo.ts` is a second copy of `resolveSeo`. UA strings still say lone-star. | Tidy. |

## 2. The SEO/GEO page (the product)

1. **An Overview tab first.** Show the 3–5 open items that matter most, in order: bots can reach
   the site, it's indexable, the bio is visible and long enough, identity links, shows are
   correct, alt text. Show outcome numbers (visits from search and AI assistants, from our own
   analytics) and the date of the last check.
2. **Checks that run themselves and are kept.** Run ~2 minutes after each Publish and weekly.
   Store the results and flag anything that broke (noindex appeared, JSON-LD broke, a bot is
   blocked, the canonical moved).
3. **Check like a crawler.** Fetch as Googlebot, Bingbot, OAI-SearchBot, ClaudeBot and
   PerplexityBot. Read response headers (`X-Robots-Tag`), check every sitemap URL (not just the
   home page), and check the title.
4. **Drop the checks for show:** the ">60 char description", "exactly one h1", and "has every
   field Google requires" for types Google has no rich result for.
5. **Real AI measurement.** Link Bing Webmaster Tools' AI Performance report, which shows
   Copilot citations and is free. Later, run an automated monthly probe of the 5 fixed questions
   through the Perplexity or OpenAI search APIs, and store cited yes/no plus the answer.
6. **Retire the hidden /faqsheet.** Google removed FAQ rich results on 2026-05-07, and it says AI
   features need no special files or markup. A page no visitor can reach gets little weight.
   Fold the Q&A into a visible "Quick facts" on /about.
7. **Richer facts:** city + region + country (so "Portland" isn't ambiguous), aliases, active
   since, members, a booking contact, and the press quotes already in the DB shown on the page.
   GEO research found quotes and stats lift visibility by about 30–40%.

## 3. Sites

- **One pattern, enforced.** Each site hand-wires about 6 SEO files today, and nothing checks
  them. Ship drop-in `robots`, `sitemap`, fact sheet and metadata exports from the bridge, and
  make "passes the live check" part of connecting a site.
- **ftbk:** none of it yet (Phase 4 is waiting on Sam).
- **Wren:** the deployment is gone. Redeploy it or retire it as the reference site.
- **skeen:** the http → https → www redirect takes 2 hops. The Apple Music link is pinned to the
  Norway storefront (`/no/`). Merch pages aren't in the sitemap yet (they matter once merch is
  live).

## 4. Off the site (the artist or Sam; Tapir can guide)

| # | Sev | What | Who |
| --- | --- | --- | --- |
| 1 | HIGH | **Create a MusicBrainz artist entry.** It's free and open, and its ID flows into Wikidata and many music apps. It's the canonical source most cited for musician entities. | Artist or Sam; Tapir gives a checklist. |
| 2 | HIGH | **Say it the same way everywhere:** "Skeen, Chicago house DJ and producer". The surname is crowded (a Wikipedia disambiguation page, 9+ unrelated Wikidata items). One press piece places him in Madison, WI, while the site says Chicago. | Artist; Tapir keeps its own fields consistent. |
| 3 | MED | Claim Spotify for Artists and Apple Music for Artists (verified profiles). Request a YouTube Official Artist Channel through the distributor. | Artist; Tapir reminds. |
| 4 | MED | Set up Google Search Console and Bing Webmaster properties. This is still open from the SEO plan. | Sam, once. |
| 5 | MED | The bio is about 338 characters. The plan's own target is 2,500 or more, and it's still unmet. Name the notable shows and releases in sentences (ZHU at Navy Pier, the Flume remix, OutWest). | Artist or Sam. |
| 6 | LATER | Wikidata needs notability (independent press) first. Discogs pages only appear when a release is submitted. | Artist, longer term. |

## Don't bother

- **llms.txt:** Google doesn't support it, and log studies show AI crawlers almost never fetch
  it. Ahrefs found 97% of files got zero requests.
- **Chasing FAQ rich results:** gone in Google.
- **Google's sitemap "ping" URL:** deprecated by Google in 2023. Google has no IndexNow; it
  relies on the sitemap plus crawl.

## Corrections to the raw passes

- The live pass flagged a "different DJ Skeen" in Wisconsin. The off-site pass cross-checked
  it: it's the same Skeen (it cites his OutWest EP), just described with a different city. It's
  a consistency problem, not a rival artist.
- The off-site pass called Google's sitemap ping "still supported". It isn't (see above).
- PageSpeed couldn't be measured because the shared API quota was used up. Run it by hand at
  pagespeed.web.dev.

## Suggested order

1. Code quick wins 1–4 (title, sameAs from all connections, identity connections, IndexNow).
   They fit the bridge release that's already open (0.42.0).
2. The Overview tab and stored automatic checks.
3. Shows status, lastmod, and the rest of section 1.
4. Drop-in SEO for sites, then ftbk.
5. Off-site steps run beside all of this. They don't need code.

## Sources

- Google Event structured data: https://developers.google.com/search/docs/appearance/structured-data/event
- Google Organization / logo: https://developers.google.com/search/docs/appearance/structured-data/organization
- Google sitemaps (lastmod must be accurate): https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Google AI features and your website: https://developers.google.com/search/docs/appearance/ai-features
- Google title links: https://developers.google.com/search/docs/appearance/title-link
- FAQ rich results dropped (2026-05-07): https://www.searchenginejournal.com/google-drops-faq-rich-results-from-search/574429/
- Bing AI Performance report: https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview
- IndexNow: https://www.bing.com/indexnow/getstarted
- OpenAI crawlers: https://developers.openai.com/api/docs/bots
- Perplexity crawlers: https://docs.perplexity.ai/guides/bots
- AI crawlers don't render JS (Vercel): https://vercel.com/blog/the-rise-of-the-ai-crawler
- GEO paper (Aggarwal et al., KDD 2024): https://arxiv.org/abs/2311.09735
- llms.txt usage (Ahrefs): https://ahrefs.com/blog/llmstxt-study/
- MusicBrainz ↔ Wikidata: https://musicbrainz.org/doc/Wikidata
- Wikidata notability: https://www.wikidata.org/wiki/Wikidata:Notability
- Knowledge panels for musicians: https://labelgrid.com/blog/guides/google-knowledge-panel-for-musicians/
- YouTube Official Artist Channels: https://support.google.com/youtube/answer/7336634
