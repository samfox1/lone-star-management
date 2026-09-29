/**
 * The Apple Music STORE a link is tied to, and the one-click fix to the US store.
 *
 * An Apple Music link names a country store: `music.apple.com/<cc>/artist/<name>/<id>`,
 * `<cc>` an ISO 3166 two-letter code. What that does, as far as it could be checked:
 *   - The artist id is the same in every store; any store's link names the same artist
 *     (MusicBrainz keeps the store as given for the same reason: community.metabrainz.org,
 *     "About localized URL relationships").
 *   - In a web browser, the store in the link is the store you get. Checked 2026-09-29 from a
 *     US address: `music.apple.com/no/artist/skeen/1754431714` answered 200 with the Norway
 *     store page (lang en-GB, canonical /no/), no redirect.
 *   - What Apple's own app does with another country's link could not be checked here.
 *   - `geo.music.apple.com/...` and a link with no store let Apple pick each fan's store.
 * So no fixed store is "right" for every fan. The test (facts.ts) only calls a store wrong when
 * it differs from the country the artist is based in (the Country they published on the Facts
 * tab; the site's own fact card only when Tapir has none), and the one-click fix is offered
 * only when that country is the US (this function only writes /us/).
 *
 * Pure. Never throws.
 */

const HOST = 'music.apple.com'
const ARTIST_PATH = /^\/([A-Za-z]{2})\/artist\/(?:[^/]+\/)?(?:id)?\d+\/?$/

let names: Intl.DisplayNames | null = null
function regionNames(): Intl.DisplayNames | null {
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    names = null
  }
  return names
}

/** Codes Intl names that are groups, not countries (European Union, Outlying Oceania...). */
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB'])

/** A real ISO country (Intl knows it by name), not a made-up or reserved code. */
function isCountry(code: string): boolean {
  if (NOT_COUNTRIES.has(code)) return false
  const n = regionNames()?.of(code)
  return !!n && n !== code && n !== 'Unknown Region'
}

function parse(url: string): { u: URL; store: string } | null {
  if (typeof url !== 'string') return null
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.hostname.toLowerCase() !== HOST) return null
  const m = ARTIST_PATH.exec(u.pathname)
  if (!m) return null
  const store = m[1].toLowerCase()
  return isCountry(store.toUpperCase()) ? { u, store } : null
}

/** The store an Apple Music ARTIST link is tied to ("no"), or null: no store in it, a geo
 *  link, another page, another site. */
export function appleStorefrontOf(url: string): string | null {
  return parse(url)?.store ?? null
}

/**
 * An Apple Music artist link tied to a non-US store, moved to the US store: the same path,
 * `/<cc>/` → `/us/`, https, the old store's language setting (`?l=`) dropped. Null for a US
 * link, a link with no store, anything that isn't an Apple Music artist link, and junk.
 */
export function appleStorefrontFix(url: string): { fixed: string; from: string; to: string } | null {
  const p = parse(url)
  if (!p || p.store === 'us') return null
  const u = new URL(p.u.toString())
  u.protocol = 'https:'
  u.hostname = HOST
  u.pathname = u.pathname.replace(/^\/[A-Za-z]{2}\//, '/us/')
  u.searchParams.delete('l')
  return { fixed: u.toString(), from: p.store, to: 'us' }
}

/* ── countries ──────────────────────────────────────────────────────────────────────── */

const ALIASES: Record<string, string> = {
  usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', 'united states of america': 'US', america: 'US',
  uk: 'GB', 'u.k.': 'GB', 'great britain': 'GB', britain: 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'northern ireland': 'GB',
  holland: 'NL', 'south korea': 'KR', korea: 'KR', russia: 'RU',
}
let byName: Map<string, string> | null = null
function nameIndex(): Map<string, string> {
  if (byName) return byName
  byName = new Map()
  const dn = regionNames()
  if (dn) {
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b)
        if (isCountry(code)) byName.set(dn.of(code)!.toLowerCase(), code)
      }
    }
  }
  return byName
}

/** A country as its ISO two-letter code ("US"), from a code or an English name, or null.
 *  The fact card's `addressCountry` may hold either (schema.org allows both). */
export function countryCode(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  const lower = s.toLowerCase()
  // Aliases first: "UK" is two letters but not the ISO code (GB), though Intl names it.
  if (ALIASES[lower]) return ALIASES[lower]
  if (/^[A-Za-z]{2}$/.test(s)) return isCountry(s.toUpperCase()) ? s.toUpperCase() : null
  return nameIndex().get(lower) ?? null
}

/** "Norway", "the United States": a country's English name, for a sentence. */
export function countryName(code: string): string {
  const up = code.toUpperCase()
  const n = isCountry(up) ? regionNames()!.of(up)! : up
  return /^(United|Netherlands|Philippines|Bahamas|Gambia|Czech|Dominican|Central African|Maldives|Marshall|Solomon)/.test(n) ? `the ${n}` : n
}
