// The dashboard's section registry: every publishable key has a row, and every tab names a real seg.
/**
 * DIFF_SECTIONS is the single source of truth for "what can be unpublished" in the
 * dashboard — the Overview list renders it, `dirtyBySeg` folds it into the nav's pending
 * dot, and tools/page.tsx counts its segments to decide between "N sections unpublished"
 * and "everything published".
 *
 * It had NO tests at all (`grep -rn "DIFF_SECTIONS\|dirtyBySeg\|dirtySegs" tests` was
 * empty), and it hand-listed 9 of `UnpublishedDiff`'s 11 keys. The two missing were
 * `site_styles` and `artist_font` — exactly rule 4's failure: a hand-written list omits
 * every future member. A site whose ONLY unpublished work was its styles reported
 * "everything published".
 *
 * The same commit that renamed the `link` row's seg from `links` to `connections`
 * (cbcba6c, 2026-09-13) left `artist-tabs.tsx` naming `links`, so `dirty['links']` was
 * permanently `undefined` and Connections edits never lit the Manager tools dot. That is
 * the second sweep here: every seg a Tab claims must be a seg some section actually emits.
 *
 * Both expectations are DERIVED — from `PUBLISHABLE` and from `DIFF_SECTIONS` itself —
 * so the next entity or the next rename cannot slip past by not being on a list.
 */
import { describe, expect, it } from 'vitest'
import { PUBLISHABLE } from '@/lib/content'
import { DIFF_SECTIONS, dirtyBySeg, type DiffSeg } from '@/app/artists/[id]/(dashboard)/sections'
import { TABS } from '@/app/artists/[id]/(dashboard)/artist-tabs'

/** Every key `diffUnpublished` returns: the profile singleton plus every publishable
 *  entity. Read off the registry, never typed out — see the file header. */
const DIFF_KEYS = ['profile', ...Object.keys(PUBLISHABLE)]

describe('DIFF_SECTIONS covers every unpublishable section', () => {
  it('has a row for every key diffUnpublished reports', () => {
    const covered = new Set(DIFF_SECTIONS.map((s) => s.key as string))
    expect(DIFF_KEYS.length).toBeGreaterThan(9) // non-vacuous: the registry really is bigger
    expect([...DIFF_KEYS].filter((k) => !covered.has(k))).toEqual([])
  })

  it('names no key diffUnpublished does not report', () => {
    const keys = new Set(DIFF_KEYS)
    expect(DIFF_SECTIONS.map((s) => s.key as string).filter((k) => !keys.has(k))).toEqual([])
  })

  it('dirtyBySeg reports a segment dirty when any of its sections is', () => {
    // A diff where ONLY the styles are dirty — the shape tools/page.tsx read as "Live".
    const clean = { added: 0, edited: 0, deleted: 0, dirty: false }
    const diff = Object.fromEntries(
      DIFF_KEYS.map((k) => [k, k === 'site_styles' ? { added: 0, edited: 1, deleted: 0, dirty: true } : clean]),
    ) as never
    const dirty = dirtyBySeg(diff)
    expect(Object.values(dirty).filter(Boolean)).toHaveLength(1)
  })
})

describe('every nav tab names a segment that exists', () => {
  it('claims only segs DIFF_SECTIONS emits', () => {
    const segs = new Set<string>(DIFF_SECTIONS.map((s) => s.seg))
    const claimed = TABS.flatMap((t) => t.dirtySegs as readonly string[])
    expect(claimed.length).toBeGreaterThan(0) // non-vacuous
    expect(claimed.filter((s) => !segs.has(s))).toEqual([])
  })

  it('leaves no seg without a tab to show its dot', () => {
    const claimed = new Set<string>(TABS.flatMap((t) => t.dirtySegs as readonly string[]))
    const segs = [...new Set(DIFF_SECTIONS.map((s) => s.seg as DiffSeg))]
    expect(segs.filter((s) => !claimed.has(s))).toEqual([])
  })
})
