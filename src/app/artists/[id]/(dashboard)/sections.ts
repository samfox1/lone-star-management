import type { UnpublishedDiff } from '@/lib/content'

/**
 * One source of truth for the dashboard's publishable sections: each diff key,
 * its label, and the route segment it lives on. The Overview list renders these
 * rows directly, and the sidebar's per-nav dirty dot is DERIVED from them
 * (dirtyBySeg) — so adding a section can't silently miss its unpublished dot the
 * way three hand-maintained lists could. Keys are typed against UnpublishedDiff,
 * so a typo is a compile error.
 *
 * A MISSING key was not, though: the list hand-carried 9 of UnpublishedDiff's 11 keys,
 * and the two it dropped were `site_styles` and `artist_font` — so a site whose only
 * unpublished work was its styles or its fonts told the manager "everything published"
 * (tools/page.tsx counts the dirty segments this produces). The sweep that keeps it
 * total is tests/unit/publish/diff-sections.test.ts, derived from PUBLISHABLE.
 */
export type DiffSection = { key: keyof UnpublishedDiff; label: string; seg: string }

export const DIFF_SECTIONS = [
  { key: 'profile', label: 'Site / profile', seg: 'site' },
  { key: 'track', label: 'Songs', seg: 'music' },
  { key: 'video', label: 'Videos', seg: 'videos' },
  { key: 'tour_date', label: 'Tour dates', seg: 'tour' },
  { key: 'merch', label: 'Merch', seg: 'merch' },
  { key: 'release', label: 'Releases', seg: 'music' },
  { key: 'link', label: 'Connections', seg: 'connections' },
  { key: 'media', label: 'Media', seg: 'site' },
  { key: 'site_content', label: 'Site text', seg: 'site' },
  { key: 'site_styles', label: 'Site styles', seg: 'site' },
  { key: 'artist_font', label: 'Fonts', seg: 'brand' },
] as const satisfies readonly DiffSection[]

/** The route segments this registry actually emits. Tabs are typed against it, so a tab
 *  naming a segment no section owns is a compile error — `dirty['links']` was silently
 *  `undefined` for the whole time the `link` row's seg was called `connections`. */
export type DiffSeg = (typeof DIFF_SECTIONS)[number]['seg']

/** Per route-segment dirty state: a segment is dirty if any of its sections is. */
export function dirtyBySeg(diff: UnpublishedDiff): Record<DiffSeg, boolean> {
  const out = {} as Record<DiffSeg, boolean>
  for (const s of DIFF_SECTIONS) out[s.seg] = (out[s.seg] ?? false) || diff[s.key].dirty
  return out
}

/** Whether one ROUTE segment is dirty. The tools registry is keyed by route, and most of
 *  its segments (epk, subscribers, settings…) publish nothing — so a miss there is
 *  ordinary, unlike a Tab naming a seg no section emits, which DiffSeg makes impossible. */
export function isSegDirty(dirty: Record<DiffSeg, boolean>, seg: string): boolean {
  return (dirty as Record<string, boolean | undefined>)[seg] ?? false
}
