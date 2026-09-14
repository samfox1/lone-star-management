/**
 * The source buckets — where a visit came from, in the words the page shows. ONE home
 * (ANALYTICS_PAGE_PLAN.md decision 7): the door pins a copy in
 * supabase/functions/event/derive.ts (the function bundle cannot import from src/) and
 * tests/unit/analytics/event-derive.test.ts diffs the two, the same guard EVENT_TYPES has.
 *
 * Order is display order. `direct` and `other` are the two the door falls back to.
 */
export const SOURCES = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'snapchat', label: 'Snapchat' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'x', label: 'X' },
  { key: 'spotify', label: 'Spotify' },
  { key: 'apple_music', label: 'Apple Music' },
  { key: 'soundcloud', label: 'SoundCloud' },
  { key: 'bandcamp', label: 'Bandcamp' },
  { key: 'google', label: 'Google', kind: 'search' },
  { key: 'bing', label: 'Bing', kind: 'search' },
  { key: 'ai', label: 'AI assistants' },
  { key: 'linktree', label: 'Linktree' },
  { key: 'bandsintown', label: 'Bandsintown' },
  { key: 'songkick', label: 'Songkick' },
  { key: 'email', label: 'Email' },
  { key: 'direct', label: 'Direct' },
  { key: 'other', label: 'Other' },
] as const

export type SourceKey = (typeof SOURCES)[number]['key']
export const SOURCE_KEYS: readonly SourceKey[] = SOURCES.map((s) => s.key)

export function sourceLabel(key: string): string {
  return SOURCES.find((s) => s.key === key)?.label ?? key
}

/** The buckets that are search engines: on the page they fold into ONE "Web search" ring. */
export const SEARCH_SOURCES: readonly SourceKey[] = SOURCES.filter((s) => (s as { kind?: string }).kind === 'search').map((s) => s.key)

/** Search engines the door does not bucket (they land in `other` with their host kept).
 *  Matched on the host or any parent domain, like the door's own table — so a portal
 *  whose root also serves news or mail (Yahoo, AOL, Naver) is listed by its SEARCH
 *  host, and news.yahoo.com or mail.aol.com stay what they are. */
export const SEARCH_ENGINE_HOSTS = [
  'duckduckgo.com', 'search.yahoo.com', 'search.brave.com', 'kagi.com', 'ecosia.org', 'startpage.com',
  'qwant.com', 'yandex.com', 'yandex.ru', 'baidu.com', 'ask.com', 'search.aol.com', 'search.naver.com',
] as const

export function isSearchHost(host: string): boolean {
  let h = host.toLowerCase()
  while (h) {
    if ((SEARCH_ENGINE_HOSTS as readonly string[]).includes(h)) return true
    const dot = h.indexOf('.')
    if (dot < 0) return false
    h = h.slice(dot + 1)
  }
  return false
}

/** What `ringsOf` needs of a source: the summary's shape, without the fields the rings never read. */
export type RingSource = { source: string; label: string; visitors: number; hosts: { host: string; visitors: number }[] }
/** One ring: a source with a mark, or one of the two folds. */
export type Ring = { key: string; label: string; visitors: number; share: number }
export const SEARCH_RING = 'search'
export const OTHER_RING = 'other'

/**
 * Every source as rings, biggest first, shares of everyone. Two folds before
 * ranking (Sam, 2026-09-13): every search engine — the `kind: 'search'` buckets
 * and any search host the door left in the catch-all — is ONE "Web search"
 * ring; whatever else has no mark of its own is ONE "Other" ring. Direct keeps
 * its ring; it has a mark. Every share is computed here from the same total, so
 * a ring and a fold can never disagree about what "everyone" is.
 */
export function ringsOf(sources: RingSource[]): Ring[] {
  const total = sources.reduce((n, s) => n + s.visitors, 0)
  const share = (n: number) => (total ? n / total : 0)
  const rings: Ring[] = []
  let search = 0
  let other = 0
  for (const s of sources) {
    if ((SEARCH_SOURCES as readonly string[]).includes(s.source)) { search += s.visitors; continue }
    if (s.source !== OTHER_RING) { rings.push({ key: s.source, label: s.label, visitors: s.visitors, share: share(s.visitors) }); continue }
    // The catch-all: a search engine the door did not know is still a search.
    for (const h of s.hosts) {
      if (isSearchHost(h.host)) search += h.visitors
      else other += h.visitors
    }
    // Hostless other rows (an unknown utm_source) have no host to test; they are other.
    other += s.visitors - s.hosts.reduce((n, h) => n + h.visitors, 0)
  }
  if (search > 0) rings.push({ key: SEARCH_RING, label: 'Web search', visitors: search, share: share(search) })
  if (other > 0) rings.push({ key: OTHER_RING, label: 'Other', visitors: other, share: share(other) })
  return rings.sort((a, b) => b.visitors - a.visitors)
}
