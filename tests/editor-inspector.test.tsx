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
  saveEditorStyleAction,
  setOnSiteAction,
  updateContentAction,
} from '@/app/artists/[id]/(dashboard)/actions'
import type { ManifestStyleRegion } from '@/lib/site-editor/manifest'
import type {
  EditorLink,
  EditorMerch,
  EditorSong,
  EditorTextField,
  EditorTour,
  EditorVideo,
} from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  deleteMediaAction: vi.fn(async () => ({})),
  reorderGalleryAction: vi.fn(async () => ({})),
  saveEditorFieldAction: vi.fn(async () => ({})),
  saveEditorStyleAction: vi.fn(async () => ({ ok: true })),
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
const saveStyleMock = vi.mocked(saveEditorStyleAction)

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
  { id: 'l1', label: 'Spotify', url: 'https://open.spotify.com/x', onSite: true },
  { id: 'l2', label: 'Instagram', url: 'https://instagram.com/x', onSite: true },
  // Off-site, to prove the toggle reflects state rather than always reading "On site".
  { id: 'l3', label: 'Bandcamp', url: 'https://x.bandcamp.com', onSite: false },
]

const VIDEOS: EditorVideo[] = [
  { id: 'v1', title: 'Live at the Mohawk', poster: 'https://i.ytimg.com/vi/aaa/hqdefault.jpg', onSite: false },
  { id: 'v2', title: 'Studio session', poster: null, onSite: true },
  { id: 'v3', title: 'Tour recap', poster: null, onSite: false },
]

const MERCH: EditorMerch[] = [
  { id: 'p1', title: 'Tour Tee', price: '30', url: 'https://shop/x', image_url: 'https://img/tee.jpg', onSite: false },
  { id: 'p2', title: 'Vinyl LP', price: '25', url: 'https://shop/y', image_url: null, onSite: false },
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
    tours?: EditorTour[]
    styleRegions?: ManifestStyleRegion[]
    styleValues?: Record<string, string>
    selectedStyle?: string | null
    onApplyField?: (k: string, v: string) => void
    onApplyStyle?: (k: string, c: string) => void
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
      tours={opts.tours ?? []}
      styleRegions={opts.styleRegions ?? []}
      styleValues={opts.styleValues ?? {}}
      selectedStyle={opts.selectedStyle ?? null}
      onApplyField={opts.onApplyField}
      onApplyStyle={opts.onApplyStyle}
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
  saveStyleMock.mockClear()
})

describe('EditorInspector — browse state', () => {
  it('lists every component type and the real photo count', () => {
    renderInspector()
    for (const label of ['Images', 'Text', 'Links', 'Videos', 'Music', 'Merch']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: /Images/ }).textContent).toContain('1 of 3 on site')
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
    expect(screen.getByText('1 of 3 on site')).toBeTruthy()
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
    expect(screen.getByText('1 of 2 on site')).toBeTruthy()
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
    expect(screen.getByText('1 of 4 on site')).toBeTruthy()
  })

  it('toggles a photo on-site (writes on_site via setOnSiteAction)', () => {
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
    expect(screen.getByRole('button', { name: /Links/ }).textContent).toContain('2 of 3 on site')
  })

  it('lists links with editable label + url and an add-link out', () => {
    openLinks()
    expect((screen.getByLabelText('Link 1 label') as HTMLInputElement).value).toBe('Spotify')
    expect((screen.getByLabelText('Link 1 URL') as HTMLInputElement).value).toBe('https://open.spotify.com/x')
    expect(screen.getByRole('link', { name: /Add link/ }).getAttribute('href')).toBe('/artists/artist-1/links')
  })

  it('takes an on-site link OFF the site (writes on_site via setOnSiteAction)', () => {
    openLinks()
    // l1 is on-site → its toggle offers to take it off.
    fireEvent.click(screen.getAllByRole('button', { name: /On the site/ })[0])
    expect(setOnSiteMock).toHaveBeenCalledWith('link', 'l1', 'artist-1', false)
  })

  it('puts an off-site link back ON the site', () => {
    openLinks()
    // l3 is the only off-site link, so it owns the only "Off the site" toggle.
    fireEvent.click(screen.getByRole('button', { name: /Off the site/ }))
    expect(setOnSiteMock).toHaveBeenCalledWith('link', 'l3', 'artist-1', true)
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
    expect(screen.getByRole('button', { name: /Videos/ }).textContent).toContain('1 of 3 on site')
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
    expect(screen.getByRole('button', { name: /Merch/ }).textContent).toContain('0 of 2 on site')
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
    expect(screen.getByRole('button', { name: /Music/ }).textContent).toContain('1 of 3 on site')
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

  it('toggles a song on-site (writes on_site via setOnSiteAction)', () => {
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

/**
 * Style tools (SITE_STYLING_PLAN.md S4). The regions are NOT hardcoded here: a
 * custom site posts its own edit-list on `ready` (D-D), so the shell hands them in.
 * A stored class string REPLACES the region's base classes, so the field seeds with
 * the override when there is one and the base otherwise — clearing it restores the
 * base.
 */
describe('EditorInspector — Style component', () => {
  const REGIONS: ManifestStyleRegion[] = [
    { key: 'hero_wordmark', label: 'Hero wordmark (SKEEN)', base: 'font-black uppercase' },
    { key: 'footer', label: 'Footer', base: 'mt-auto border-t px-6' },
  ]

  function openStyle(opts: Parameters<typeof renderInspector>[1] = {}) {
    renderInspector([], { styleRegions: REGIONS, ...opts })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
  }

  it('lists the frame-provided regions with the real count', () => {
    renderInspector([], { styleRegions: REGIONS })
    expect(screen.getByRole('button', { name: /Style/ }).textContent).toContain('2 regions')
  })

  it('seeds a field with the region BASE when there is no override', () => {
    openStyle()
    expect((screen.getByLabelText('Hero wordmark (SKEEN) classes') as HTMLTextAreaElement).value).toBe(
      'font-black uppercase',
    )
  })

  it('seeds a field with the SAVED override in preference to the base', () => {
    openStyle({ styleValues: { hero_wordmark: 'text-9xl text-red-500' } })
    expect((screen.getByLabelText('Hero wordmark (SKEEN) classes') as HTMLTextAreaElement).value).toBe(
      'text-9xl text-red-500',
    )
  })

  it('repaints the frame as you type, before any save', () => {
    const onApplyStyle = vi.fn()
    openStyle({ onApplyStyle })
    fireEvent.change(screen.getByLabelText('Footer classes'), { target: { value: 'bg-black' } })
    expect(onApplyStyle).toHaveBeenCalledWith('footer', 'bg-black')
  })

  it('debounces the save, then persists the class string', () => {
    vi.useFakeTimers()
    try {
      openStyle()
      fireEvent.change(screen.getByLabelText('Footer classes'), { target: { value: 'bg-black' } })
      expect(saveStyleMock).not.toHaveBeenCalled() // not on every keystroke
      vi.advanceTimersByTime(500)
      expect(saveStyleMock).toHaveBeenCalledWith('artist-1', 'footer', 'bg-black')
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves an EMPTY string (it clears the override — not a no-op)', () => {
    vi.useFakeTimers()
    try {
      openStyle({ styleValues: { footer: 'bg-black' } })
      fireEvent.change(screen.getByLabelText('Footer classes'), { target: { value: '' } })
      vi.advanceTimersByTime(500)
      expect(saveStyleMock).toHaveBeenCalledWith('artist-1', 'footer', '')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does NOT save characters the server would reject, and flags the field', () => {
    vi.useFakeTimers()
    try {
      openStyle()
      // Validated with the same cleanClassText the action uses, so the panel can't
      // report success for a write that will be refused.
      fireEvent.change(screen.getByLabelText('Footer classes'), { target: { value: '<script>' } })
      vi.advanceTimersByTime(500)
      expect(saveStyleMock).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Footer classes').getAttribute('aria-invalid')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts Tailwind arbitrary values + variants', () => {
    vi.useFakeTimers()
    try {
      openStyle()
      const v = 'text-[clamp(3rem,12vw,11rem)] hover:text-red-500 sm:font-black'
      fireEvent.change(screen.getByLabelText('Footer classes'), { target: { value: v } })
      vi.advanceTimersByTime(500)
      expect(saveStyleMock).toHaveBeenCalledWith('artist-1', 'footer', v)
    } finally {
      vi.useRealTimers()
    }
  })

  it('explains itself when the site declares no styleable regions', () => {
    renderInspector([], { styleRegions: [] })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    expect(screen.getByText(/hasn't declared any styleable regions/i)).toBeTruthy()
  })

  it('clicking a region in the SITE opens Style focused on it', () => {
    // The point of the embedded-frame model: click the thing, edit the thing.
    renderInspector([], { styleRegions: REGIONS, selectedStyle: 'footer' })
    expect((document.activeElement as HTMLElement)?.getAttribute('aria-label')).toBe('Footer classes')
  })
})

/**
 * The editor's job is what's on the SITE (ADR 0006), so its counts must be on-site
 * counts. They used to be LIBRARY counts, which lied: skeen's YouTube sync imports
 * every video off-site (`insertDefaults: on_site:false`), so the panel read
 * "83 videos" while the public site served ZERO of them. Songs and links looked fine
 * only by luck — they happened to be 19/19 and 8/8, so library == on-site.
 */
describe('EditorInspector — counts tell the truth about what is on the site', () => {
  it("REGRESSION: a synced library with NOTHING on-site does not read as '83 videos'", () => {
    const offSite: EditorVideo[] = Array.from({ length: 83 }, (_, i) => ({
      id: `v${i}`,
      title: `DAY ${i}`,
      poster: null,
      onSite: false,
    }))
    renderInspector([], { videos: offSite })
    const label = screen.getByRole('button', { name: /Videos/ }).textContent ?? ''
    expect(label).toContain('0 of 83 on site')
    expect(label).not.toContain('83 videos') // the exact lie
  })

  it('says "N of M on site", not the library total', () => {
    const videos: EditorVideo[] = [
      { id: 'a', title: 'A', poster: null, onSite: true },
      { id: 'b', title: 'B', poster: null, onSite: false },
      { id: 'c', title: 'C', poster: null, onSite: true },
    ]
    renderInspector([], { videos })
    expect(screen.getByRole('button', { name: /Videos/ }).textContent).toContain('2 of 3 on site')
  })

  it('an empty library reads plainly, not "0 of 0 on site"', () => {
    renderInspector([], { videos: [] })
    expect(screen.getByRole('button', { name: /Videos/ }).textContent).toContain('0 videos')
  })

  it('kinds with NO on-site concept keep a plain count (text, style)', () => {
    // A text field or a style region is not something you put "on the site" — it's
    // part of a section that's already there.
    renderInspector([], { textFields: TEXT_FIELDS, styleRegions: [] })
    expect(screen.getByRole('button', { name: /Text/ }).textContent).toContain('3 fields')
  })

  it('shows per-video on-site state in the panel, so a list of 83 is not ambiguous', () => {
    renderInspector([], { videos: [{ id: 'v', title: 'Only', poster: null, onSite: false }] })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
    expect(screen.getByText('Off')).toBeTruthy()
  })
})

/**
 * Tour tools — where a manager picks which dates the site shows (ADR 0009).
 *
 * Dates are ENTERED on the Tour page; this panel only places them. The toggle is
 * live: it writes on_site straight away rather than staging a selection for a publish,
 * which is what makes it safe to sit alongside the Tour page's own toggle.
 */
const TOURS: EditorTour[] = [
  { id: 't1', date: '2026-09-12', venue: 'Mohawk', city: 'Austin', state: 'TX', country: null, support: ['Arlo', 'Crosby, Stills & Nash'], onSite: true },
  { id: 't2', date: '2026-10-02', venue: 'Empty Bottle', city: 'Chicago', state: 'IL', country: null, support: [], onSite: false },
  { id: 't3', date: null, venue: 'TBA', city: null, state: null, country: null, support: [], onSite: false },
]

describe('EditorInspector — tour tools', () => {
  const openTour = () => {
    renderInspector([], { tours: TOURS })
    fireEvent.click(screen.getByRole('button', { name: /Tour/ }))
  }

  it('counts dates that are ON THE SITE, not the library total', () => {
    renderInspector([], { tours: TOURS })
    expect(screen.getByRole('button', { name: /Tour/ }).textContent).toContain('1 of 3 on site')
  })

  it('lists each date with its venue, place and lineup', () => {
    openTour()
    expect(screen.getByText('Mohawk')).toBeTruthy()
    // Place reads "City, ST" — state preferred over country for a US date.
    expect(screen.getByText('Austin, TX')).toBeTruthy()
    // One act with a comma in its name stays one act, all the way from the tag input.
    expect(screen.getByText('+ Arlo, Crosby, Stills & Nash')).toBeTruthy()
  })

  it('omits the place line when there is no city, state or country', () => {
    openTour()
    expect(screen.queryByText(', ')).toBeNull()
  })

  it('CRITICAL: toggling a date on writes on_site LIVE, keyed to the tour kind', () => {
    openTour()
    // 'tour' is the EDITOR kind; it maps to the tour_dates table via LIVE_TOGGLE. If
    // this were reconciled instead, the next publish would silently undo it.
    // Off-site toggles, in list order: t2 then t3. OnSiteToggle is a button with
    // aria-pressed, labelled by what a click will DO.
    fireEvent.click(screen.getAllByRole('button', { name: /Off the site/ })[0])
    expect(setOnSiteMock).toHaveBeenCalledWith('tour', 't2', 'artist-1', true)
  })

  it('takes a date off the site', () => {
    openTour()
    fireEvent.click(screen.getByRole('button', { name: /On the site/ })) // only t1 is on
    expect(setOnSiteMock).toHaveBeenCalledWith('tour', 't1', 'artist-1', false)
  })

  it('removes a date via deleteContentAction', () => {
    openTour()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Mohawk' }))
    expect(deleteContentMock).toHaveBeenCalledWith('tour_date', 't1', 'artist-1')
  })

  it('has no drag handles: tour dates have no sort_order, the door orders by date', () => {
    openTour()
    expect(screen.queryByLabelText(/reorder/i)).toBeNull()
    expect(document.querySelector('aside [draggable="true"]')).toBeNull()
  })

  it('points at the Tour page to add a date', () => {
    openTour()
    expect(screen.getByRole('link', { name: /Add date/ }).getAttribute('href')).toBe('/artists/artist-1/tour')
  })

  it('says where dates come from when the library is empty', () => {
    renderInspector([], { tours: [] })
    fireEvent.click(screen.getByRole('button', { name: /Tour/ }))
    expect(screen.getByText(/Add them on the Tour page/)).toBeTruthy()
  })
})

describe('EditorInspector — videos are live-toggled now (ADR 0009)', () => {
  it('CRITICAL: toggling a video writes on_site, rather than showing a read-only badge', () => {
    // Videos used to render an OnSiteBadge precisely because reconcileOnSite would
    // revert a toggle here. They moved to the live path, so the control is real.
    renderInspector([], { videos: VIDEOS })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /Off the site/ })[0]) // v1
    expect(setOnSiteMock).toHaveBeenCalledWith('video', 'v1', 'artist-1', true)
  })
})
