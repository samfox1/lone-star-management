/**
 * THE SEO / GEO TESTS: the contract every part builds against (Sam, 2026-09-28: "This test
 * should be a big part of this project and should be very helpful to users who dont know
 * technology" and "These tests should be verified to accurately detect what they say. If they
 * cant, thats fine, make a note").
 *
 *   evidence   what we fetched and what Tapir knows, gathered ONCE per run (evidence.ts)
 *   tests      pure functions over that evidence, one per `SeoTestId` (found / who / shared / facts)
 *   run        gathers, runs every test, stores the run (run.ts, store.ts)
 *   the page   reads stored runs; it never decides a result itself
 *
 * THE HONESTY RULES, which the types enforce:
 *   1. A test that could not LOOK is `unknown`, never `pass`. `unknown` is shown as "couldn't
 *      check", counts as not passing, and says why in its sentence.
 *   2. A test says what it CANNOT see in `limits` (one plain sentence), shown under "Show the
 *      details". A claim the evidence cannot support is cut from the sentence, not softened.
 *   3. `evidence` is plain text the run really observed (a status code, a header, a snippet):
 *      never a value copied from what Tapir expects to be there. A row that states what TAPIR
 *      holds (for a comparison) is labelled as Tapir's ("in Tapir: …"), never as the site's.
 *   4. A test that does not apply is `na`, not `unknown` and not `pass` (see SeoTestStatus).
 */

export type SeoTestGroup = 'found' | 'who' | 'shared' | 'facts'

export const SEO_TEST_IDS = [
  'google', 'bing', 'chatgpt', 'claude', 'perplexity', 'others', 'allowed', 'list', 'words', 'bingwm',
  'title', 'desc', 'bio', 'genre', 'place', 'mb', 'youtube',
  'share', 'preview', 'alt',
  'profiles', 'apple', 'shows', 'releases', 'card',
] as const
export type SeoTestId = (typeof SEO_TEST_IDS)[number]

/** What a test IS: its group and its plain words. Results are separate (SeoTestResult). */
export type SeoTestDef = {
  id: SeoTestId
  group: SeoTestGroup
  /** A statement about the artist, true when the test passes: "Google can visit your site". */
  name: string
  /** One sentence, no jargon: what we did. */
  tested: string
  /** One sentence about fans / AI: why it matters. */
  why: string
  /** The fix happens on another service ("OUTSIDE TAPIR" tag). */
  outside?: 'Bing' | 'MusicBrainz' | 'YouTube'
  /** The answer comes from another tool's data ("Tour" / "Music" tag). */
  source?: 'Tour' | 'Music'
}

/**
 * `na` = the test DOES NOT APPLY to this artist (a visual artist has no genre; a solo person
 * has no founding year). It is not a pass and not a miss: it is left out of "19 of 25" on both
 * sides, shown greyed as "doesn't apply", and says why in its sentence. Never used to hide a
 * test that could not look: that is `unknown`.
 */
export type SeoTestStatus = 'pass' | 'fail' | 'unknown' | 'na'

/** Every status, derived from a `Record` over the union so a fifth status is a compile error
 *  here until it is listed (AGENTS.md rule 4). The validators (run.ts, store.ts) read this. */
const STATUS_SET: Record<SeoTestStatus, true> = { pass: true, fail: true, unknown: true, na: true }
export const SEO_TEST_STATUSES = Object.keys(STATUS_SET) as readonly SeoTestStatus[]

/** Does this status count in the score ("19 of 23")? Everything but `na`, on both sides. The
 *  migration's finish trigger applies the same rule; store.ts `seoScore` mirrors it. */
export const isScored = (status: SeoTestStatus): boolean => status !== 'na'

/** What the manager can do about a result. Drawn as an ICON button with a hover label. */
export type SeoTestAction =
  /** Open one of the page's own tabs / editors. */
  | { kind: 'edit'; target: 'listing' | 'facts' | 'bio' | 'share' | 'alt' | 'answers' | 'connections' | 'tour' | 'music'; label: string }
  /** Open another site in a new tab (https only). */
  | { kind: 'outside'; href: string; label: string }
  /** A change Tapir can make itself, as a DRAFT the manager then publishes. */
  | { kind: 'fix'; fix: 'apple-storefront'; label: string }

export type SeoTestResult = {
  id: SeoTestId
  status: SeoTestStatus
  /** The short value on the right of the row: "3 of 3 pages", "58 words · 1 of 3 facts". Under ~28 chars. */
  value: string
  /** One plain sentence. For a fail the page puts "Not yet:" (or `lead`) in front of it, so
   *  it starts lower-case: "your bio doesn't name your genre." */
  sentence: string
  /** A softer opener for a near miss ("Almost:"). */
  lead?: 'Almost'
  /** For a fail: what good looks like, one line. Only when it is grounded, else omitted. */
  good?: string
  /** For a fail: what to do, one line. */
  todo?: string
  action?: SeoTestAction
  /** What the run observed, for "Show the details". Plain text only, never html. */
  evidence: { label: string; value: string }[]
  /** What this test cannot see, in one plain sentence (honesty rule 2). */
  limits?: string
}

/* ── evidence ───────────────────────────────────────────────────────────────────────── */

/** A visitor we fetch as. `fetches` false = a robots.txt TOKEN only (no crawler of its own
 *  sends this name), so it is judged from robots.txt, never from a fetch. */
export type SeoBot = {
  key: string
  /** The name a person knows: "ChatGPT", "Google". */
  who: string
  /** Who runs it, when the test is not one company's (`others`) and `who` is a product, not
   *  the company: Meta AI is Meta's, Alexa is Amazon's. Unset = `who`. */
  company?: string
  /** The exact User-Agent string sent, from the vendor's own documentation. */
  userAgent: string | null
  /** The product token robots.txt rules are written against. */
  robotsToken: string
  fetches: boolean
  /** Which test reads it. */
  test: Extract<SeoTestId, 'google' | 'bing' | 'chatgpt' | 'claude' | 'perplexity' | 'others'>
  /** The vendor page the name, token and User-Agent come from. */
  docUrl?: string
  /** false = the vendor names the token but does not publish the full User-Agent string;
   *  `userAgent` is then the widely observed form, built around the documented token. */
  uaDocumented?: boolean
  /** Tokens the bot falls back to when robots.txt has no group for its own token, in order
   *  (Applebot follows Googlebot's group when there is no Applebot group: Apple's doc). */
  robotsFallback?: readonly string[]
  /** true = when robots.txt has no group for its token, the vendor says it follows the rules
   *  given to OTHER search bots, without saying which (Amazon's Amzn-SearchBot). A `*` rule that
   *  keeps it out while another crawler's group lets that crawler in is then "couldn't tell". */
  followsOtherSearchBots?: true
  /** For a token-only entry (`fetches` false): the key of the bot that does the visiting. */
  visitsAs?: string
  /** true = the vendor says it can run a page's scripts (so an empty-until-scripts page is
   *  not empty to it). Unset = no such statement, treated as NOT running them. */
  runsScripts?: boolean
  /** true = the vendor says it only gathers pages to TRAIN models (GPTBot, ClaudeBot,
   *  Applebot-Extended, CCBot), so turning it away does not stop search or answers. */
  trainingOnly?: boolean
}

export type SeoPageFetch = {
  /** Path on the site: "/", "/about". */
  path: string
  /** Where the answer finally came from, after redirects. */
  finalUrl: string | null
  /** null = no answer (refused before it left, threw, timed out, too many redirects). */
  status: number | null
  /** Lower-cased header names. Only the ones a test reads are kept. */
  headers: Record<string, string>
  /** The body when it was 2xx text/html, capped; else null. */
  html: string | null
  /** Why there is no answer, when status is null. */
  error?: string
  /** The body was longer than the cap and `html` is only its start. */
  truncated?: boolean
}

/** What Tapir itself knows, read from the database for this artist. `published` is what the
 *  public door serves (get_public_site); `working` is the draft. Tests compare the LIVE SITE to
 *  `published`, never to `working`: a draft is not supposed to be on the site yet. */
export type SeoKnown = {
  artistName: string
  siteUrl: string | null
  today: string
  published: {
    bio: string | null
    genre: string | null
    location: string | null
    seoTitle: string | null
    seoDescription: string | null
    ogImage: string | null
    /** Every link the door serves, buttons and identity links alike. */
    links: { label: string | null; url: string; onSite: boolean }[]
    tourDates: { date: string | null; venue: string | null; city: string | null; isPast: boolean }[]
    releases: { title: string; releasedOn: string | null }[]
    photos: { url: string; alt: string | null }[]
    publishedAt: string | null
    /** When the CONTENT last changed (a restyle does not count): the bridge's
     *  `contentChangedAt` over the door payload. null/absent on a database with no
     *  `changed_at`; the stale-site check then judges by `publishedAt` alone. */
    contentAt?: string | null
    /** Profile's "Region" (`fact_region`), as the bridge reads it (`siteFacts`): '' → null. */
    region: string | null
    /** Profile's "Country" (`fact_country`): the bridge table's spelling when it knows the
     *  country, else as typed. null = not set. */
    country: string | null
    /** `country` as ISO 3166-1 alpha-2 ("US"), when the bridge's table knows it; else null. */
    countryCode: string | null
    /** Profile's "Type" (`artists.schema_type`): 'Person' = Visual artist, anything
     *  else = Musician ('MusicGroup'), the bridge's own rule. */
    artistType: 'MusicGroup' | 'Person'
    /** `artists.spotify_artist_id` when it is the shape the bridge accepts. The bridge adds
     *  `open.spotify.com/artist/<id>` to the fact card's profiles from the id alone. */
    spotifyArtistId: string | null
  } | null
}

export type SeoEvidence = {
  /** The site's origin as tested: "https://www.skeenmusic.com". */
  origin: string
  gatheredAt: string
  /** Paths tested: "/" plus same-origin sitemap pages, capped. */
  paths: string[]
  /** A plain visit (no bot name): what a person's browser is sent, scripts not run. */
  plain: SeoPageFetch[]
  /** Each fetching bot's visit to each path, keyed by SeoBot.key. */
  byBot: Record<string, SeoPageFetch[]>
  robots: {
    status: number | null
    body: string | null
    /** Why there is no answer, when status is null: guardedFetch's error, with the address a
     *  refused redirect pointed at ("not-allowed: https://cdn.example.net/robots.txt"). */
    error?: string
  }
  sitemap: {
    status: number | null
    urls: string[]
    lastmods: (string | null)[]
    /** The list we read (a robots.txt `Sitemap:` line, else /sitemap.xml). */
    url?: string
    /** It was a real sitemap (urlset or sitemapindex), not an html page or junk. */
    parsed?: boolean
    /** robots.txt names a sitemap on this site. */
    namedInRobots?: boolean
    /** Every `<loc>` read, before `urls` was capped. */
    total?: number
    /** `<loc>`s on another site (or not a web address), with up to 3 examples. */
    offSite?: { count: number; examples: string[] }
    /** The file was longer than the cap and only its start was read. */
    truncated?: boolean
    /** A sitemap index: the child lists we opened (one level deep). */
    children?: { url: string; status: number | null }[]
    /** Why the list could not be read, when status is null. */
    error?: string
    /** What the file was: an xml sitemap, a text list (one address per line), an RSS / Atom
     *  feed, an html page, or something else. Gzip is unpacked first. */
    format?: 'xml' | 'text' | 'feed' | 'html' | 'other'
    /** Entries that are not full web addresses ("/about"), with up to 3 examples. */
    badLocs?: { count: number; examples: string[] }
    /** Same-site addresses spelled another way than the site answers on (http://, or the bare
     *  domain for a www site). */
    otherSpelling?: number
    /** Every list we tried, in order, when robots.txt named more than one (or none worked). */
    tried?: { url: string; status: number | null }[]
    /** Lists robots.txt names on another site: never opened. */
    namedElsewhere?: string[]
    /** A sitemap index: how many lists it names on this site (we open at most 3). */
    childTotal?: number
  } | null
  /** Did the site answer at all? The home page's plain visit, as one fact for the page to say
   *  ONCE ("We couldn't reach your site") instead of every row saying it. `answered` includes a
   *  redirect to another site (the site did answer). Optional: absent = not gathered. */
  reach?: { state: 'answered' | 'server-error' | 'refused' | 'no-answer'; status: number | null; error?: string }
  /** Signs of Bing Webmaster Tools the site carries (/BingSiteAuth.xml). The meta tag is read
   *  from the home page html. Optional: absent = not gathered. */
  bing?: { siteAuth: { status: number | null; hasUser: boolean } }
  /** The share picture the home page names, fetched: null when the page names none. */
  shareImage: {
    url: string; status: number | null; contentType: string | null; width: number | null; height: number | null; bytes: number | null
    /** What the file's first bytes say it is (share-image.ts), whatever the header claims.
     *  null = not a picture format we know. Optional: absent = not read. */
    format?: 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'avif' | 'heic' | null
    /** Why there is no answer when status is null: 'not-https', 'redirect-not-https',
     *  'not-public', 'bad-url', or guardedFetch's own error. */
    error?: string
    /** The file was bigger than the cap we download, so `bytes` is at least that. */
    tooBig?: boolean
    /** The file ended before its own stated length (a cut-off download). */
    broken?: boolean
  } | null
  /** MusicBrainz's answer to "which artist links to this site / these profiles". `looked`
   *  false = we could not ask (so the test is `unknown`, not `fail`). */
  musicbrainz: {
    looked: boolean; artistUrl: string | null; matchedOn: string | null; error?: string
    /** The name MusicBrainz has for the artist it found. */
    artistName?: string | null
    /** The addresses we asked MusicBrainz about, in order. */
    asked?: string[]
    /** The answer is about the MusicBrainz link in Connections, which we opened: with
     *  `artistUrl` null, MusicBrainz has no artist at that link. */
    fromConnections?: boolean
  }
  /** YouTube's answer about the channel the artist linked (youtube.ts). Optional: absent = not
   *  asked (the run ran out of time, or the lookup failed), so the `youtube` test is `unknown`. */
  youtube?: {
    /** The YouTube channel link from what Tapir published that was read. null = there is none
     *  (the test is `na`). */
    link: string | null
    /** false = we could not ask YouTube (no key, the daily limit, no answer, an answer we
     *  couldn't read): the test is `unknown`, never `fail`. */
    looked: boolean
    /** The channel YouTube has at that link. null with `looked` = YouTube has no channel there. */
    channel: { id: string; title: string; handle: string | null; description: string } | null
    /** Why we couldn't ask, in plain words. Never holds the request address (it carries the key). */
    error?: string
  }
  known: SeoKnown
}

/** One test: pure, synchronous, total. Never throws: a missing piece of evidence is `unknown`. */
export type SeoTest = (evidence: SeoEvidence) => SeoTestResult

/* ── the crawl summary ──────────────────────────────────────────────────────────────── */

/**
 * WHAT THE RUN SAW, for the AI test's "How crawlers see your site" section (prototypes/
 * seo_variants_20260930_r11.html; Sam 2026-09-29: robots.txt, sitemap, canonical tags and where
 * each crawler may go "should all be explicitly detailed and broken down in the test"). FACTS,
 * not verdicts: the tests judge, this shows. Built once per run from the evidence
 * (crawl.ts `buildCrawl`) and stored with the run (seo_test_runs.crawl, byte-capped). Every
 * string came from the artist's site or from Google / Bing: the page renders it as TEXT only.
 */
export type SeoCrawl = {
  /** Shape version: a reader shows nothing for a version it doesn't know. */
  v: 1
  robots: {
    /** Where it was read: origin + "/robots.txt". */
    url: string
    status: number | null
    /** The file as the site sent it, cut to its first 2,000 characters. null = none read. */
    text: string | null
    truncated: boolean
    /** Every crawler the tests know (bots.ts SEO_BOTS), in that order. */
    bots: {
      key: string
      /** Plain name: "Google", "ChatGPT search". */
      who: string
      /** The name robots.txt knows it by: "Googlebot", "OAI-SearchBot". */
      token: string
      /** false = a robots.txt name only, never a visitor (Google-Extended, Applebot-Extended). */
      visits: boolean
      verdict: 'allowed' | 'blocked' | 'unknown'
      /** robots-txt.ts RobotsVerdict['why']. */
      why: 'rules' | 'no-file' | 'server-error' | 'not-shown' | 'slow-down' | 'no-answer'
      /** The group and rule that decided, spelled as robots.txt lines: "User-agent: *",
       *  "Allow: /". null = no group applied / no rule matched / no file. */
      group: string | null
      rule: string | null
    }[]
  }
  sitemap: {
    url: string | null
    status: number | null
    namedInRobots: boolean
    /** Every page the list names (before any cap). */
    total: number
    /** The first pages it lists (at most 50), as paths, with their last-updated date and, for the
     *  pages the run opened, the status a person got. */
    pages: { path: string; lastmod: string | null; status: number | null }[]
    /** Every listed page carries the same date (so the dates tell a search engine nothing). */
    sameDates: boolean
  }
  /** The pages the run opened: "/" and up to 4 from the sitemap. */
  pages: {
    path: string
    /** What a person's visit got. */
    status: number | null
    /** The canonical each visitor was given (absolute URL), null = none. */
    canonical: { person: string | null; google: string | null; bing: string | null }
    /** A "don't list this page" signal: the robots meta tag, or the X-Robots-Tag header. */
    noindex: { meta: boolean; header: boolean }
    /** Each VISITING crawler's answer, by SeoBot key: the status, null = no answer. */
    visits: Record<string, number | null>
  }[]
  /** The site's other spelling (apex ↔ www) and where it sends a visitor; null = not checked. */
  otherHost: { url: string; status: number | null; to: string | null } | null
  /** Whether Google and Bing list the opened pages. A provider is null when the site isn't
   *  registered with it (site_verifications, verified), so it couldn't be asked. Bing has no
   *  "listed" answer: only when it last crawled a page (say "Bing last visited", never "listed"). */
  listing: {
    /** `answered` false = we asked and got no answer (failed, timed out, no key): never "not
     *  listed" and never "no visit". */
    google: { path: string; answered: boolean; verdict: string | null; coverage: string | null; lastCrawl: string | null }[] | null
    bing: { path: string; answered: boolean; lastCrawled: string | null; status: number | null }[] | null
  }
}

/* ── runs ───────────────────────────────────────────────────────────────────────────── */

export type SeoRunTrigger = 'manual' | 'publish' | 'scheduled'

/** Did the site answer at all, as ONE run-level fact (SeoEvidence.reach, stored with the run). */
export type SeoRunReach = NonNullable<SeoEvidence['reach']>

export type SeoTestRun = {
  id: string
  artistId: string
  ranAt: string
  trigger: SeoRunTrigger
  siteUrl: string
  /** One per SeoTestId, in SEO_TEST_IDS order. */
  results: SeoTestResult[]
  /** Did the site answer when the run looked? `state` other than `answered` = the page says
   *  "We couldn't reach your site" once. null = no site connected, a run from before this field,
   *  or a run whose own code broke before it could look. */
  reach?: SeoRunReach | null
}

/** The last results of one test, oldest first, for the history dots. */
export type SeoTestHistory = { ranAt: string; status: SeoTestStatus }[]
