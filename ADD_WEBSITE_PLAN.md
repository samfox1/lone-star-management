# Add website: Tapir registers every site with Google and Bing (plan, 2026-09-30)

Status: REVIEWED (3 reviewers, 2026-09-30: security/data, codebase fit, external APIs + simplicity).
Nothing here is built. The review's changes are listed at the bottom.

## Why

Sam asked ChatGPT about Skeen and nothing came up. skeenmusic.com's plumbing was fine (robots.txt
lets everyone in, a sitemap, self canonicals, apex → www 308, every crawler got 200), but **Bing had
never listed it**: ChatGPT search reads Bing's index. Nobody had told Google or Bing the site
exists, and nobody could see whether they had listed it. Sam set up Bing Webmaster Tools for Skeen
by hand on 2026-09-29 (skeen-website commit 5399613, a BingSiteAuth.xml).

Sam, 2026-09-30: "Tapir is going to be the home base but I need visibility for each site." "I am
cool with Tapir owning every site." "Can I have an Add Website step that automates this for each
website/client that I add?"

## What Sam gets

1. **Add website**, on the artist's Settings → Site row (admins only): type the address, click Add.
   Tapir proves to Google and Bing that it controls the site, adds it to Tapir's Search Console and
   Bing Webmaster Tools, sends the sitemap, adds the owner email, and only then connects the site
   to the artist. A short checklist shows each step. Managers see the result read-only
   ("Google ✓ · Bing ✓").
2. **The AI test** says, per page, "Google has listed it" (URL Inspection) and "Bing last visited it
   on …", and gains "How crawlers see your site" (mock: prototypes/seo_variants_20260930_r11.html).
3. Every artist's site registered the same way, visible from Tapir and from the owner's own
   Search Console.

## Decisions

Sam's: **Tapir owns every site** in Google Search Console and Bing Webmaster Tools, with Tapir's
own credentials; artists and managers need no Google/Bing login. An **Add website** step automates
it per site.

This plan's (all three reviews agreed):

- **The verification codes are CONFIG, not content.** They live in a service-only table,
  `site_verifications`, and `get_public_site` hands them to the site as a `verification` object.
  NOT in `site_content`: a manager can write any `site_content` or `revisions` row through the API
  (`site_content_rw`, `revisions_rw` are FOR ALL), so a manager could plant their own tag and claim
  the domain; "Restore version" deletes `site_content` rows in whole mode (content.ts:896), so a
  revert would silently drop verification; and a one-row "config publish" would add a fake version
  to the history, move every sitemap `lastmod`, and reach nothing on a never-published artist. The
  table has none of those problems and the codes go live in about a minute (ISR), with no publish.
  Same pattern as `site_kind` / `custom_site_url` (scripts/set-custom-site.ts: "CONFIG, not content").
- **One address, decided once.** Fetch the home page, follow redirects, take the final origin + "/"
  (e.g. `https://www.skeenmusic.com/`): https only, not `*.vercel.app`, no loopback (the
  `indexNowOrigin` rules), punycode for international names. That exact string is the Google
  property, the Bing site, the sitemap base and every URL Inspection call. (Registering the apex
  of a site that redirects to www would verify fine and then quietly fail every sitemap and
  inspection call.) A URL-prefix property, because META verification only works for those; a
  domain property needs DNS, which Tapir does not control.
- **Connect last.** The site is attached to the artist only AFTER this artist's code is seen live on
  it. That proves the site serves this artist's payload; a typo can't attach artist A to artist B's
  site.
- **Google identity: a service account** in its OWN Google Cloud project (`tapir-search`), not the
  project that holds the YouTube key and OAuth client (anyone with Editor there could mint keys for
  it). No consent-screen review: Google exempts service accounts that access only their own data
  (support.google.com/cloud/answer/13464323). A service account verifying a site as itself is
  shown working only in secondary sources, so the first real registration (Skeen) is the test.
  FALLBACK: a Tapir Google account signs in once through an OAuth client whose consent screen is
  set to **In production** (unverified is fine for one internal account); in Testing, refresh
  tokens expire after 7 days (developers.google.com/identity/protocols/oauth2).
- **Bing identity: the API key of Sam's existing Bing account** (Skeen is already verified there),
  with two-step sign-in turned on. Bing has no service identity; its key is per user. Move to a
  Tapir account when the Tapir email exists. Bing's `msvalidate.01` code appears to be per ACCOUNT,
  so the same public tag on every client site reveals the roster to anyone who looks: accepted.
- **Owner email:** one address, set in server config (never taken from a request; a typo would hand
  a stranger every site). Preferably a Tapir Google account; Sam's for now. Google emails every
  owner on each ownership change: expect one email per site. Sam's access is DELEGATED through the
  service account, so the service account and its key must never be deleted while sites exist.
- **Safe to repeat, so no state machine.** Every Google and Bing call tolerates repeats (treat
  "already exists" as success), so "Try again" re-runs from the top. One row per provider records
  the code, the address, when it verified, and a short reason CODE on failure (never raw error
  text: Bing's key travels in the URL and could leak into a message).
- **Admins only.** Add website registers the site under Tapir's accounts. A `requireAdmin` helper
  (getUser + `app_metadata.role === 'admin'`, as /admin/applications checks inline today).
  `custom_site_url` / `site_kind` become admin-and-service only through a BEFORE UPDATE trigger
  raising 42501 (RLS can't limit one column); today managers can change them, and nothing
  legitimate does (the CLI uses the service role).

## How it works (one site)

```
Add website (artist, "newartist.com")
  1. Address   fetch the home page (guarded fetch), follow redirects → https://www.newartist.com/
               Refuse http, *.vercel.app, loopback, a site another artist already uses.
  2. Codes     Google getToken(SITE, META) → keep only the content value (accept a whole <meta>
               or the bare value). Bing AddSite → GetUserSites → this site's AuthenticationCode
               (match Url after normalising case and trailing slash; hex, any case).
               Write both to site_verifications.
  3. Live?     the browser asks every few seconds; each ask is ONE bounded guarded fetch of the
               home page looking for both tags. Give up after ~3 minutes with a plain reason.
               A per-artist lock stops a double click from running two at once.
  4. Google    webResource.insert(META, owners: [owner email]) → sites.add → sitemaps.submit.
  5. Bing      VerifySite → SubmitFeed(<address>sitemap.xml).
  6. Connect   artists.site_kind='custom', custom_site_url=<address> (service role).
```

Nothing is sent to Google or Bing on every publish: the sitemap is submitted once, and IndexNow
already pings Bing on each publish (src/lib/indexnow.ts).

## Steps (in order; each live step waits for Sam's yes)

**1 · Sam's one-time setup** (below). ~15 minutes.

**2 · Database** (strict, test-first; one migration; full suite, then push with Sam's yes):
- `site_verifications(artist_id, provider 'google'|'bing', site_url, code, verified_at,
  error_code, updated_at)`, unique (artist_id, provider). RLS on, no policies; revoke all from
  anon, authenticated; managers read status only through a manager-facing definer function that
  returns provider + verified + error_code (never the code: it is public anyway, but there is no
  reason to widen reads). `on delete restrict` to artists (deleting an artist must not erase the
  only record of what Tapir owns).
- `get_public_site` returns `verification: { google: string | null, bing: string | null }` from it
  (one code per provider; the bridge merges a site's own env-var Google code into an array).
  It answers nothing before an artist's first publish, so Add website needs one publish first.
- The `custom_site_url` / `site_kind` trigger (refuses by default: only the service role, admins and
  a no-JWT SQL session pass). Uniqueness lives on `site_verifications (provider, site_url)`; the
  index on `custom_site_url` was dropped (only staff can set it now). Built 2026-09-30:
  supabase/migrations/20260930120000_site_verifications.sql.
- Tests: denial tests for anon AND authenticated (`audit:grants` only checks anon), with a planted
  row and 42501; an `auth.role()` guard in each definer function; row state asserted through the
  service client.

**3 · Bridge 0.44** (strict: it is what the live sites receive). `siteVerification(payload)` →
`{ google: string[], other: { 'msvalidate.01'?: string } }`, shape-checked (never renders a bad
code). Sites spread it into their root `generateMetadata`. Skeen already sets
`verification.google` from an env var: render BOTH (Next accepts an array), so Skeen's existing
verification survives. CONNECTING.md §10 gains the rule. Publish the bridge (0.43.0 is still
unpublished; Skeen jumps 0.42 → 0.44), Skeen adopts it and redeploys WITHOUT build cache. Each site
push needs Sam's yes.

**4 · The register script** (strict): `src/lib/search-engines/{google,bing,register}.ts`
(server-only: add the `server-only` package; typed clients over fetch with timeouts; the service
account signs its own JWT with Node crypto) and `npm run site:register <slug> <address>`, which runs
"How it works" end to end. **Run it on Skeen first**: that is the live test of the service account.
If Google refuses, switch to the OAuth fallback before going on.

Before writing it (post-push audit, 2026-09-30):
- Every `site_verifications` write goes through the SERVICE client (`src/lib/supabase/admin.ts`),
  never the admin's own session: the table is closed to every signed-in user, admins included.
  One test pins it.
- Writes UPSERT on `(artist_id, provider)`, so "Try again" re-runs cleanly.
- The codes are written before the site is connected, so a failed "Live?" step (a typo, the wrong
  artist) DELETES the rows it wrote; otherwise they hold `(provider, site_url)` and block the right
  artist (23505) and the wrong artist's deletion. Say which artist already holds an address.
- Compare addresses normalised: `custom_site_url` has no trailing slash
  (`https://www.skeenmusic.com`), `site_url` always ends in "/".
- Skeen's `GOOGLE_SITE_VERIFICATION` env var is NOT set in production (no tag on the live site), so
  the "keep the site's own code" merge is inert there today.

**5 · Add website panel** — DEFERRED (Sam, 2026-09-30): it goes on a new ADMIN page built after
Skeen is finished, before site #2 (TODO.md). Originally: (light test; mock first) the admin action on Settings → Site, wrapping
the same `register` steps, with the checklist. Managers see "Google ✓ · Bing ✓".

**6 · The AI test** (engine strict, UI light; its own migration): `seo_test_runs.crawl jsonb`
(byte CHECK like `results`; reset in the claim trigger; cleared on failure; verdicts and matched
rule lines only, never the raw robots.txt) and `seo_test_finish(…, p_crawl)` (drop, recreate,
re-grant). During the run (never when the page opens: the page never decides a result): URL
Inspection for each opened page, keyed on `site_verifications.site_url` and same-origin pages
only (so a manager can't point it at another site's data), and Bing `GetUrlInfo` (LastCrawledDate,
HttpStatus). The `bingwm` test reads the registration instead of hunting for a meta tag. Then the
"How crawlers see your site" section (one extra fetch for apex → www).

**Later (not now):** leaving (order matters: remove the owner with `update`, remove the code and wait
until it's gone from the live page, then `webResource.delete`, which returns 400 while the token
is still up; plus a reconcile against `webResource.list` / `GetUserSites`); FTBK and Wren (FTBK's
address is localhost and Wren is a test site on vercel.app, so neither qualifies yet); creating the
artist from Add website; Workload Identity Federation instead of a key file.

## Limits (say them in the UI, never paper over them)

- **Bing can't say "listed".** It has no index-status API. Word it "Bing last visited this page
  on …", never "listed".
- Google URL Inspection reports the indexed version only. Quota: 2,000 a day and 600 a minute per
  site; plenty.
- 1,000 sites per Google account and per Bing account.
- The codes must stay on the site for good; a site that drops the bridge loses verification.
- A domain change is a new property: run Add website again.

## Secrets

- **Google:** the service account's JSON key, base64, in `.env.local` as
  `GOOGLE_SEARCH_SERVICE_ACCOUNT_B64`, put there by Sam with a command that never prints it (Claude
  never reads the file); the download is deleted after. On Vercel later: a **Sensitive**,
  Production-only env var. If Google refuses to create a key ("Key creation is not allowed": new
  organisations block it by default), stop: Workload Identity Federation needs no key file.
- **Bing:** `BING_WEBMASTER_API_KEY`, typed into `.env.local` by Sam.
- Neither key ever reaches the browser, a log line, an error message, the copilot agent, or a
  commit. Rotation: make a new key, swap the env var, delete the old key (never the account).

## Sam's steps (one time)

**Google (~10 min)**
1. console.cloud.google.com → project picker (top left) → **New project**, name `tapir-search` →
   Create, and switch to it.
2. Menu (☰) → **APIs & Services** → **Library**. Search **Google Site Verification API** →
   **Enable**. Back, search **Google Search Console API** → **Enable**.
3. Menu → **IAM & Admin** → **Service Accounts** → **+ Create service account**, name
   `tapir-search` → **Done** (skip the roles).
4. Click its email → **Keys** → **Add key** → **Create new key** → **JSON** → **Create**. A file
   downloads (only once). If it says "Key creation is not allowed", stop and tell Claude.
5. In Claude Code, run the one-line command Claude gives you (starts with `!`). It saves the key
   into Tapir without showing it and deletes the download.

**Bing (~3 min)**
6. Turn on two-step sign-in for the account you use at bing.com/webmasters.
7. bing.com/webmasters → **Settings** (gear, top right) → **API Access** → accept the terms →
   **API Key** → **Generate**. Add a line to `.env.local`: `BING_WEBMASTER_API_KEY=<the key>`.

**Then**
8. Tell Claude which Google email should be the owner of every site.
9. Expect one "new owner" email from Google per site. That's normal.

## Tests (AGENTS.md tiers)

- Strict, test-first: the bridge helper (a bad code never renders); `get_public_site`'s new field;
  the table's grants and RLS (anon and authenticated denials with a planted row, 42501); the
  `custom_site_url` trigger; address normalisation (redirects, http, vercel.app, loopback,
  punycode, trailing slash); token parsing; each Google/Bing client call (mocked at fetch: success,
  already-exists, refusal, timeout, a key never in an error); the register steps' order (connect
  last) and the lock.
- Light: the Add website panel (one main-path test), the crawler section UI.
- Full suite before the migration push, the bridge release, and the Skeen deploy.

## What the review changed (2026-09-30)

- Codes moved out of `site_content` into `site_verifications` + `get_public_site` (all three
  reviewers): fixes the manager-can-claim-the-domain hole (`revisions_rw`), Revert wiping the codes,
  fake history entries, moved `lastmod`s, and never-published artists. No config publish, no
  reserved-key trigger (which would also have broken `ensureIndexNowKey`).
- The bridge-version check on `/indexnow.txt` was dropped: it 404s without a version header until
  a key is published, so every new site would have failed. The live home page is the real proof.
- One normalised address (final origin after redirects) instead of "the site's origin".
- Connect happens last, after the artist's own code is seen live.
- The six-state machine became "safe to repeat, re-run from the top".
- Tokens are written together and waited on once, the browser drives the polling, a per-artist
  lock prevents doubles (Vercel time limits).
- Separate GCP project; Sensitive Vercel env; Claude never reads the key; reason codes, not raw
  errors; the OAuth fallback must be "In production" (7-day refresh tokens in Testing).
- Bing uses Sam's existing account, so no `AddSiteRoles` for now.
- Add website moved from the roster to the artist's Settings → Site row, admins only.
- The crawl column moved to its own step; URL Inspection runs during the test, not on page open.
- Leaving, FTBK/Wren and artist creation deferred.
