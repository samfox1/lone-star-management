# SEO / GEO — Lone Star wide plan

_Drafted 2026-08-25. Grows out of the skeen audit
(`~/Desktop/skeen-website/SEO_GEO_PLAN.md`, 2026-08-17), which stays as the
per-site findings list. This file is the plan of record for doing it once,
in the bridge and the editor, so every connected site gets the same pattern._

## Goal

Every Lone Star site is easy for Google to index AND easy for AI answer engines
to quote. Skeen is the reference implementation; ftbk and wren follow the same
steps; new sites get the rules from CONNECTING.md.

SEO = the plumbing Google reads (meta, canonical, sitemap, robots, structured
data, headings, alt text). GEO = visible, quotable text about who the artist
is. Skeen has the first and almost none of the second.

## The principle, applied

"The editor supplies values. The site owns presentation." (CONNECTING.md §1)

So: the **editor stores strings and choices** in `site_content`, the **bridge
ships pure builders** (metadata, JSON-LD, sitemap entries, robots rules), and
**each site emits its own `<head>` and markup** from them. The bridge never
produces HTML. Nothing rendered is ever invented copy.

## What exists today (2026-08-25)

| Piece | Where | State |
| --- | --- | --- |
| `seo_title`, `seo_description`, `og_image` | `src/lib/site-content-schema.ts:73` (`SEO_FIELDS`), plain `site_content` keys | shipped; edited on `tools/seo` page, NOT in the visual editor |
| Social card generator | `tools/seo/og-image-picker.tsx`, `src/lib/og-card.ts` | shipped |
| Bio | `artists.bio` (plain text, `\n` paragraphs) → `payload.artist.bio` | shipped; edited via editor text field `artist_bio` |
| Site tab in editor | `editor/panels/site-tools.tsx` | cursor settings only; docblock names it the home for site-wide things |
| Reserved-key gate | `src/lib/site-editor/save.ts:49-56,83` | SEO keys refuse the generic field save; need their own gate (the `saveCursorField` pattern) |
| Metadata resolution | `src/lib/seo.ts` AND `skeen-website/lib/seo.ts` | two copies of the same precedence logic |
| JSON-LD | skeen `lib/jsonLd.ts` only (MusicGroup + WebSite) | lone-star templates emit none |
| Publish timestamp on the wire | none | `get_public_site` computes `published_at` internally, never returns it; `publish_moments` is authenticated-only |
| Releases on the wire | separate RPC `get_public_releases`, not wrapped by the bridge | skeen calls it by hand |
| Bridge SEO helpers | none | zero hits for sitemap/robots/ld+json under `packages/` |

## Decisions (Sam, 2026-08-25)

1. **Bio placement is the artist's choice.** Some artists do not want a bio on
   the homepage. For them the site has a real `/about` page, styled like the
   rest of the site, holding the bio. It is a **page, not a redirect**: a
   redirect would bounce crawlers back to the homepage and index nothing. The
   page is linked from the footer and listed in the sitemap, which is how
   crawlers find it.
2. **One bio.** `artists.bio` stays the single source: it feeds the About
   section or `/about`, the meta description fallback, JSON-LD `description`,
   and the EPK. Edited in the existing text editor. (Open: whether a site ever
   needs a separate, longer web bio. Not now.)
3. **SEO / GEO lives in the editor's Site tab**, as its own group. The
   standalone `tools/seo` page is retired once the Site tab has parity.
4. **Skeen first**, then the bridge generalises what skeen proved, then ftbk
   and wren adopt it.
5. **The site declares the default placement** (2026-08-26). Skeen removed
   its bio on purpose; deploying must not put it back. Manifest:
   `about: { placements: ['home','page'], default: 'page' }`.
6. **Genre and location are artist facts** (2026-08-26): columns on
   `artists` next to `bio`, in `ARTIST_SNAPSHOT`, so the EPK and copilot get
   them too. Not `site_content`.
7. **Images get descriptive slugs AND alt text, both editable** (2026-08-26).
   Auto-filled, manager can change either. Both must land in the final HTML:
   plain `<img src alt>` pointing straight at the storage URL. No
   `/_next/image`, no client-only rendering, no redirect chains.

## New content keys (all `site_content`, all optional, unset = auto)

| Key | Values | Used for |
| --- | --- | --- |
| `about_placement` | `home` \| `page` \| `hidden` | where the bio renders. Default `home` if the site declares it, else `page`, else `hidden`. `hidden` still emits the bio in meta + JSON-LD, so search still gets it |
| `about_heading` | text | heading over the bio (default: "About") |

Existing `seo_title`, `seo_description`, `og_image` stay as they are.

## New artist columns (`artists`, in `ARTIST_SNAPSHOT`)

| Column | Used for |
| --- | --- |
| `genre` | `MusicGroup.genre`, EPK. "Chicago DJ" style AI answers come from facts like this |
| `location` | `MusicGroup.foundingLocation` / "based in", EPK |

## Images: slug + alt (`media`, and release covers)

| Column | Default | Rule |
| --- | --- | --- |
| `slug` | slugified original filename | `a-z0-9-`, unique per artist. Changing it MOVES the object to `{artistId}/{category}/{slug}.{ext}` and updates `storage_path`, so the URL carries the name |
| `alt` | empty → site derives (caption, title, artist name) | plain description, not keywords. Editable in the Images panel, one field, no instruction copy |

Both ride the existing media snapshot (`alt` added; `path` already there).
Decorative images (cursor, ornaments) are the site's call: `aria-hidden`,
empty alt, never a manager setting. Skeen's `render/image` URLs are fine:
same host, one hop, filename in the path.

Add the new keys to `SEO_FIELDS` so they inherit the reserved-key rule, and
give them one validated write path (`saveSeoField`). Values are strings; the
enum for `about_placement` is checked server-side against what the site's
manifest declares (see bridge step B2).

## Phases

### Phase 1 — Skeen quick wins (no bridge change, ~1 day)

Each lands with a test that can fail. `test/build-output.test.ts` is the home
for "ships in real HTML" guards.

| # | Fix | Where | Test |
| --- | --- | --- | --- |
| 1.1 | Alt text: covers get the release/song title; polaroids get their caption | `components/MusicGrid.tsx:159,219,276`, `components/About.tsx:104` | built HTML: no `<img alt="">` outside `aria-hidden` |
| 1.2 | `<h2>` for Music, About, Videos. Use `<Text as="h2" field=…>` so they stay editable (a bare literal is invisible to the editor's DOM-derived manifest). Sr-only if the design forbids visible ones | `Work.tsx`, `About.tsx`, `Videos.tsx`, keys in `lib/siteText.ts` | built HTML: every `main > section[id]` contains an `h2`; `lib/editList.test.ts` key-collision guard |
| 1.3 | `/edit` noindex: new server `app/edit/layout.tsx` exporting `robots: { index: false, follow: false }`. Do NOT redeclare icons (build test pins exactly one `rel=icon`) | `app/edit/layout.tsx` | built `edit.html` has `<meta name="robots" content="noindex`; `index.html` does not |
| 1.4 | `X-Robots-Tag: noindex` header scoped to the `*.vercel.app` host | `next.config.ts` headers with `has: [{type:'host', value:'.*\\.vercel\\.app'}]` | none that bites locally (a config test would copy the implementation). `seo-check.sh` checks the live header after deploy |
| 1.5 | `app/not-found.tsx` on-brand 404 | skeen | returns 404 status (already does); cosmetic |
| 1.6 | Fix stale `vitest.config.ts:14` inline regex (`@lone-star/site-bridge` → `@samfox1/site-bridge`) | skeen | n/a, housekeeping |

Watch-outs: markers only emit in edit mode, so public markup is safe, but 1.2
adds `site_content` keys and manifest entries; `components/bridgeManifest.test.tsx`
will need its expected set updated (derive it, don't hand-list it). The
build test forbids any email address in the HTML; a bio containing an `@`
will trip it in Phase 3.

### Phase 2 — Bridge + editor (the generalisation)

**B1. `published_at` on the wire.** Additive field on `get_public_site`
(the `live` CTE already computes it). Bridge payload type gains
`published_at: string | null`. Test: RPC returns the max revision
`published_at` for the slug; publishing bumps it; a never-published slug
returns null.

**B2. Manifest declares about placements and the default.**
`TemplateManifest.about?: { placements: readonly ('home' | 'page')[]; default: AboutPlacement }`.
The editor offers only what the site declares (editor-adapts-to-site rule);
`hidden` is always offered; unset = the site's default. Test: `Record<AboutPlacement, true>`
compile guard; server rejects a placement the manifest does not declare.

**B3. `fetchPublicReleases` in the bridge.** Wraps `get_public_releases`
next to `fetchPublicSite`. Needed for MusicAlbum JSON-LD. Test: pure
mapping test against a snapshot.

**B4. New bridge module `seo`** (subpath `@samfox1/site-bridge/seo`), pure
functions, zero DOM:

```ts
resolveSeo(payload)                     // title, description, ogImage — ONE copy, replaces src/lib/seo.ts + skeen lib/seo.ts
jsonLdGraph(payload, { origin, releases?, aboutUrl? })
                                        // MusicGroup(+genre, foundingLocation, sameAs) + WebSite
                                        // + MusicEvent per dated upcoming show
                                        // + MusicAlbum per release (only when releases passed)
sitemapEntries(payload, { origin, pages, today }) // lastModified = max(published_at, latest show date now past)
robotsRules(origin)                     // { rules, sitemap, host }
aboutPlacement(payload, manifestAbout)  // resolves the default described above
```

Rules baked in: https-only `sameAs`, undated shows skipped, `<` escaped for
inline scripts, description collapsed + truncated at 160. Tests: port
skeen's `lib/seo.test.ts` cases and lone-star's `tests/seo.test.ts`; pin the
override precedence (currently unpinned anywhere); each JSON-LD type has a
fixture derived from the payload type, not hand-listed.

**B4b. JSON-LD fact sheet (Sam, 2026-08-26).** Invisible to viewers; a
standardized fact sheet for bots. Focus fields: `@type`, `event`,
`location`, `track`.

- `artists.schema_type`: `MusicGroup` (default) | `Person` (visual artists).
  Sets the root `@type`.
- `media.kind`: `photo` (→ `ImageObject`) | `artwork` (→ `VisualArtwork`) |
  `none`. Chosen when the image is added, editable after. Default by artist:
  musicians `photo`, visual artists `artwork`. Logos/favicons: `none`.
- Graph shape:
  - root `MusicGroup`/`Person` with `@id`, `name`, `description` (bio),
    `genre`, `foundingLocation`, `image`, `sameAs`
  - `track[]`: `MusicRecording` per on-site song (`name`, `byArtist`,
    `inAlbum`, `url` = stream link)
  - `album[]`: `MusicAlbum` per release (needs `fetchPublicReleases`)
  - `event[]`: `MusicEvent` per dated upcoming show. `location` =
    `Place { name: venue, address { addressLocality: city,
    addressRegion: state, addressCountry } }`, `offers.url` = ticket link,
    `performer` = artist + support
  - one `VisualArtwork` per `artwork` media (`name` = alt or label, `image`,
    `creator` → artist `@id`); one `ImageObject` per `photo` (`contentUrl`,
    `caption` = alt)
  - `WebSite` with `publisher` → artist `@id`
- All from published data only. Tests: fixture derived from the payload
  type; Rich Results Test clean; one `MusicEvent` per dated show, none for
  undated.

**B5. `auditSeo(html: string)`** in the bridge's audit module, run by sites in
their build-output tests. Takes the HTML string (build tests run in node, no
DOM); parse with `linkedom` inside the bridge. Checks: meta description present and >60 chars, exactly
one `h1`, an `h2` in every `section[id]`, no content `<img alt="">`, one
`ld+json` block that parses, canonical present, noindex on `/edit`.
Add to `checkContract` §7 as rule 6 "the public page is findable".

**B6. SEO / GEO group in the Site tab.** Rows (version-A key/value + hover
pencil, per the panel consistency rule): Title, Description, Social card
(reuse the og picker), About placement (select, filtered by B2), Genre,
Location. Bio row opens the existing `artist_bio` text editor.

**B6b. Slug + alt on images.** Migration: `media.slug`, `media.alt`; backfill
slug from `storage_path`. `renameMediaAction` validates the slug, moves the
object, updates the row (one transaction; on move failure the row is
untouched). Images panel tile gets three fields: slug, alt, kind (B4b). Tests: slug collision
rejected; move failure leaves `storage_path` unchanged; `alt` appears in the
publish snapshot (derive the snapshot fixture from `PUBLISHABLE.media`). Then delete
`tools/seo` (its Publish button was only there because the page was outside
the editor). Tests: component test for each row's save call; reserved-key
refusal still pinned in `tests/editor-field-save.test.ts`.

**B7. CONNECTING.md §10 "Be findable."** The rule sheet for new sites:
emit `resolveSeo` in `generateMetadata`, inline `jsonLdGraph`, `sitemap.ts` +
`robots.ts` from the builders, one `h1`, an `h2` per section, `/edit`
noindex, honour `about_placement` with a real `/about` route when you
declare `page`. Images: plain `<img>` in server HTML, `src` straight at the
storage URL (object or render/image, never `/_next/image` or a site proxy),
`alt` = `media.alt` else the site's derived text. Add "SEO" to the sample manifest.

Bridge bump to **0.33.0** (`package.json` + `PACKAGE_VERSION`), publish, then
sites redeploy **without build cache** (memory: bridge-deploy-cache-gotcha).

### Phase 3 — Skeen adopts the bridge version

| # | Fix | Test |
| --- | --- | --- |
| 3.1 | Replace `lib/seo.ts`, `lib/jsonLd.ts` with bridge builders; delete the local copies | existing `layout.test.ts` still green against bridge output |
| 3.2 | About: render bio per `about_placement`. `home` → paragraphs in the About section (polaroid wall keeps its place); `page` → new `app/about/page.tsx` using the site's fonts/tokens/nav/footer, footer link "About", sitemap entry | built HTML: with `page`, `/about` ships the bio text and `index.html` links to it; with `home`, `index.html` contains the bio; with `hidden`, neither, but the meta description and JSON-LD still carry it |
| 3.3 | JSON-LD: MusicEvent + MusicAlbum via `jsonLdGraph` with `fetchPublicReleases` | build test parses the graph, finds one `MusicEvent` per dated upcoming show and one `MusicAlbum` per release |
| 3.6 | Bing: add the property in Bing Webmaster Tools (import from GSC), submit the sitemap. IndexNow ping on publish is optional | live: Bing `site:skeenmusic.com` shows the pages |
| 3.4 | `sitemap.ts` from `sitemapEntries`: `lastModified = max(published_at, latest past show)` | unit: same payload → same lastmod (no clock); `/about` present iff placement is `page` |
| 3.5 | `auditSeo` wired into `test/build-output.test.ts` | the audit itself |

Deploy: push skeen `main` (never `vercel --prod`). Verify live with
Google's Rich Results test and a fetch of `/sitemap.xml`, `/robots.txt`, `/about`.

### Phase 4 — Roll out

ftbk (merge its unmerged 0.32 branch first), then wren. Each site: bump the
bridge, run `checkContract` + `auditSeo`, declare `about`, add `/about` if
declared, redeploy no-cache. Then `tools/seo` is deleted in lone-star.

## Out of scope (noted, not planned)

- Per-release or per-show pages on connected sites (skeen is one page by
  design). Lone-star's hosted templates already have `/r/[release]`.
- Bandsintown event feeds: M7 stays blocked on app_id + terms compliance.
- Venue street addresses / geo for `MusicEvent.location`: lat/lng are
  dashboard-only on purpose. `Place` ships with name + city only.
- `llms.txt`: cheap, low proven value. Revisit after Phase 3 if wanted.
- Rich text for the bio: the bridge reserves `richtext` but nothing
  implements it. Plain text with `\n` paragraphs is enough for this.

## Test discipline reminders (AGENTS.md)

- Every guard above must be seen red once: delete the alt, remove the `h2`,
  drop the noindex, and watch the build test fail before trusting it.
- Expected sets come from the registry: `SEO_FIELDS`, `Object.keys` of the
  manifest, the payload type. No hand-listed key arrays in tests.
- Add the new bridge `seo` module to `mutate` in `stryker.config.json` once
  it has DB-free tests, or Stryker never looks at it.

## Where we are

- [x] Skeen audit committed (`skeen-website` main `1cf370d`)
- [ ] Phase 1
- [ ] Phase 2
- [ ] Phase 3
- [ ] Phase 4

## Checklist, with how to prove each one helped

SEO signals take 2–6 weeks to move. So: **capture a baseline now**, re-run
the same checks after each phase, and compare. Local checks prove the
change shipped; the tools prove Google and the AI engines noticed.

### Tools (set up once)

| Tool | Why | Cost |
| --- | --- | --- |
| Google Search Console (GSC) for `skeenmusic.com` | impressions, clicks, indexed pages, URL Inspection, Enhancements reports | free; verify the domain via DNS TXT |
| Bing Webmaster Tools | Bing feeds ChatGPT and Copilot; import from GSC in one click | free |
| Rich Results Test · `search.google.com/test/rich-results` | validates JSON-LD as Google reads it | free |
| Schema validator · `validator.schema.org` | catches schema errors Google tolerates silently | free |
| Lighthouse (Chrome DevTools → Lighthouse → SEO + Accessibility) | scores alt text, headings, meta, crawlability | free |
| `scripts/seo-check.sh` (to write in 1.0) | curl-based local checks below, one command | ours |
| AI citation probe (manual, 5 fixed prompts) | the only direct GEO measure | 10 min |

### 0. Baseline (before any change)

Record in `SEO_GEO_BASELINE.md` in skeen-website, dated:

- [ ] GSC, last 28 days: impressions, clicks, average position for `skeen`,
  `skeen dj`, `skeen music`, `skeen chicago`. Pages indexed count.
- [ ] Visible text length: `curl -s https://www.skeenmusic.com | sed 's/<[^>]*>//g' | tr -s ' \n' | wc -c` (audit said ~1,386)
- [ ] `curl -s https://www.skeenmusic.com | grep -o 'alt=""' | wc -l` (audit said 19)
- [ ] Heading outline: `curl -s https://www.skeenmusic.com | grep -o '<h[1-6][^>]*>' | sort | uniq -c`
- [ ] Lighthouse SEO + Accessibility scores, mobile.
- [ ] Rich Results Test on the homepage: which types it detects (expect
  MusicGroup / WebSite only, no events).
- [ ] `site:skeenmusic.com` in Google: how many results, and does `/edit` appear.
- [ ] AI citation probe. Ask each of ChatGPT (search on), Perplexity,
  Google AI Mode, Copilot the same 5 prompts and record cited / not cited
  and whether facts are right:
  1. "Who is Skeen, the Chicago DJ and producer?"
  2. "What genre of music does Skeen make?"
  3. "When is Skeen playing next?"
  4. "What has Skeen released recently?"
  5. "Skeen music official website"

### Phase 1 — Skeen quick wins

- [ ] **1.1 Alt text**
  - shipped: `alt=""` count drops to the decorative ones only (cursor image); build test red when an alt is removed
  - improved: Lighthouse Accessibility "Image elements have alt" passes; GSC Performance → Search type: Image shows impressions after ~4 weeks (today: none expected); Google Images `site:skeenmusic.com` returns covers
- [ ] **1.2 Section headings**
  - shipped: outline shows `h1` → `h2` Tour / Music / About / Videos; build test red when an `h2` is dropped
  - improved: Lighthouse SEO "heading elements in order" passes; GSC sitelinks for the brand query start showing section anchors (`#work`, `#shows`) after a few weeks
- [ ] **1.3 `/edit` noindex**
  - shipped: `curl -s https://www.skeenmusic.com/edit | grep -c 'name="robots"'` = 1, homepage = 0
  - improved: GSC URL Inspection on `/edit` says "Excluded by noindex tag"; `site:skeenmusic.com/edit` returns nothing
- [ ] **1.4 vercel.app header**
  - shipped: `curl -sI https://<skeen>.vercel.app | grep -i x-robots-tag` → `noindex`; the www host has none
  - improved: `site:vercel.app skeen` returns nothing after re-crawl
- [ ] **1.5 404 page**
  - shipped: `curl -sI https://www.skeenmusic.com/nope | head -1` → 404
  - improved: GSC Pages → "Not found (404)" rows stay as 404, none flip to "Soft 404"
- [ ] **1.0 `scripts/seo-check.sh`** in skeen-website: runs every curl line above against a host argument and prints pass/fail. Re-run after each deploy.

### Phase 2 — Bridge + editor

- [ ] **B1 `published_at`**: RPC test proves the timestamp moves only on publish
- [ ] **B4 `resolveSeo`, `jsonLdGraph`, `sitemapEntries`, `robotsRules`**: unit tests green, mutation run shows no survivors in the new module
- [ ] **B5 `auditSeo`**: run against skeen's current build → it must FAIL on the items skeen hasn't fixed yet (that's how we know it bites)
- [ ] **B6b slug + alt**: rename an image in the editor, publish, `curl` the homepage: the `<img>` has the slug in `src` and the alt text in `alt`, in the raw HTML (not after JS)
- [ ] **B6 Site tab SEO/GEO group**: edit Title / Genre / Location / About placement, publish, then `curl` the homepage and see the values in `<title>`, JSON-LD, and the about section
- [ ] **B7 CONNECTING.md §10** written; `checkContract` gains rule 6

### Phase 3 — Skeen adopts

- [ ] **3.2 Bio visible (About section or `/about`)**
  - shipped: visible text length ≥ 2,500 chars (from ~1,386); with `page`, `curl -s /about` contains the bio and the homepage footer links to it; with `hidden`, `/about` returns 404
  - improved (SEO): GSC URL Inspection on `/about` → "Indexed"; `site:skeenmusic.com` grows by one; brand-query impressions up vs baseline at 4 weeks
  - improved (GEO): re-run the 5-prompt probe. Target: prompts 1, 2, 5 cite skeenmusic.com in at least 2 of 4 engines, and the genre/location facts match what's in the editor
- [ ] **3.3 MusicEvent + MusicAlbum JSON-LD**
  - shipped: Rich Results Test detects "Event" items, one per dated upcoming show; Schema validator shows 0 errors
  - improved: GSC Enhancements → "Events" report appears with valid items; Google search "skeen tour" shows the concert carousel; prompt 3 answers with the real next show
- [ ] **3.4 Sitemap lastmod**
  - shipped: fetch `/sitemap.xml` twice five minutes apart, `lastmod` identical; publish from the editor, `lastmod` changes
  - improved: GSC Sitemaps → "Last read" updates within days of a publish, not on every crawl
- [ ] **3.1 / 3.5**: local copies deleted, `auditSeo` green in `npm run test:build`

### Phase 4 — Roll out

- [ ] ftbk and wren: `seo-check.sh` green, `auditSeo` green, Rich Results Test clean, GSC property added, baseline recorded before deploy
- [ ] `tools/seo` deleted; no route left that publishes SEO outside the editor

### Re-measure dates

- [ ] +2 weeks after Phase 3 deploy: GSC + AI probe
- [ ] +6 weeks: GSC + AI probe, compare to baseline, write results at the top of this file
