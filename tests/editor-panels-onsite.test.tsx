// @vitest-environment jsdom
/**
 * THE ITEM PANELS SHOW WHAT IS ON THE SITE.
 *
 * Sam, 2026-09-09, first about the Music panel and then "yes" to the same rule for Videos
 * and Merch: "items… that have been untallied (dont have the blue check) should be off the
 * panel. i can always re-add them with the add music button."
 *
 * The rule, stated once for all three: the editor is a view of the SITE. The LIBRARY —
 * everything the artist owns, on the site or not — is the dashboard page for that type,
 * which is where each panel's Add link already goes. A panel listing the whole library
 * means editing a two-album site starts with scrolling past the back catalogue.
 *
 * Videos already worked this way and is pinned here rather than changed: its band cards
 * are the on-site videos, and the off-site ones are the PICKER's candidates — an explicit
 * "add one" flow rather than a wall of dimmed tiles. That is the shape the other two now
 * match, so this file keeps them honest together.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MerchTools } from '@/app/artists/[id]/(dashboard)/editor/panels/merch-tools'
import { VideoTools } from '@/app/artists/[id]/(dashboard)/editor/panels/video-tools'
import type { EditorMerch, EditorVideo } from '@/app/artists/[id]/(dashboard)/editor/inspector-types'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  renameVideoAction: vi.fn(async () => ({})),
  setOnSiteAction: vi.fn(async () => ({})),
  assignHeroSlotAction: vi.fn(async () => ({})),
}))

afterEach(cleanup)

const product = (over: Partial<EditorMerch>): EditorMerch => ({
  id: 'm', title: 'Tee', price: '30', url: '', image_url: null, onSite: true, inStock: true, ...over,
})

describe('MerchTools — an off-site product is not in the panel', () => {
  it('CRITICAL: off the site means off the panel', () => {
    render(
      <MerchTools
        artistId="a1"
        onEdit={vi.fn()}
        merch={[product({ id: 'm1', title: 'On Sale Now' }), product({ id: 'm2', title: 'Retired Tee', onSite: false })]}
      />,
    )
    expect(screen.getByText('On Sale Now')).toBeTruthy()
    expect(screen.queryByText('Retired Tee'), 'an off-site product is still listed').toBeNull()
  })

  it('CRITICAL: SOLD OUT is not off-site — it still shows, marked', () => {
    // The trap in this one. `inStock` and `onSite` are different flags and the panel
    // already dimmed by the wrong one; filtering on `inStock` would hide a product that
    // IS on the page, and the manager would have no way to edit the thing fans can see.
    render(
      <MerchTools
        artistId="a1"
        onEdit={vi.fn()}
        merch={[product({ id: 'm1', title: 'Sold Out Tee', inStock: false, onSite: true })]}
      />,
    )
    expect(screen.getByText('Sold Out Tee')).toBeTruthy()
    expect(screen.getByText('Sold out')).toBeTruthy()
  })

  it('CRITICAL: the way back is always on screen, full panel or empty', () => {
    const { rerender } = render(<MerchTools artistId="a1" onEdit={vi.fn()} merch={[product({})]} />)
    expect(screen.getByRole('link', { name: /Add product/i })).toBeTruthy()
    rerender(<MerchTools artistId="a1" onEdit={vi.fn()} merch={[product({ onSite: false })]} />)
    expect(screen.getByRole('link', { name: /Add product/i })).toBeTruthy()
  })
})

const video = (over: Partial<EditorVideo>): EditorVideo => ({
  id: 'v', title: 'V', provider: 'youtube', isShort: false, siteRole: null,
  poster: null, previewUrl: null, onSite: true, ...over,
})

describe('VideoTools — already on-site only, and staying that way', () => {
  const SLOTS = [{ kind: 'band' as const, count: 2, label: 'Videos', group: 'Videos' }]

  it('CRITICAL: an off-site YouTube video is not a card', () => {
    // Pinned, not changed. The band renders `videos.filter(v => v.onSite)`; the off-site
    // ones are the picker's candidates. If someone "simplifies" that filter away, this
    // is what says no.
    render(
      <VideoTools
        artistId="a1"
        onToggleOnSite={vi.fn()}
        onAssignHero={vi.fn()}
        onEditItem={vi.fn()}
        videoSlots={SLOTS as never}
        videos={[video({ id: 'v1', title: 'On The Site' }), video({ id: 'v2', title: 'In The Library', onSite: false })]}
      />,
    )
    const titled = screen.queryAllByRole('textbox').map((el) => (el as HTMLInputElement).value)
    expect(titled).toContain('On The Site')
    expect(titled, 'an off-site video became a band card').not.toContain('In The Library')
  })
})
