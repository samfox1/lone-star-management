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
  { key: 'youtube', label: 'YouTube' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'x', label: 'X' },
  { key: 'spotify', label: 'Spotify' },
  { key: 'apple_music', label: 'Apple Music' },
  { key: 'soundcloud', label: 'SoundCloud' },
  { key: 'bandcamp', label: 'Bandcamp' },
  { key: 'google', label: 'Google' },
  { key: 'bing', label: 'Bing' },
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
