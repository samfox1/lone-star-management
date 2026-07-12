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
import {
  deleteMediaAction,
  reorderGalleryAction,
  saveEditorFieldAction,
} from '@/app/artists/[id]/(dashboard)/actions'
import type { EditorTextField } from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  deleteMediaAction: vi.fn(async () => ({})),
  reorderGalleryAction: vi.fn(async () => ({})),
  saveEditorFieldAction: vi.fn(async () => ({})),
}))
const deleteMock = vi.mocked(deleteMediaAction)
const reorderMock = vi.mocked(reorderGalleryAction)
const saveMock = vi.mocked(saveEditorFieldAction)

const PHOTOS: GalleryPhoto[] = [
  { id: 'm1', storage_path: 'artist-1/gallery/a.jpg' },
  { id: 'm2', storage_path: 'artist-1/gallery/b.jpg' },
  { id: 'm3', storage_path: 'artist-1/gallery/c.jpg' },
]

const TEXT_FIELDS: EditorTextField[] = [
  { key: 'artist_name', label: 'Artist name', type: 'text', value: 'Skeen', multiline: false },
  { key: 'hero_tagline', label: 'Hero tagline', type: 'text', value: 'DJ & Producer', multiline: false },
  { key: 'artist_bio', label: 'Bio', type: 'text', value: 'Line one', multiline: true },
]

function renderInspector(
  photos: GalleryPhoto[] = PHOTOS,
  opts: { textFields?: EditorTextField[]; onApplyField?: (k: string, v: string) => void } = {},
) {
  return render(
    <EditorInspector
      artistId="artist-1"
      photos={photos}
      textFields={opts.textFields ?? []}
      onApplyField={opts.onApplyField}
    />,
  )
}

afterEach(() => {
  cleanup()
  deleteMock.mockClear()
  reorderMock.mockClear()
  saveMock.mockClear()
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

  it('reorders via drag and persists the new order', () => {
    openImages()
    const tiles = document.querySelectorAll('aside div[draggable="true"]')
    expect(tiles.length).toBe(3)
    fireEvent.dragStart(tiles[0]) // pick up the first photo (m1)
    fireEvent.drop(tiles[2]) // drop on the third slot
    // optimistic order + persisted with the new id order
    expect(reorderMock).toHaveBeenCalledWith('artist-1', ['m2', 'm3', 'm1'])
    const imgs = document.querySelectorAll('aside img')
    expect((imgs[2] as HTMLImageElement).src).toContain('artist-1/gallery/a.jpg')
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

describe('EditorInspector — Text component', () => {
  it('lists text fields with the real count', () => {
    renderInspector([], { textFields: TEXT_FIELDS })
    expect(screen.getByRole('button', { name: /Text/ }).textContent).toContain('3 fields')
  })

  it('edits a field: optimistic live-preview immediately, debounced save', () => {
    vi.useFakeTimers()
    try {
      const onApply = vi.fn()
      renderInspector([], { textFields: TEXT_FIELDS, onApplyField: onApply })
      fireEvent.click(screen.getByRole('button', { name: /Text/ }))

      const tagline = screen.getByLabelText('Hero tagline') as HTMLInputElement
      expect(tagline.value).toBe('DJ & Producer')

      fireEvent.change(tagline, { target: { value: 'Live Act' } })
      // optimistic paint fires immediately; the save is debounced
      expect(onApply).toHaveBeenCalledWith('hero_tagline', 'Live Act')
      expect(saveMock).not.toHaveBeenCalled()

      vi.advanceTimersByTime(500)
      expect(saveMock).toHaveBeenCalledWith('artist-1', 'hero_tagline', 'Live Act')
    } finally {
      vi.useRealTimers()
    }
  })
})
