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

/** The buckets that are search engines: on the page they fold into ONE "Search" ring. */
export const SEARCH_SOURCES: readonly SourceKey[] = SOURCES.filter((s) => (s as { kind?: string }).kind === 'search').map((s) => s.key)

/** Search engines the door does not bucket (they land in `other` with their host kept).
 *  Matched on the host or any parent domain, like the door's own table. */
export const SEARCH_ENGINE_HOSTS = [
  'duckduckgo.com', 'yahoo.com', 'search.brave.com', 'kagi.com', 'ecosia.org', 'startpage.com',
  'qwant.com', 'yandex.com', 'yandex.ru', 'baidu.com', 'ask.com', 'aol.com', 'search.naver.com',
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
