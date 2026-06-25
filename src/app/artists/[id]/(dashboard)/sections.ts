import type { UnpublishedDiff } from '@/lib/content'

/**
 * One source of truth for the dashboard's publishable sections: each diff key,
 * its label, and the route segment it lives on. The Overview list renders these
 * rows directly, and the sidebar's per-nav dirty dot is DERIVED from them
 * (dirtyBySeg) — so adding a section can't silently miss its unpublished dot the
 * way three hand-maintained lists could. Keys are typed against UnpublishedDiff,
 * so a typo is a compile error.
 */
export type DiffSection = { key: keyof UnpublishedDiff; label: string; seg: string }

export const DIFF_SECTIONS: DiffSection[] = [
  { key: 'profile', label: 'Site / profile', seg: 'site' },
  { key: 'track', label: 'Tracks', seg: 'tracks' },
  { key: 'video', label: 'Videos', seg: 'videos' },
  { key: 'tour_date', label: 'Tour dates', seg: 'tour' },
  { key: 'merch', label: 'Merch', seg: 'merch' },
  { key: 'link', label: 'Links', seg: 'links' },
  { key: 'media', label: 'Media', seg: 'site' },
  { key: 'site_content', label: 'Site text', seg: 'site' },
]

/** Per route-segment dirty state: a segment is dirty if any of its sections is. */
export function dirtyBySeg(diff: UnpublishedDiff): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const s of DIFF_SECTIONS) out[s.seg] = (out[s.seg] ?? false) || diff[s.key].dirty
  return out
}
