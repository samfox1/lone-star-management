// @vitest-environment jsdom
/**
 * N3 — A DROPPED REGION IS SAID OUT LOUD (SITE_PAGES_PLAN.md A6, second layer).
 *
 * A6 asked for the duplicate-key guard "in two layers: a `duplicate-key` finding in
 * checkContract (site build time), and a drop-plus-surface in the editor's D4 merge
 * (runtime, the one place lone-star sees every page)". The DROP landed months ago; the
 * SURFACE did not. `droppedRegions` was computed, returned by `useFrameBridge`, and
 * consumed by nothing outside its own tests — so a duplicate across pages was detected,
 * resolved first-wins, and silent, which is exactly where it started one layer up.
 *
 * Why the editor needs its own half at all, when checkContract exists: the contract check
 * runs in the SITE's test suite, on the site's own schedule. The editor is where the
 * consequence appears — a manager restyling one heading and watching another change —
 * and it is the only place that sees every page of a live site at once.
 *
 * It is a BANNER, not a blocking error: the editor still works, the region is still
 * editable, and first-wins is a defensible resolution. What was missing was anyone being
 * told.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EditorInspector } from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'
import type { DroppedRegion } from '@samfox1/site-bridge/manifest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => import('./helpers/editor-actions'))

afterEach(cleanup)

const show = (droppedRegions: DroppedRegion[]) =>
  render(<EditorInspector artistId="a1" photos={[]} droppedRegions={droppedRegions} />)

const dupe = (over: Partial<DroppedRegion> = {}): DroppedRegion => ({
  kind: 'styles', key: 'heading', page: 'merch', keptPage: 'home', ...over,
})

describe('the editor says when a region key collides across pages', () => {
  it('CRITICAL: a dropped region is named, with both pages', () => {
    // Actionable or nothing: the fix is to rename one of the two, so the manager (or
    // whoever reads this over their shoulder) needs the key AND which pages fight.
    show([dupe()])
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('heading')
    expect(banner.textContent).toContain('merch')
    expect(banner.textContent).toContain('home')
  })

  it('CRITICAL: nothing is shown when nothing was dropped', () => {
    // The witness, and the state every correct site is in permanently. A banner that
    // always showed would be worse than no banner.
    show([])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('CRITICAL: it defaults to silent — a caller that passes none gets none', () => {
    // The prop is optional and every existing caller omits it. An undefined that rendered
    // a banner would put this on every editor in the app.
    render(<EditorInspector artistId="a1" photos={[]} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('several collisions are all named, not just the first', () => {
    show([dupe({ key: 'heading' }), dupe({ key: 'gallery', kind: 'slots' })])
    const text = screen.getByRole('status').textContent ?? ''
    expect(text).toContain('heading')
    expect(text).toContain('gallery')
  })

  it('CRITICAL: the SHELL actually feeds it — the banner is not orphaned', () => {
    // Mutation found this unwatched (2026-09-09): every test here renders the inspector
    // directly, so deleting the shell's `droppedRegions={...}` left them all green while
    // the banner could never appear in the real editor. That is precisely the shape of
    // the bug this whole feature exists to fix — computed, wired to nothing, silent.
    //
    // Pinned at the source: the shell is a client component wrapping the frame bridge, and
    // the alternative is a test of a mock. Same shape as the route-exists and safelist
    // checks elsewhere in this repo.
    const shell = readFileSync(
      resolve(process.cwd(), 'src/app/artists/[id]/(dashboard)/editor/editor-shell.tsx'),
      'utf8',
    ).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
    expect(shell, 'the shell no longer reads droppedRegions off the bridge').toMatch(
      /\bdroppedRegions\b[\s\S]*droppedRegions=\{droppedRegions\}/,
    )
  })

  it('a duplicate INSIDE one page reads sensibly rather than "merch and merch"', () => {
    // `keptPage === page` is the copy-paste-in-the-registry case, and the fold reports it
    // the same way. Naming one page twice would read as a bug in the message.
    show([dupe({ page: 'merch', keptPage: 'merch' })])
    const text = screen.getByRole('status').textContent ?? ''
    expect(text).toContain('heading')
    expect(text.match(/merch/g) ?? [], 'the same page is named twice').toHaveLength(1)
  })
})
