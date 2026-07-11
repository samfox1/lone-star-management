// @vitest-environment jsdom
/**
 * The visual editor's left inspector (phase 2 panel). Covers the two-state
 * navigation and the wired Images tools: Browse lists the component types with the
 * real photo count; opening Images shows the collection tools (real thumbnails,
 * add link, remove wired to deleteMediaAction, size slider, accordions, switcher
 * strip); Back returns; accordions collapse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EditorInspector, type GalleryPhoto } from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'
import { deleteMediaAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  deleteMediaAction: vi.fn(async () => ({})),
}))
const deleteMock = vi.mocked(deleteMediaAction)

const PHOTOS: GalleryPhoto[] = [
  { id: 'm1', storage_path: 'artist-1/gallery/a.jpg' },
  { id: 'm2', storage_path: 'artist-1/gallery/b.jpg' },
  { id: 'm3', storage_path: 'artist-1/gallery/c.jpg' },
]

function renderInspector(photos: GalleryPhoto[] = PHOTOS) {
  return render(<EditorInspector artistId="artist-1" photos={photos} />)
}

afterEach(() => {
  cleanup()
  deleteMock.mockClear()
})

describe('EditorInspector — browse state', () => {
  it('lists every component type and the real photo count', () => {
    renderInspector()
    for (const label of ['Images', 'Text', 'Links', 'Videos', 'Music', 'Merch']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: /Images/ }).textContent).toContain('3 photos')
  })

  it('does not show editing tools until a component is opened', () => {
    renderInspector()
    expect(screen.queryByText('Gallery')).toBeNull()
    expect(screen.queryByLabelText('Collection size')).toBeNull()
  })
})

describe('EditorInspector — opening Images', () => {
  function openImages(photos?: GalleryPhoto[]) {
    renderInspector(photos)
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
  }

  it('opens the gallery editing view with the real photo count', () => {
    openImages()
    expect(screen.getByText('Gallery')).toBeTruthy()
    expect(screen.getByText('3 photos')).toBeTruthy()
  })

  it('renders real thumbnails + an add-photos link', () => {
    openImages()
    const imgs = document.querySelectorAll('aside img')
    expect(imgs.length).toBe(3)
    expect((imgs[0] as HTMLImageElement).src).toContain('artist-1/gallery/a.jpg')
    const add = screen.getByRole('link', { name: /Add photos/ })
    expect(add.getAttribute('href')).toBe('/artists/artist-1/images')
  })

  it('removes a photo optimistically and calls deleteMediaAction', () => {
    openImages()
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    expect(deleteMock).toHaveBeenCalledWith('m1', 'artist-1/gallery/a.jpg', 'artist-1')
    // optimistic: one thumbnail gone, header count updated
    expect(document.querySelectorAll('aside img').length).toBe(2)
    expect(screen.getByText('2 photos')).toBeTruthy()
  })

  it('shows the size slider and layout controls', () => {
    openImages()
    expect(screen.getByLabelText('Collection size')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'More columns' })).toBeTruthy()
  })

  it('collapses a section when its header is toggled', () => {
    openImages()
    expect(screen.getByLabelText('Collection size')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sizing', expanded: true }))
    expect(screen.queryByLabelText('Collection size')).toBeNull()
  })

  it('returns to browse via Back', () => {
    openImages()
    fireEvent.click(screen.getByRole('button', { name: /All components/ }))
    expect(screen.queryByText('Gallery')).toBeNull()
    expect(screen.getByRole('button', { name: /Images/ })).toBeTruthy()
  })

  it('exposes the collapsed component switcher strip with Images current', () => {
    openImages()
    const strip = screen.getByRole('button', { name: 'Images' })
    expect(strip.getAttribute('aria-current')).toBe('true')
    expect(within(document.body).getByRole('button', { name: 'Videos' })).toBeTruthy()
  })
})
