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
  deleteContentAction,
  deleteMediaAction,
  renameVideoAction,
  reorderContentAction,
  reorderGalleryAction,
  saveEditorFieldAction,
  setOnSiteAction,
  updateContentAction,
} from '@/app/artists/[id]/(dashboard)/actions'
import type {
  EditorLink,
  EditorMerch,
  EditorSong,
  EditorTextField,
  EditorVideo,
} from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  deleteMediaAction: vi.fn(async () => ({})),
  reorderGalleryAction: vi.fn(async () => ({})),
  saveEditorFieldAction: vi.fn(async () => ({})),
  updateContentAction: vi.fn(async () => ({})),
  deleteContentAction: vi.fn(async () => ({})),
  reorderContentAction: vi.fn(async () => ({})),
  renameVideoAction: vi.fn(async () => ({})),
  setOnSiteAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/media-uploader', () => ({
  MediaUploader: ({ onUploaded }: { onUploaded?: (m: { id: string; storage_path: string }) => void }) => (
    <button type="button" onClick={() => onUploaded?.({ id: 'new1', storage_path: 'artist-1/gallery/new.jpg' })}>
      mock-upload
    </button>
  ),
}))

const deleteMock = vi.mocked(deleteMediaAction)
const reorderMock = vi.mocked(reorderGalleryAction)
const saveMock = vi.mocked(saveEditorFieldAction)
const updateContentMock = vi.mocked(updateContentAction)
const deleteContentMock = vi.mocked(deleteContentAction)
const reorderContentMock = vi.mocked(reorderContentAction)
const renameVideoMock = vi.mocked(renameVideoAction)
const setOnSiteMock = vi.mocked(setOnSiteAction)

const PHOTOS: GalleryPhoto[] = [
  { id: 'm1', storage_path: 'artist-1/gallery/a.jpg', onSite: false },
  { id: 'm2', storage_path: 'artist-1/gallery/b.jpg', onSite: true },
  { id: 'm3', storage_path: 'artist-1/gallery/c.jpg', onSite: false },
]

const TEXT_FIELDS: EditorTextField[] = [
  { key: 'artist_name', label: 'Artist name', type: 'text', value: 'Skeen', multiline: false },
  { key: 'hero_tagline', label: 'Hero tagline', type: 'text', value: 'DJ & Producer', multiline: false },
  { key: 'artist_bio', label: 'Bio', type: 'text', value: 'Line one', multiline: true },
]

const LINKS: EditorLink[] = [
  { id: 'l1', label: 'Spotify', url: 'https://open.spotify.com/x' },
  { id: 'l2', label: 'Instagram', url: 'https://instagram.com/x' },
  { id: 'l3', label: 'Bandcamp', url: 'https://x.bandcamp.com' },
]

const VIDEOS: EditorVideo[] = [
  { id: 'v1', title: 'Live at the Mohawk', provider: 'youtube', poster: 'https://i.ytimg.com/vi/aaa/hqdefault.jpg' },
  { id: 'v2', title: 'Studio session', provider: 'youtube', poster: null },
  { id: 'v3', title: 'Tour recap', provider: 'uploaded', poster: null },
]

const MERCH: EditorMerch[] = [
  { id: 'p1', title: 'Tour Tee', price: '30', url: 'https://shop/x', image_url: 'https://img/tee.jpg' },
  { id: 'p2', title: 'Vinyl LP', price: '25', url: 'https://shop/y', image_url: null },
]

const SONGS: EditorSong[] = [
  { id: 's1', title: 'Opener', cover_url: 'https://img/cover.jpg', released: true, onSite: false },
  { id: 's2', title: 'Demo take', cover_url: null, released: false, onSite: false },
  { id: 's3', title: 'Closer', cover_url: null, released: true, onSite: true },
]

function renderInspector(
  photos: GalleryPhoto[] = PHOTOS,
  opts: {
    textFields?: EditorTextField[]
    links?: EditorLink[]
    videos?: EditorVideo[]
    merch?: EditorMerch[]
    songs?: EditorSong[]
    onApplyField?: (k: string, v: string) => void
  } = {},
) {
  return render(
    <EditorInspector
      artistId="artist-1"
      photos={photos}
      textFields={opts.textFields ?? []}
      links={opts.links ?? []}
      videos={opts.videos ?? []}
      merch={opts.merch ?? []}
      songs={opts.songs ?? []}
      onApplyField={opts.onApplyField}
    />,
  )
}

afterEach(() => {
  cleanup()
  deleteMock.mockClear()
  reorderMock.mockClear()
  saveMock.mockClear()
  updateContentMock.mockClear()
  deleteContentMock.mockClear()
  reorderContentMock.mockClear()
  renameVideoMock.mockClear()
  setOnSiteMock.mockClear()
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

  it('renders real thumbnails + an in-editor uploader', () => {
    openImages()
    const imgs = document.querySelectorAll('aside img')
    expect(imgs.length).toBe(3)
    expect((imgs[0] as HTMLImageElement).src).toContain('artist-1/gallery/a.jpg')
    expect(screen.getByRole('button', { name: 'mock-upload' })).toBeTruthy()
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

  it('ignores a second remove while one is in flight (no concurrent-op clobber)', async () => {
    let release: () => void = () => {}
    deleteMock.mockImplementationOnce(() => new Promise((r) => (release = () => r({}))))
    openImages()
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    // first delete is pending → a second remove must be ignored until it settles
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    expect(deleteMock).toHaveBeenCalledTimes(1)
    release()
    await Promise.resolve()
  })

  it('adds an uploaded photo to the grid optimistically (off-site by default)', () => {
    openImages()
    expect(document.querySelectorAll('aside img').length).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: 'mock-upload' }))
    expect(document.querySelectorAll('aside img').length).toBe(4)
    expect(screen.getByText('4 photos')).toBeTruthy()
  })

  it('toggles a photo on-site (writes visible via setOnSiteAction)', () => {
    openImages()
    // m1 starts off-site → its toggle offers to add it
    fireEvent.click(screen.getAllByRole('button', { name: /Off the site/ })[0])
    expect(setOnSiteMock).toHaveBeenCalledWith('photo', 'm1', 'artist-1', true)
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

describe('EditorInspector — Links component', () => {
  function openLinks() {
    renderInspector([], { links: LINKS })
    fireEvent.click(screen.getByRole('button', { name: /Links/ }))
  }

  it('shows the real link count in browse', () => {
    renderInspector([], { links: LINKS })
    expect(screen.getByRole('button', { name: /Links/ }).textContent).toContain('3 links')
  })

  it('lists links with editable label + url and an add-link out', () => {
    openLinks()
    expect((screen.getByLabelText('Link 1 label') as HTMLInputElement).value).toBe('Spotify')
    expect((screen.getByLabelText('Link 1 URL') as HTMLInputElement).value).toBe('https://open.spotify.com/x')
    expect(screen.getByRole('link', { name: /Add link/ }).getAttribute('href')).toBe('/artists/artist-1/links')
  })

  it('does NOT save a blank required field and flags it invalid (no false "Saved")', () => {
    vi.useFakeTimers()
    try {
      openLinks()
      fireEvent.change(screen.getByLabelText('Link 1 label'), { target: { value: '' } })
      vi.advanceTimersByTime(500)
      expect(updateContentMock).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Link 1 label').getAttribute('aria-invalid')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('edits a link label with a debounced content save', () => {
    vi.useFakeTimers()
    try {
      openLinks()
      fireEvent.change(screen.getByLabelText('Link 1 label'), { target: { value: 'Listen' } })
      expect(updateContentMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      expect(updateContentMock).toHaveBeenCalledTimes(1)
      const [type, id, artistId, fd] = updateContentMock.mock.calls[0]
      expect([type, id, artistId]).toEqual(['link', 'l1', 'artist-1'])
      expect((fd as FormData).get('label')).toBe('Listen')
      expect((fd as FormData).get('url')).toBe('https://open.spotify.com/x')
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes a link optimistically via deleteContentAction', () => {
    openLinks()
    fireEvent.click(screen.getByRole('button', { name: 'Remove link 1' }))
    expect(deleteContentMock).toHaveBeenCalledWith('link', 'l1', 'artist-1')
    expect(screen.queryByDisplayValue('Spotify')).toBeNull()
  })

  it('reorders links via drag and persists the new order', () => {
    openLinks()
    const rows = document.querySelectorAll('aside div[draggable="true"]')
    expect(rows.length).toBe(3)
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[2])
    expect(reorderContentMock).toHaveBeenCalledWith('link', 'artist-1', ['l2', 'l3', 'l1'])
  })
})

describe('EditorInspector — Videos component', () => {
  function openVideos() {
    renderInspector([], { videos: VIDEOS })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
  }

  it('shows the real video count in browse', () => {
    renderInspector([], { videos: VIDEOS })
    expect(screen.getByRole('button', { name: /Videos/ }).textContent).toContain('3 videos')
  })

  it('lists videos with editable titles, a poster, and an add-video out', () => {
    openVideos()
    expect((screen.getByLabelText('Video 1 title') as HTMLInputElement).value).toBe('Live at the Mohawk')
    expect(document.querySelector('aside img')).toBeTruthy() // the youtube poster
    expect(screen.getByRole('link', { name: /Add video/ }).getAttribute('href')).toBe('/artists/artist-1/videos')
  })

  it('renames a video with a debounced save', () => {
    vi.useFakeTimers()
    try {
      openVideos()
      fireEvent.change(screen.getByLabelText('Video 2 title'), { target: { value: 'Studio cut' } })
      expect(renameVideoMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      expect(renameVideoMock).toHaveBeenCalledWith('v2', 'artist-1', 'Studio cut')
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes a video via deleteContentAction', () => {
    openVideos()
    fireEvent.click(screen.getByRole('button', { name: 'Remove video 1' }))
    expect(deleteContentMock).toHaveBeenCalledWith('video', 'v1', 'artist-1')
  })

  it('reorders videos via drag and persists the new order', () => {
    openVideos()
    const rows = document.querySelectorAll('aside div[draggable="true"]')
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[2])
    expect(reorderContentMock).toHaveBeenCalledWith('video', 'artist-1', ['v2', 'v3', 'v1'])
  })
})

describe('EditorInspector — Merch component', () => {
  function openMerch() {
    renderInspector([], { merch: MERCH })
    fireEvent.click(screen.getByRole('button', { name: /Merch/ }))
  }

  it('shows the real product count in browse', () => {
    renderInspector([], { merch: MERCH })
    expect(screen.getByRole('button', { name: /Merch/ }).textContent).toContain('2 products')
  })

  it('lists products with editable name/price/url + an add-product out', () => {
    openMerch()
    expect((screen.getByLabelText('Product 1 name') as HTMLInputElement).value).toBe('Tour Tee')
    expect((screen.getByLabelText('Product 1 price') as HTMLInputElement).value).toBe('30')
    expect((screen.getByLabelText('Product 1 URL') as HTMLInputElement).value).toBe('https://shop/x')
    expect(screen.getByRole('link', { name: /Add product/ }).getAttribute('href')).toBe('/artists/artist-1/merch')
  })

  it('edits a product with a debounced content save (title/price/url together)', () => {
    vi.useFakeTimers()
    try {
      openMerch()
      fireEvent.change(screen.getByLabelText('Product 1 price'), { target: { value: '35' } })
      expect(updateContentMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      const [type, id, artistId, fd] = updateContentMock.mock.calls[0]
      expect([type, id, artistId]).toEqual(['merch', 'p1', 'artist-1'])
      expect((fd as FormData).get('title')).toBe('Tour Tee')
      expect((fd as FormData).get('price')).toBe('35')
      expect((fd as FormData).get('url')).toBe('https://shop/x')
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes a product via deleteContentAction', () => {
    openMerch()
    fireEvent.click(screen.getByRole('button', { name: 'Remove product 1' }))
    expect(deleteContentMock).toHaveBeenCalledWith('merch', 'p1', 'artist-1')
    expect(screen.queryByDisplayValue('Tour Tee')).toBeNull()
  })

  it('does NOT save a non-numeric price and flags it invalid', () => {
    vi.useFakeTimers()
    try {
      openMerch()
      fireEvent.change(screen.getByLabelText('Product 1 price'), { target: { value: 'abc' } })
      vi.advanceTimersByTime(500)
      expect(updateContentMock).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Product 1 price').getAttribute('aria-invalid')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('EditorInspector — Music component', () => {
  function openMusic() {
    renderInspector([], { songs: SONGS })
    fireEvent.click(screen.getByRole('button', { name: /Music/ }))
  }

  it('shows the real song count in browse', () => {
    renderInspector([], { songs: SONGS })
    expect(screen.getByRole('button', { name: /Music/ }).textContent).toContain('3 songs')
  })

  it('lists songs with editable titles, a Released/Unreleased tag, and an add-song out', () => {
    openMusic()
    expect((screen.getByLabelText('Song 1 title') as HTMLInputElement).value).toBe('Opener')
    // s1 released, s2 unreleased
    expect(screen.getAllByText('Released').length).toBe(2)
    expect(screen.getByText('Unreleased')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Add song/ }).getAttribute('href')).toBe('/artists/artist-1/music')
  })

  it('renames a song with a debounced content save', () => {
    vi.useFakeTimers()
    try {
      openMusic()
      fireEvent.change(screen.getByLabelText('Song 2 title'), { target: { value: 'Demo v2' } })
      expect(updateContentMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      const [type, id, artistId, fd] = updateContentMock.mock.calls[0]
      expect([type, id, artistId]).toEqual(['track', 's2', 'artist-1'])
      expect((fd as FormData).get('title')).toBe('Demo v2')
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes a song via deleteContentAction', () => {
    openMusic()
    fireEvent.click(screen.getByRole('button', { name: 'Remove song 1' }))
    expect(deleteContentMock).toHaveBeenCalledWith('track', 's1', 'artist-1')
  })

  it('toggles a song on-site (writes visible via setOnSiteAction)', () => {
    openMusic()
    // s1 starts off-site → its toggle offers to add it
    fireEvent.click(screen.getAllByRole('button', { name: /Off the site/ })[0])
    expect(setOnSiteMock).toHaveBeenCalledWith('track', 's1', 'artist-1', true)
  })

  it('does NOT save a blank song title and flags it invalid', () => {
    vi.useFakeTimers()
    try {
      openMusic()
      fireEvent.change(screen.getByLabelText('Song 1 title'), { target: { value: '' } })
      vi.advanceTimersByTime(500)
      expect(updateContentMock).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Song 1 title').getAttribute('aria-invalid')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reorders songs via drag and persists the new order', () => {
    openMusic()
    const rows = document.querySelectorAll('aside div[draggable="true"]')
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[2])
    expect(reorderContentMock).toHaveBeenCalledWith('track', 'artist-1', ['s2', 's3', 's1'])
  })
})
