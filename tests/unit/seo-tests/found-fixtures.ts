/**
 * Evidence fixtures for the "Can be found" tests: a healthy two-page site, and the pieces to
 * break it with. The html is what real sites and real firewalls serve (a Next.js 404, a
 * Cloudflare "Just a moment..." page, a Squarespace-style password page), not what the code
 * under test looks for.
 */
import { FETCHING_BOTS } from '@/lib/seo-tests/bots'
import type { SeoEvidence, SeoKnown, SeoPageFetch } from '@/lib/seo-tests/types'

export const O = 'https://www.example.com'
export const AT = '2026-09-28T12:00:00.000Z'
export const BIO = "Skeen is a Chicago DJ and producer. He's played ZHU at Navy Pier and remixed Flume for the OutWest EP."

export const doc = (title: string, body: string, head = '') =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`

const NAV = '<header><nav><a href="/">Home</a> <a href="/about">About</a> <a href="/music">Music</a></nav></header>'
export const HOME = doc(
  'Skeen · Chicago house DJ and producer',
  `${NAV}<main><h1>Skeen</h1><section id="music"><h2>Music</h2><ul><li>You Were There</li><li>OutWest</li></ul></section><section id="shows"><h2>Shows</h2><p>Oct 4 · Hideaway, Chicago</p></section><p>Listen on Spotify, Apple Music and SoundCloud. Book Skeen for your next club night in Chicago or anywhere else.</p></main>`,
  `<meta name="description" content="Skeen is a Chicago house DJ and producer."><link rel="canonical" href="${O}/"><script type="application/ld+json">{"@context":"https://schema.org","@type":"MusicGroup","name":"Skeen","description":${JSON.stringify(BIO)}}</script>`,
)
export const ABOUT = doc(
  'About Skeen',
  `${NAV}<main><h1>About</h1><p>Skeen is a Chicago DJ and producer. He&rsquo;s played ZHU at Navy Pier and remixed Flume for the OutWest EP.</p><p>Based in Chicago, playing house and tech house across the Midwest.</p></main>`,
  `<link rel="canonical" href="${O}/about">`,
)

/** Cloudflare's managed challenge, as served (it carries its own noindex, too). */
export const CF_CHALLENGE = doc(
  'Just a moment...',
  `<div class="main-wrapper" role="main"><div class="main-content"><noscript><div class="h2"><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div></noscript></div></div><script>(function(){window._cf_chl_opt={cvId: '3',cZone: "www.example.com",cType: 'managed',cRay: '8c1f',cH: 'x'};var cpo=document.createElement('script');cpo.src='/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=8c1f';document.getElementsByTagName('head')[0].appendChild(cpo);}());</script>`,
  '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1">',
)
/** Cloudflare's block page. */
export const CF_BLOCK = doc('Attention Required! | Cloudflare', '<div id="cf-wrapper"><div id="cf-error-details"><h1>Sorry, you have been blocked</h1><h2>You are unable to access example.com</h2><p>This website is using a security service to protect itself from online attacks.</p><span>Cloudflare Ray ID: 8c1f</span></div></div>')
/** Cloudflare's "Access denied" page for a firewall rule (error 1020). */
export const CF_1020 = doc('Access denied | www.example.com used Cloudflare to restrict access', '<div id="cf-wrapper"><div id="cf-error-details" class="p-0"><header><h1><span class="cf-error-type">Error</span> <span class="cf-error-code">1020</span></h1><h2 class="cf-subheadline">Access denied</h2></header><p>The site owner may have set restrictions that prevent you from accessing the site. You have been blocked by a firewall rule.</p></div></div>')
/** A normal page that happens to load Cloudflare's bot-detection script and a Turnstile
 *  widget on its contact form. NOT a wall. */
export const HOME_WITH_CF_SCRIPTS = HOME.replace(
  '</main>',
  '<form><div class="cf-turnstile" data-sitekey="0x4AAA"></div><button>Send</button></form></main><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async></script><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
)
/** Next.js's default not-found page, served with a 200 (a "soft 404"). */
export const SOFT_404 = doc('404: This page could not be found.', '<div style="font-family:system-ui"><div><h1 class="next-error-h1">404</h1><div><h2>This page could not be found.</h2></div></div></div>')
/** A page that is empty until its scripts run. */
export const EMPTY_SHELL = doc('Skeen', '<div id="root"></div><script type="module" src="/assets/index-4f1c.js"></script>')
/** A password page. */
export const LOGIN = doc('Skeen — Password', '<main><h1>This site is private</h1><form method="post"><label>Password <input type="password" name="password"></label><button>Enter</button></form></main>')
/** A different page altogether (what a bot wall or cloaking hands a bot). */
export const OTHER_PAGE = doc('Welcome', '<main><h1>Welcome, crawler</h1><p>Our partner program offers structured data licensing for machine learning companies. Contact sales for a quote and terms of access.</p></main>')

export function fetched(path: string, html: string | null, over: Partial<SeoPageFetch> = {}): SeoPageFetch {
  return { path, finalUrl: `${O}${path}`, status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, html, ...over }
}

export const KNOWN: SeoKnown = {
  artistName: 'Skeen',
  siteUrl: O,
  today: '2026-09-28',
  published: {
    bio: BIO,
    genre: 'House',
    location: 'Chicago',
    seoTitle: null,
    seoDescription: null,
    ogImage: null,
    links: [],
    tourDates: [
      { date: '2026-10-04', venue: 'Hideaway', city: 'Chicago', isPast: false },
      { date: '2026-08-15', venue: 'Navy Pier', city: 'Chicago', isPast: true },
    ],
    releases: [{ title: 'You Were There', releasedOn: '2026-02-14' }, { title: 'OutWest', releasedOn: '2025-06-01' }],
    photos: [],
    publishedAt: '2026-09-28T09:14:00Z',
  },
}

export type Fixture = {
  pages?: Record<string, string>
  /** Changes to the plain visit, per path. */
  plain?: Record<string, Partial<SeoPageFetch>>
  /** Changes to EVERY bot's visit, per path. */
  allBots?: Record<string, Partial<SeoPageFetch>>
  /** Changes to one bot's visit, per path. */
  bots?: Record<string, Record<string, Partial<SeoPageFetch>>>
  robots?: SeoEvidence['robots']
  sitemap?: SeoEvidence['sitemap']
  known?: SeoKnown
  bing?: SeoEvidence['bing']
}

export const ROBOTS_OK = `User-agent: *\nAllow: /\n\nSitemap: ${O}/sitemap.xml\n`
export const SITEMAP_OK: NonNullable<SeoEvidence['sitemap']> = {
  status: 200,
  urls: [`${O}/`, `${O}/about`],
  lastmods: ['2026-09-28', '2026-09-20'],
  url: `${O}/sitemap.xml`,
  parsed: true,
  namedInRobots: true,
  total: 2,
  offSite: { count: 0, examples: [] },
}

export function evidence(f: Fixture = {}): SeoEvidence {
  const pages = f.pages ?? { '/': HOME, '/about': ABOUT }
  const paths = Object.keys(pages)
  const visit = (path: string, ...over: (Partial<SeoPageFetch> | undefined)[]) => Object.assign(fetched(path, pages[path]), ...over.filter(Boolean))
  return {
    origin: O,
    gatheredAt: AT,
    paths,
    plain: paths.map((p) => visit(p, f.plain?.[p])),
    byBot: Object.fromEntries(FETCHING_BOTS.map((b) => [b.key, paths.map((p) => visit(p, f.allBots?.[p], f.bots?.[b.key]?.[p]))])),
    robots: f.robots ?? { status: 200, body: ROBOTS_OK },
    sitemap: f.sitemap === undefined ? SITEMAP_OK : f.sitemap,
    shareImage: null,
    musicbrainz: { looked: false, artistUrl: null, matchedOn: null },
    known: f.known ?? KNOWN,
    bing: f.bing ?? { siteAuth: { status: 404, hasUser: false } },
  }
}
