// @vitest-environment jsdom
/**
 * The visual editor's left inspector (phase 2 panel). Covers the two-state
 * navigation and the wired Images tools: Browse lists the component types with the
 * real photo count; opening Images shows the collection tools (real thumbnails,
 * add link, remove wired to deleteMediaAction, size slider, accordions, switcher
 * strip); Back returns; accordions collapse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EditorInspector, type GalleryPhoto } from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'
import {
  addContentAction,
  deleteContentAction,
  deleteMediaAction,
  renameVideoAction,
  reorderContentAction,
  placeGalleryPhotoAction,
  saveEditorFieldAction,
  saveEditorLinkAction,
  saveEditorStyleAction,
  setOnSiteAction,
  setSupportUrlAction,
  updateContentAction,
  assignHeroSlotAction,
  assignComponentSlotAction,
  setSongsOnSiteAction,
  restorePublishedAction,
  listPublishMomentsAction,
} from '@/app/artists/[id]/(dashboard)/actions'
import type { ManifestComponent, ManifestLinkRegion, ManifestStyleRegion } from '@/lib/site-editor/manifest'
import { buildStyleControls, withStyleVars, type SiteStyleOptions,
} from '@/lib/site-editor/style-controls'
import type { SelectTarget } from '@samfox1/site-bridge/protocol'
import type {
  EditorImageField,
  EditorLink,
  EditorMerch,
  EditorProject,
  EditorSupportLink,
  EditorTextField,
  EditorTour,
  EditorVideo,
} from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  deleteMediaAction: vi.fn(async () => ({})),
  reorderGalleryAction: vi.fn(async () => ({})),
  saveEditorFieldAction: vi.fn(async () => ({})),
  saveEditorStyleAction: vi.fn(async () => ({ ok: true })),
  saveEditorLinkAction: vi.fn(async () => ({ ok: true })),
  updateContentAction: vi.fn(async () => ({})),
  deleteContentAction: vi.fn(async () => ({})),
  reorderContentAction: vi.fn(async () => ({})),
  renameVideoAction: vi.fn(async () => ({})),
  setOnSiteAction: vi.fn(async () => ({})),
  placeGalleryPhotoAction: vi.fn(async () => ({})),
  setSupportUrlAction: vi.fn(async () => ({})),
  assignHeroSlotAction: vi.fn(async () => ({})),
  assignComponentSlotAction: vi.fn(async () => ({})),
  setSongsOnSiteAction: vi.fn(async () => ({})),
  setImageFieldAction: vi.fn(async () => ({ ok: true })),
  addContentAction: vi.fn(async () => ({})),
  restorePublishedAction: vi.fn(async () => ({ ok: true, changed: 3, hasPublished: true })),
  listPublishMomentsAction: vi.fn(async () => ({
    ok: true,
    moments: [
      { publishedAt: '2026-08-14T18:00:00.000Z', entities: 4 },
      { publishedAt: '2026-08-10T09:30:00.000Z', entities: 12 },
    ],
  })),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/media-uploader', () => ({
  MediaUploader: ({ onUploaded }: { onUploaded?: (m: { id: string; storage_path: string }) => void }) => (
    <button type="button" onClick={() => onUploaded?.({ id: 'new1', storage_path: 'artist-1/gallery/new.jpg' })}>
      mock-upload
    </button>
  ),
  // Each empty gallery slot: clicking simulates an upload of that orientation.
  GallerySlotUploader: ({
    orientation,
    onUploaded,
  }: {
    orientation: 'horizontal' | 'vertical'
    onUploaded?: (m: { id: string; storage_path: string; orientation: 'horizontal' | 'vertical' }) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onUploaded?.({ id: `new-${orientation}`, storage_path: `artist-1/gallery/new-${orientation}.jpg`, orientation })
      }
    >
      upload {orientation} photo
    </button>
  ),
}))
// The video slots call useRouter().refresh after a hero assignment; no app-router in the test.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const deleteMock = vi.mocked(deleteMediaAction)
const saveMock = vi.mocked(saveEditorFieldAction)
const updateContentMock = vi.mocked(updateContentAction)
const deleteContentMock = vi.mocked(deleteContentAction)
const reorderContentMock = vi.mocked(reorderContentAction)
const addContentMock = vi.mocked(addContentAction)
const renameVideoMock = vi.mocked(renameVideoAction)
const setOnSiteMock = vi.mocked(setOnSiteAction)
const placePhotoMock = vi.mocked(placeGalleryPhotoAction)
const setSupportUrlMock = vi.mocked(setSupportUrlAction)
const saveStyleMock = vi.mocked(saveEditorStyleAction)
const saveLinkMock = vi.mocked(saveEditorLinkAction)
const assignHeroMock = vi.mocked(assignHeroSlotAction)
const assignSlotMock = vi.mocked(assignComponentSlotAction)
const setSongsOnSiteMock = vi.mocked(setSongsOnSiteAction)

const PHOTOS: GalleryPhoto[] = [
  { id: 'm1', storage_path: 'artist-1/gallery/h-on.jpg', onSite: true, orientation: 'horizontal', siteRole: null },
  // Off-site horizontal → a candidate in the Horizontal picker.
  { id: 'm2', storage_path: 'artist-1/gallery/h-lib.jpg', onSite: false, orientation: 'horizontal', siteRole: null },
  { id: 'm3', storage_path: 'artist-1/gallery/v-on.jpg', onSite: true, orientation: 'vertical', siteRole: null },
  // Off-site vertical → a candidate in the Vertical picker.
  { id: 'm4', storage_path: 'artist-1/gallery/v-lib.jpg', onSite: false, orientation: 'vertical', siteRole: null },
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

const SUPPORT: EditorSupportLink[] = [
  { tourDateId: 't1', name: 'Gudfella', url: '', show: 'Mohawk' },
  { tourDateId: 't1', name: 'Arlo', url: 'https://arlo.example', show: 'Mohawk' },
]

const yt = (v: Omit<EditorVideo, 'provider' | 'isShort' | 'siteRole' | 'previewUrl'>): EditorVideo => ({ ...v, provider: 'youtube', isShort: false, siteRole: null, previewUrl: null })
const VIDEOS: EditorVideo[] = [
  yt({ id: 'v1', title: 'Live at the Mohawk', poster: 'https://i.ytimg.com/vi/aaa/hqdefault.jpg', onSite: false }),
  yt({ id: 'v2', title: 'Studio session', poster: null, onSite: true }),
  yt({ id: 'v3', title: 'Tour recap', poster: null, onSite: false }),
]

const MERCH: EditorMerch[] = [
  { id: 'p1', title: 'Tour Tee', price: '30', url: 'https://shop/x', image_url: 'https://img/tee.jpg', onSite: false },
  { id: 'p2', title: 'Vinyl LP', price: '25', url: 'https://shop/y', image_url: null, onSite: false },
]

const RELEASES: EditorProject[] = [
  {
    key: 'r1', title: 'Midnight LP', cover_url: 'https://img/a.jpg', kind: 'album', onSite: true,
    songs: [{ id: 't1', title: 'Intro' }, { id: 't2', title: 'Nightdrive' }, { id: 't3', title: 'Coda' }],
  },
  {
    key: 'r2', title: 'Sundown EP', cover_url: 'https://img/b.jpg', kind: 'ep', onSite: true,
    songs: [{ id: 't4', title: 'Dusk' }, { id: 't5', title: 'Afterglow' }],
  },
  {
    key: 'r3', title: 'One Off', cover_url: null, kind: 'single', onSite: false,
    songs: [{ id: 't9', title: 'One Off' }],
  },
]

function renderInspector(
  photos: GalleryPhoto[] = PHOTOS,
  opts: {
    textFields?: EditorTextField[]
    links?: EditorLink[]
    supportLinks?: EditorSupportLink[]
    videos?: EditorVideo[]
    merch?: EditorMerch[]
    releases?: EditorProject[]
    tours?: EditorTour[]
    videoSlots?: import('@/lib/site-editor/manifest').ManifestVideoSlot[]
    styleRegions?: ManifestStyleRegion[]
    styleValues?: Record<string, string>
    styleOptions?: SiteStyleOptions
    selectedStyle?: string | null
    components?: ManifestComponent[]
    showGallery?: boolean
    linkRegions?: ManifestLinkRegion[]
    linkValues?: Record<string, string>
    selectedLink?: string | null
    imageFields?: EditorImageField[]
    selectedRegion?: { target: SelectTarget; nonce: number } | null
    deselectedAt?: number
    onApplyField?: (k: string, v: string) => void
    onApplyStyle?: (k: string, c: string) => void
    onApplyLink?: (k: string, u: string) => void
    onHighlight?: (t: SelectTarget) => void
    onClearHighlight?: () => void
    bridgeOutdated?: boolean
  } = {},
) {
  return render(inspector(photos, opts))
}

/** The same element, unrendered — for `rerender`, which is how a test drives a PROP
 *  change (a preview click arriving from the frame bridge) rather than a DOM event. */
function inspector(
  photos: GalleryPhoto[] = PHOTOS,
  opts: Parameters<typeof renderInspector>[1] = {},
) {
  return (
    <EditorInspector
      artistId="artist-1"
      bridgeOutdated={opts.bridgeOutdated ?? false}
      photos={photos}
      imageFields={opts.imageFields ?? []}
      selectedRegion={opts.selectedRegion ?? null}
      onHighlight={opts.onHighlight}
      onClearHighlight={opts.onClearHighlight}
      textFields={opts.textFields ?? []}
      links={opts.links ?? []}
      supportLinks={opts.supportLinks ?? []}
      linkValues={opts.linkValues ?? {}}
      videos={opts.videos ?? []}
      videoSlots={opts.videoSlots ?? SKEEN_VIDEO_SLOTS}
      merch={opts.merch ?? []}
      releases={opts.releases ?? []}
      tours={opts.tours ?? []}
      components={opts.components ?? []}
      showGallery={opts.showGallery ?? true}
      styleRegions={opts.styleRegions ?? []}
      styleValues={opts.styleValues ?? {}}
      styleOptions={opts.styleOptions}
      selectedStyle={opts.selectedStyle ?? null}
      deselectedAt={opts.deselectedAt ?? 0}
      linkRegions={opts.linkRegions ?? []}
      selectedLink={opts.selectedLink ?? null}
      onApplyField={opts.onApplyField}
      onApplyStyle={opts.onApplyStyle}
      onApplyLink={opts.onApplyLink}
    />
  )
}

afterEach(() => {
  cleanup()
  // Every action mock, not a hand-kept list — a missed mock leaks call history into the
  // next test and lets an assertion pass on a stale call.
  vi.clearAllMocks()
})

describe('EditorInspector — browse state', () => {
  it('lists every component type and the real photo count', () => {
    renderInspector()
    for (const label of ['Images', 'Text', 'Links', 'Videos', 'Music', 'Merch']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy()
    }
  })

  it('does not show editing tools until a component is opened', () => {
    renderInspector()
    expect(screen.queryByText('Gallery')).toBeNull()
    expect(screen.queryByLabelText('Collection size')).toBeNull()
  })
})

describe('EditorInspector — opening Images (orientation groups + asset picker)', () => {
  function openImages(photos?: GalleryPhoto[]) {
    renderInspector(photos)
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
  }

  it('opens the gallery as Horizontal + Vertical groups, each with an Add tile', () => {
    openImages()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(screen.getByText('Horizontal')).toBeTruthy()
    expect(screen.getByText('Vertical')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add horizontal photo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add vertical photo' })).toBeTruthy()
  })

  it('shows only ON-SITE photos as cards (m1 horizontal, m3 vertical)', () => {
    openImages()
    const imgs = Array.from(document.querySelectorAll('aside img')) as HTMLImageElement[]
    expect(imgs.length).toBe(2)
    expect(imgs.some((i) => i.src.includes('h-on.jpg'))).toBe(true)
    expect(imgs.some((i) => i.src.includes('v-on.jpg'))).toBe(true)
  })

  it('Add opens the picker over ONLY that orientation’s off-site photos + an uploader', () => {
    openImages()
    fireEvent.click(screen.getByRole('button', { name: 'Add horizontal photo' }))
    const dialog = screen.getByRole('dialog')
    // A photo is horizontal OR vertical: the horizontal picker shows m2 only (m4 is
    // vertical and must not appear here). Candidates are labelled by the group.
    expect(within(dialog).getByRole('button', { name: /Horizontal 1/ })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /Horizontal 2/ })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'upload horizontal photo' })).toBeTruthy()
  })

  it('picking a library photo PLACES it (sets orientation + on the site)', () => {
    openImages()
    fireEvent.click(screen.getByRole('button', { name: 'Add horizontal photo' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Horizontal 1/ })) // m2
    expect(placePhotoMock).toHaveBeenCalledWith('artist-1', 'm2', 'horizontal')
  })

  it('Edit opens the full-panel editor; Remove takes the photo off the site (never deletes)', () => {
    openImages()
    fireEvent.click(screen.getByRole('button', { name: 'Edit horizontal photo 1' }))
    // The whole panel is now the item editor, headed "Edit <label>".
    expect(screen.getByRole('heading', { name: 'Edit Horizontal 1' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(setOnSiteMock).toHaveBeenCalledWith('photo', 'm1', 'artist-1', false)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('a legacy null-orientation on-site photo stays MANAGEABLE (shows in Horizontal, not vanished)', () => {
    // Regression: an untagged photo (legacy row / Drive import) that's live on the site
    // must not disappear from the editor. It belongs to the Horizontal group until placed.
    renderInspector([
      { id: 'mnull', storage_path: 'artist-1/gallery/legacy.jpg', onSite: true, orientation: null, siteRole: null },
    ])
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    const imgs = Array.from(document.querySelectorAll('aside img')) as HTMLImageElement[]
    expect(imgs.some((i) => i.src.includes('legacy.jpg'))).toBe(true)
    expect(screen.getByRole('button', { name: 'Edit horizontal photo 1' })).toBeTruthy()
  })

  it('Edit → Replace swaps within the group (old off, new placed)', () => {
    openImages()
    fireEvent.click(screen.getByRole('button', { name: 'Edit horizontal photo 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    // The item editor's picker labels candidates by filename (m2 = h-lib.jpg).
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /h-lib\.jpg/ }))
    expect(setOnSiteMock).toHaveBeenCalledWith('photo', 'm1', 'artist-1', false) // old off
    expect(placePhotoMock).toHaveBeenCalledWith('artist-1', 'm2', 'horizontal') // new placed
  })

  it('uploading a horizontal photo adds it to the horizontal library (no placement)', () => {
    openImages()
    fireEvent.click(screen.getByRole('button', { name: 'Add horizontal photo' }))
    // Only m2 to start (Horizontal 1); no second horizontal candidate yet.
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /Horizontal 2/ })).toBeNull()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'upload horizontal photo' }))
    // The uploaded horizontal photo joins the horizontal library; nothing is placed.
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /Horizontal 2/ })).toBeTruthy()
    expect(placePhotoMock).not.toHaveBeenCalled()
    expect(setOnSiteMock).not.toHaveBeenCalled()
  })

  it('returns to the grid via the Close X', () => {
    openImages()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    // Back on the grid home — every component is a tile again.
    expect(screen.getByRole('button', { name: 'Images' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Music' })).toBeTruthy()
  })

  it('KEEPS the bottom switcher strip AND offers the Close X (Sam, 2026-08-12: only the landing view changed)', () => {
    openImages()
    const strip = screen.getByRole('button', { name: 'Images' })
    expect(strip.getAttribute('aria-current')).toBe('true')
    expect(within(document.body).getByRole('button', { name: 'Videos' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })
})

describe('EditorInspector — Images: image fields + two-way highlight', () => {
  const IMAGE_FIELDS: EditorImageField[] = [
    { key: 'hero_image', label: 'Hero image', previewUrl: 'https://cdn/hero.jpg', target: { store: 'artist', column: 'hero_image_url' } },
    { key: 'profile_photo', label: 'Profile photo', previewUrl: null, target: { store: 'media', purpose: 'profile_photo' } },
  ]
  const openImages = () => fireEvent.click(screen.getByRole('button', { name: /Images/ }))

  it('surfaces every declared image field under "Set slots" — filled shows the image, empty shows Add', () => {
    renderInspector([], { imageFields: IMAGE_FIELDS, showGallery: false })
    openImages()
    expect(screen.getByText('Set slots')).toBeTruthy()
    // hero has a value → a selectable tile; profile is empty → an Add drop target.
    expect(screen.getByRole('button', { name: 'Select Hero image' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Profile photo' })).toBeTruthy()
  })

  it('clicking an image tile highlights that exact region in the live frame', () => {
    const onHighlight = vi.fn()
    renderInspector([], { imageFields: IMAGE_FIELDS, showGallery: false, onHighlight })
    openImages()
    fireEvent.click(screen.getByRole('button', { name: 'Select Hero image' }))
    expect(onHighlight).toHaveBeenCalledWith({ kind: 'field', key: 'hero_image' })
  })

  it('a frame click on an image region opens Images, rings the tile, and re-outlines it', () => {
    const onHighlight = vi.fn()
    renderInspector([], {
      imageFields: IMAGE_FIELDS,
      showGallery: false,
      selectedRegion: { target: { kind: 'field', key: 'hero_image' }, nonce: 1 },
      onHighlight,
    })
    // Images opened itself (no click needed), and the hero tile is the focused one.
    const tile = screen.getByRole('button', { name: 'Select Hero image' })
    expect(tile.getAttribute('aria-pressed')).toBe('true')
    expect(onHighlight).toHaveBeenCalledWith({ kind: 'field', key: 'hero_image' })
  })

  it('a frame click on a NON-image region (a text heading) does NOT hijack the panel to Images', () => {
    // Until 2026-08-06 this asserted the select was dropped entirely; text-field selects
    // now route to the TEXT panel (Sam: "when I select the TOUR text, that text should
    // be selected in the left panel" — editor-select-routing.test.tsx pins that side).
    // The guard THIS test keeps is the original one: Images must not steal it.
    renderInspector([], {
      imageFields: IMAGE_FIELDS,
      textFields: TEXT_FIELDS,
      selectedRegion: { target: { kind: 'field', key: 'hero_tagline' }, nonce: 1 },
    })
    expect(screen.queryByText('Set slots')).toBeNull() // not the Images panel
    expect(screen.getByRole('heading', { name: /Edit/ })).toBeTruthy() // the text editor
  })

  it('a gallery photo card is selectable and rings when it is the focused region', () => {
    renderInspector(PHOTOS, {
      showGallery: true,
      selectedRegion: { target: { kind: 'item', assetType: 'image', id: 'm1' }, nonce: 1 },
    })
    // m1 (on-site horizontal) is the focused gallery card.
    const card = screen.getByRole('button', { name: 'Select horizontal photo 1' })
    expect(card.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('EditorInspector — Text component', () => {
  it('CRITICAL: an unset field opens holding the site’s OWN words, editable', () => {
    // Sam, 2026-08-09, on throwaway #1: "for the text, I want there to be actual text
    // here not just the placeholder text." The site's fallback was the input's
    // PLACEHOLDER, which looks right and cannot be edited: changing one word of a
    // sentence already on the page meant retyping the whole sentence from memory.
    //
    // Seeded, not saved. Opening a field must not write a row the manager never typed —
    // that would make "unset" unreachable and stamp defaults across the site by browsing.
    renderInspector([], {
      textFields: [{ key: 'hero_tagline', label: 'Hero tagline', type: 'text', value: '', multiline: false, defaultValue: 'Songs from the flood year' }],
    })
    fireEvent.click(screen.getByRole('button', { name: /Text/ }))
    fireEvent.click(screen.getByLabelText('Edit Hero tagline'))
    const input = screen.getByLabelText('Hero tagline') as HTMLInputElement
    expect(input.value).toBe('Songs from the flood year')
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('a seeded field can still be CLEARED — the site falls back on its own', () => {
    // The seed must behave like typed text, or clearing it would snap straight back and
    // the manager could never empty a field.
    renderInspector([], {
      textFields: [{ key: 'hero_tagline', label: 'Hero tagline', type: 'text', value: '', multiline: false, defaultValue: 'Songs from the flood year' }],
    })
    fireEvent.click(screen.getByRole('button', { name: /Text/ }))
    fireEvent.click(screen.getByLabelText('Edit Hero tagline'))
    const input = screen.getByLabelText('Hero tagline') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')
  })

  it('edits a field: optimistic live-preview immediately, debounced save', () => {
    vi.useFakeTimers()
    try {
      const onApply = vi.fn()
      renderInspector([], { textFields: TEXT_FIELDS, onApplyField: onApply })
      fireEvent.click(screen.getByRole('button', { name: /Text/ }))

      // The list is read-only; Edit opens the field full-panel, which is where it is
      // typed. Going through the button exercises the flow a manager actually has.
      fireEvent.click(screen.getByLabelText('Edit Hero tagline'))
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
  // Rows show label + URL as plain text; the inputs mount only once the pencil opens
  // the row (version A, 2026-08-12). Open by the row index (1-based).
  function expandLink(n: number) {
    fireEvent.click(screen.getByRole('button', { name: `Edit social link ${n}` }))
  }
  /** The same button, which reads "Close …" once the row is open (2026-08-14). */
  function collapseLink(n: number) {
    fireEvent.click(screen.getByRole('button', { name: `Close social link ${n}` }))
  }

  it('CRITICAL: Add opens a MODAL — the editor session is never navigated away', () => {
    // Sam, 2026-08-09: "when they hit the add social button, a modal should come up
    // instead of redirecting the user to another page. They should stay on the editor
    // page." The footer was a <Link> to /artists/[id]/links, which discarded the frame,
    // the scroll position and the open panel to type one URL. An anchor with an href is
    // the failure — assert on the ROLE, since a button cannot navigate.
    openLinks()
    const add = screen.getByRole('button', { name: /Add social/i })
    expect(add.getAttribute('href')).toBeNull()
    fireEvent.click(add)
    expect(screen.getByRole('dialog', { name: /Add a social link/i })).toBeTruthy()
  })

  it('CRITICAL: the modal offers the shared platform list, so the label is one a site knows', () => {
    // The label IS the join key a connected site maps its icon by (`item:link:instagram`).
    // Free text lands "insta" in the payload and renders as an unrecognized link, so the
    // picker exists to make the recognizable spelling the easy path.
    openLinks()
    fireEvent.click(screen.getByRole('button', { name: /Add social/i }))
    // Addable platforms are plain tiles; Instagram is already on the fixture, so its
    // tile is the disabled "(already added)" form. (Before version A this line matched
    // the collapsed ROW button named "Instagram" by accident — the row is plain text now.)
    for (const label of ['TikTok', 'Substack']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: /Instagram \(already added\)/i })).toBeTruthy()
    // …and NOTHING else. The vocabulary is closed (Sam, 2026-08-10): a free-text escape
    // hatch produced a label no site can map to a mark, which rendered as raw text in a
    // row of glyphs. `createContent` refuses one on the write side too, so this is the
    // affordance rather than the enforcement.
    expect(screen.queryByRole('button', { name: /Something else/i })).toBeNull()
    expect(screen.queryByLabelText('Link name')).toBeNull()
  })

  it('a platform already on the site cannot be added twice', () => {
    // LINKS carries Spotify and Instagram. A second Instagram row renders a second
    // identical icon in the socials row, which the manager cannot tell apart.
    openLinks()
    fireEvent.click(screen.getByRole('button', { name: /Add social/i }))
    expect((screen.getByRole('button', { name: /Instagram \(already added\)/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'TikTok' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('picking a platform prefills its URL, and adding writes ONE link row', async () => {
    openLinks()
    fireEvent.click(screen.getByRole('button', { name: /Add social/i }))
    fireEvent.click(screen.getByRole('button', { name: 'TikTok' }))
    const url = screen.getByLabelText('Link URL') as HTMLInputElement
    expect(url.value).toBe('https://tiktok.com/@')

    fireEvent.change(url, { target: { value: 'https://tiktok.com/@juniper' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add to the site/i }))
    })
    expect(addContentMock).toHaveBeenCalledTimes(1)
    const [entity, artistId, fd] = addContentMock.mock.calls[0]
    expect(entity).toBe('link')
    expect(artistId).toBe('artist-1')
    expect((fd as FormData).get('label')).toBe('TikTok')
    expect((fd as FormData).get('url')).toBe('https://tiktok.com/@juniper')
  })

  it('CRITICAL: two fast clicks add ONE link, not two', () => {
    // AGENTS.md rule 5: the latch is a REF. `disabled={saving}` only applies after React
    // re-renders, and both clicks read pre-render state — so a state-only guard inserted
    // the social twice (2026-08-09 review, verified at two onAdd calls).
    //
    // BOTH clicks are dispatched inside ONE act() batch. Dispatching them separately
    // pins nothing: after the first, React has already disabled the button and the second
    // click never fires.
    openLinks()
    fireEvent.click(screen.getByRole('button', { name: /Add social/i }))
    fireEvent.click(screen.getByRole('button', { name: 'TikTok' }))
    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://tiktok.com/@juniper' } })
    const add = screen.getByRole('button', { name: /Add to the site/i })
    act(() => {
      fireEvent.click(add)
      fireEvent.click(add)
    })
    expect(addContentMock).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: the prefilled platform root alone is not a link', () => {
    // Picking Substack fills the box with `https://substack.com/@`. That is non-empty,
    // so the blank check waved it through and a social pointing at the platform's front
    // page shipped to the site (2026-08-09 review). (Substack, not Instagram: the
    // fixture already carries Instagram, so its tile is disabled and never opens.)
    openLinks()
    fireEvent.click(screen.getByRole('button', { name: /Add social/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Substack' }))
    fireEvent.click(screen.getByRole('button', { name: /Add to the site/i }))
    expect(addContentMock).not.toHaveBeenCalled()
    expect(screen.getByText(/just the site’s address/i)).toBeTruthy()
  })

  it('shows label + URL as plain text; the pencil opens the editor', () => {
    openLinks()
    // Plain text: the label and its URL show, no inputs yet.
    expect(screen.getByText('Spotify')).toBeTruthy()
    expect(screen.getByText('https://open.spotify.com/x')).toBeTruthy()
    expect(screen.queryByLabelText('Social link 1 URL')).toBeNull()
    // Pencil → the edit box. A social has NO label field (2026-08-12): the platform is
    // inferred from the URL, so only the URL + on-site + remove show.
    expandLink(1)
    expect((screen.getByLabelText('Social link 1 URL') as HTMLInputElement).value).toBe('https://open.spotify.com/x')
    expect(screen.queryByLabelText('Social link 1 label')).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove social link 1' })).toBeTruthy()
  })

  it('is single-open: expanding another row collapses the first', () => {
    openLinks()
    expandLink(1)
    expect(screen.queryByLabelText('Social link 1 URL')).not.toBeNull()
    expandLink(2)
    // Spotify's editor is gone; Instagram's is open.
    expect(screen.queryByLabelText('Social link 1 URL')).toBeNull()
    expect((screen.getByLabelText('Social link 2 URL') as HTMLInputElement).value).toBe('https://instagram.com/x')
  })

  it('flags an off-site link with an "Off" tag on the row', () => {
    openLinks()
    // l3 (Bandcamp) is the only off-site link; exactly one "Off" tag shows.
    expect(screen.getByText('Bandcamp')).toBeTruthy()
    expect(screen.getAllByText('Off')).toHaveLength(1)
  })

  it('the add affordance stays IN the editor (was a link out until 2026-08-09)', () => {
    // This pinned `<Link href="/artists/artist-1/links">` — leaving the editor to add a
    // URL. Sam: "they should stay on the editor page." Rewritten rather than deleted, so
    // the regression it guards against is still named: no anchor, and no navigation.
    openLinks()
    expect(screen.queryByRole('link', { name: /Add (link|social)/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Add social/ })).toBeTruthy()
  })

  it('takes an on-site link OFF the site (writes on_site via setOnSiteAction)', () => {
    openLinks()
    expandLink(1) // l1 (Spotify) is on-site → its toggle offers to take it off.
    fireEvent.click(screen.getByRole('button', { name: /On the site/ }))
    expect(setOnSiteMock).toHaveBeenCalledWith('link', 'l1', 'artist-1', false)
  })

  it('puts an off-site link back ON the site', () => {
    openLinks()
    expandLink(3) // l3 (Bandcamp) is the only off-site link.
    fireEvent.click(screen.getByRole('button', { name: /Off the site/ }))
    expect(setOnSiteMock).toHaveBeenCalledWith('link', 'l3', 'artist-1', true)
  })

  it('does NOT save a blank required field and flags it invalid (no false "Saved")', () => {
    vi.useFakeTimers()
    try {
      openLinks()
      expandLink(1)
      fireEvent.change(screen.getByLabelText('Social link 1 URL'), { target: { value: '' } })
      vi.advanceTimersByTime(500)
      expect(updateContentMock).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Social link 1 URL').getAttribute('aria-invalid')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('CRITICAL: editing the URL infers the platform label, debounced-saves both', () => {
    // Sam, 2026-08-12: "the tool should pick up the type of button based on the url."
    // Change Spotify's URL to a TikTok one → the label (and so the icon) becomes TikTok.
    vi.useFakeTimers()
    try {
      openLinks()
      expandLink(1)
      fireEvent.change(screen.getByLabelText('Social link 1 URL'), { target: { value: 'https://tiktok.com/@juniper' } })
      expect(updateContentMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      expect(updateContentMock).toHaveBeenCalledTimes(1)
      const [type, id, artistId, fd] = updateContentMock.mock.calls[0]
      expect([type, id, artistId]).toEqual(['link', 'l1', 'artist-1'])
      expect((fd as FormData).get('label')).toBe('TikTok')
      expect((fd as FormData).get('url')).toBe('https://tiktok.com/@juniper')
    } finally {
      vi.useRealTimers()
    }
  })

  it('CRITICAL: an UNKNOWN host keeps the existing label — inference never blanks it', () => {
    // A URL that matches no platform (a personal site) has no icon to infer, so the row
    // must keep whatever name it had. The false branch of the inference was untested; a
    // mutant blanking the label survived the whole suite.
    vi.useFakeTimers()
    try {
      openLinks()
      expandLink(1) // Spotify
      fireEvent.change(screen.getByLabelText('Social link 1 URL'), { target: { value: 'https://juniperhale.com' } })
      vi.advanceTimersByTime(500)
      const fd = updateContentMock.mock.calls.at(-1)![3] as FormData
      expect(fd.get('label')).toBe('Spotify') // kept, not blanked
      expect(fd.get('url')).toBe('https://juniperhale.com')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reflects an edited label on the collapsed row', () => {
    vi.useFakeTimers()
    try {
      openLinks()
      expandLink(1)
      fireEvent.change(screen.getByLabelText('Social link 1 URL'), { target: { value: 'https://tiktok.com/@juniper' } })
      // Close the box; the row's name is the platform inferred from the new URL.
      collapseLink(1)
      expect(screen.queryByLabelText('Social link 1 URL')).toBeNull()
      expect(screen.getByText('TikTok')).toBeTruthy()
      expect(screen.queryByText('Spotify')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('CRITICAL: clicking outside an open social row closes it too', () => {
    // The same rule as the Style panel (Sam, 2026-08-14). Pinned per PANEL because the
    // boundary ref is wired per panel — Style passing is no evidence Links does.
    openLinks()
    expandLink(1)
    expect(screen.getByLabelText('Social link 1 URL')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByLabelText('Social link 1 URL')).toBeNull()
  })

  it('typing in an open social row never closes it', () => {
    // The field lives inside the boundary; a mousedown to focus it must not collapse
    // the row out from under the cursor.
    openLinks()
    expandLink(1)
    fireEvent.mouseDown(screen.getByLabelText('Social link 1 URL'))
    expect(screen.getByLabelText('Social link 1 URL')).toBeTruthy()
    // WITNESS: prove the listener is actually armed. Without this, an unattached
    // boundary ref makes the assertion above vacuously true — nothing would close the
    // row, so "it stayed open" would prove nothing at all.
    fireEvent.mouseDown(document.body)
    expect(screen.queryByLabelText('Social link 1 URL')).toBeNull()
  })

  it('CRITICAL: a preview click on dead space closes an open social row too', () => {
    // Pinned per PANEL: the collapse tick is threaded independently to each list, so
    // Style passing proves nothing about Links (the same reason as the outside-click).
    const view = renderInspector([], { links: LINKS, deselectedAt: 1 })
    fireEvent.click(screen.getByRole('button', { name: /Links/ }))
    expandLink(1)
    expect(screen.getByLabelText('Social link 1 URL')).toBeTruthy()
    view.rerender(inspector([], { links: LINKS, deselectedAt: 2 }))
    expect(screen.queryByLabelText('Social link 1 URL')).toBeNull()
  })

  it('removes a link optimistically via deleteContentAction', () => {
    openLinks()
    expandLink(1)
    fireEvent.click(screen.getByRole('button', { name: 'Remove social link 1' }))
    expect(deleteContentMock).toHaveBeenCalledWith('link', 'l1', 'artist-1')
    expect(screen.queryByText('Spotify')).toBeNull()
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

describe('EditorInspector — Links panel groups (socials + tour support)', () => {
  function openLinks(opts: { links?: EditorLink[]; supportLinks?: EditorSupportLink[] } = {}) {
    renderInspector([], { links: opts.links ?? LINKS, supportLinks: opts.supportLinks ?? SUPPORT })
    fireEvent.click(screen.getByRole('button', { name: /Links/ }))
  }

  it('groups the panel into "Socials" and "Buttons" — tour support has MOVED', () => {
    // Support-act links lived here as a flat list across every date, each row captioned
    // with the show it belonged to. They moved into the Tour panel's per-date editor
    // (Sam, 2026-08-09), where the act names already are. Asserting their ABSENCE keeps
    // the move honest: a stray re-add would put the same fact in two places.
    openLinks()
    expect(screen.getByText('Socials')).toBeTruthy()
    expect(screen.queryByText('Tour support')).toBeNull()
    expect(screen.queryByLabelText(/Link for Gudfella/)).toBeNull()
  })

  it('a BARE-email link routes to Contact too — the add rule and the grouping agree', () => {
    // 2026-08-10 review. linkAddError exempts bare addresses (skeen's live booking row
    // has one), but the grouping only knew the mailto:/tel: SCHEMES — so a bare-email
    // row was allowed in and then filed under Socials, which every site filters to
    // icons it can draw. Allowed in and rendered nowhere is the worst of both rules.
    const bare: EditorLink = { id: 'l8', label: 'Booking email', url: 'ross@everesttm.com', onSite: true }
    openLinks({ links: [...LINKS, bare] })
    expect(screen.getByText('Contact')).toBeTruthy()
    const headings = [...document.querySelectorAll('aside span')]
      .map((sp) => sp.textContent)
      .filter((t) => t === 'Socials' || t === 'Contact')
    expect(headings).toEqual(['Socials', 'Contact'])
  })

  it('routes a mailto:/tel: link out of Socials into its own "Contact" group', () => {
    const booking: EditorLink = { id: 'l9', label: 'Bookings', url: 'mailto:b@x.com', onSite: true }
    openLinks({ links: [...LINKS, booking] })
    expect(screen.getByText('Contact')).toBeTruthy()
    // The Contact group renders AFTER Socials, and holds only the booking row.
    const headings = [...document.querySelectorAll('aside span')]
      .map((s) => s.textContent)
      .filter((t) => t === 'Socials' || t === 'Contact')
    expect(headings).toEqual(['Socials', 'Contact'])
    // One add affordance for the whole panel, not one per group.
    // ONE add affordance per panel, not one per group — Contact is a slice of the
    // same list. (A button since 2026-08-09; it opens the modal in place.)
    expect(screen.getAllByRole('button', { name: /Add social/ }).length).toBe(1)
  })

  it('gives Socials and Contact rows DISTINCT accessible names', () => {
    // Row labels are numbered per-list, and the panel renders LinkTools twice — so
    // an unprefixed "Link 1 label" existed twice in the DOM once a booking link
    // appeared, which is ambiguous to a screen reader and to getByLabelText.
    const booking: EditorLink = { id: 'l9', label: 'Bookings', url: 'mailto:b@x.com', onSite: true }
    openLinks({ links: [...LINKS, booking] })
    fireEvent.click(screen.getByRole('button', { name: 'Edit social link 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit contact link 1' }))
    // Both rows are open at once; each name must resolve to exactly one element. A
    // social has only its URL (label inferred); a CONTACT keeps its manager-set label.
    expect(screen.getByLabelText('Social link 1 URL')).toBeTruthy()
    expect(screen.queryByLabelText('Social link 1 label')).toBeNull()
    expect(screen.getByLabelText('Contact link 1 label')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove social link 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove contact link 1' })).toBeTruthy()
  })

  it('shows NO Contact group when every link is a plain profile URL', () => {
    openLinks()
    expect(screen.queryByText('Contact')).toBeNull()
  })

  it('reorders by ID, so a drag in one group cannot scramble the other', () => {
    // The panel renders links in two lists; a row's index within its own list is not
    // its index in the full array. Dragging row 0 onto row 1 of SOCIALS must move l1
    // past l2 and leave the booking link where it is.
    const booking: EditorLink = { id: 'l9', label: 'Bookings', url: 'mailto:b@x.com', onSite: true }
    openLinks({ links: [...LINKS, booking] })
    const rows = document.querySelectorAll('aside div[draggable="true"]')
    expect(rows.length).toBe(4) // 3 socials + 1 contact
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[1])
    expect(reorderContentMock).toHaveBeenCalledWith('link', 'artist-1', ['l2', 'l1', 'l3', 'l9'])
  })
})

describe('EditorInspector — Buttons group inside the Links panel (manifest-declared)', () => {
  const LINK_REGIONS: ManifestLinkRegion[] = [
    { key: 'usb', label: 'USB button', description: 'Disco-ball playlist link (Videos band)' },
    { key: 'merch', label: 'Merch button', description: 'Store link in the top nav' },
  ]
  function openSiteLinks(opts: { linkValues?: Record<string, string>; onApplyLink?: (k: string, u: string) => void } = {}) {
    renderInspector([], { linkRegions: LINK_REGIONS, linkValues: opts.linkValues, onApplyLink: opts.onApplyLink })
    // One Links panel now holds Socials + Tour support + Buttons.
    fireEvent.click(screen.getByRole('button', { name: /Links/ }))
  }

  it('shows the Buttons group alongside Socials in one panel', () => {
    openSiteLinks()
    expect(screen.getByText('Socials')).toBeTruthy()
    expect(screen.getByText('Buttons')).toBeTruthy()
  })

  it('lists each declared button by label, with a URL field each', () => {
    openSiteLinks({ linkValues: { usb: 'https://open.spotify.com/playlist/usb' } })
    // The label alone names the button. A "Powers: …" line under it restated the label
    // in a longer sentence and pushed every input down a row (Sam, 2026-08-09); the
    // site's description rides the label's hover text instead of costing a row.
    // The URL is PLAIN TEXT until the pencil opens the box (Sam, 2026-08-12): the
    // value shows on the row, no input yet.
    expect(screen.getByText('USB button')).toBeTruthy()
    expect(screen.getByText('https://open.spotify.com/playlist/usb')).toBeTruthy()
    expect(screen.queryByLabelText('USB button URL')).toBeNull()
    // Merch is declared but UNSET → a visible, muted "Add a link" row (not invisible).
    expect(screen.getByText('Add a link')).toBeTruthy()
    // Open USB's box: now the input exists, seeded, with the site's description attached.
    fireEvent.click(screen.getByRole('button', { name: 'Edit USB button' }))
    const input = screen.getByLabelText('USB button URL') as HTMLInputElement
    expect(input.value).toBe('https://open.spotify.com/playlist/usb')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('Disco-ball playlist link (Videos band)')
  })

  it('debounce-saves a URL by key + optimistically updates the frame', () => {
    vi.useFakeTimers()
    try {
      const onApplyLink = vi.fn()
      openSiteLinks({ onApplyLink })
      fireEvent.click(screen.getByRole('button', { name: 'Edit USB button' }))
      fireEvent.change(screen.getByLabelText('USB button URL'), { target: { value: 'https://open.spotify.com/playlist/x' } })
      // Optimistic frame repaint is immediate; the save is debounced.
      expect(onApplyLink).toHaveBeenCalledWith('usb', 'https://open.spotify.com/playlist/x')
      expect(saveLinkMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      expect(saveLinkMock).toHaveBeenCalledWith('artist-1', 'usb', 'https://open.spotify.com/playlist/x', 'USB button')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does NOT save an unsafe URL and flags the field invalid', () => {
    vi.useFakeTimers()
    try {
      openSiteLinks()
      fireEvent.click(screen.getByRole('button', { name: 'Edit USB button' }))
      fireEvent.change(screen.getByLabelText('USB button URL'), { target: { value: 'javascript:alert(1)' } })
      vi.advanceTimersByTime(500)
      expect(saveLinkMock).not.toHaveBeenCalled()
      expect(screen.getByLabelText('USB button URL').getAttribute('aria-invalid')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows an empty-state under Buttons when the site declares none', () => {
    renderInspector([], { linkRegions: [] })
    fireEvent.click(screen.getByRole('button', { name: /Links/ }))
    expect(screen.getByText('Buttons')).toBeTruthy()
    // The brief "no slots" line — not an add button (nothing to place without a slot).
    expect(screen.getByText(/no link slots/i)).toBeTruthy()
  })
})

const SKEEN_VIDEO_SLOTS = [
  { kind: 'hero', role: 'hero_landscape', label: 'Landscape · desktop', group: 'Landing page' },
  { kind: 'hero', role: 'hero_portrait', label: 'Portrait · mobile', group: 'Landing page' },
  { kind: 'hero', role: 'bio_background', label: 'Bio background', group: 'Bio background' },
  { kind: 'band', count: 2, label: 'Video slot', group: 'Videos band' },
] as import('@/lib/site-editor/manifest').ManifestVideoSlot[]

describe('EditorInspector — Videos component', () => {
  function openVideos() {
    renderInspector([], { videos: VIDEOS })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
  }

  it("CRITICAL: a site that declares NO video slots shows none — no inherited skeen slots", () => {
    // The whole point of phase 4 (Sam, 2026-08-12): Juniper has no video and must not
    // show skeen's Landing page / Videos band slots. With videoSlots: [] the panel is
    // empty — no group headings, no band inputs.
    renderInspector([], { videos: VIDEOS, videoSlots: [] })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
    expect(screen.queryByText('Landing page')).toBeNull()
    expect(screen.queryByText('Videos band')).toBeNull()
    expect(screen.queryByLabelText('Slot 1 title')).toBeNull()
    // …and the brief "no slots" line stands in for the (absent) add affordances.
    expect(screen.getByText(/no video slots/i)).toBeTruthy()
  })

  it('renders exactly the DECLARED slots — a band of 1 shows one slot, not two', () => {
    renderInspector([], {
      videos: VIDEOS,
      videoSlots: [{ kind: 'band', count: 1, label: 'Video slot', group: 'Clips' }],
    })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
    expect(screen.getByText('Clips')).toBeTruthy()
    expect(screen.queryByText('Landing page')).toBeNull() // not declared → not shown
    expect(screen.getByLabelText('Slot 1 title')).toBeTruthy()
  })

  it('shows the on-site videos as filled band slots with an editable title', () => {
    // v2 is the only on-site video → the one filled slot; v1/v3 are library.
    openVideos()
    expect((screen.getByLabelText('Slot 1 title') as HTMLInputElement).value).toBe('Studio session')
  })

  it('renames a slotted video with a debounced save', () => {
    vi.useFakeTimers()
    try {
      openVideos()
      fireEvent.change(screen.getByLabelText('Slot 1 title'), { target: { value: 'Studio cut' } })
      expect(renameVideoMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      expect(renameVideoMock).toHaveBeenCalledWith('v2', 'artist-1', 'Studio cut')
    } finally {
      vi.useRealTimers()
    }
  })

  it('band Edit → Remove marks the video off-site, never deletes it', () => {
    openVideos()
    fireEvent.click(screen.getByRole('button', { name: /Edit video slot 1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(setOnSiteMock).toHaveBeenCalledWith('video', 'v2', 'artist-1', false)
    expect(deleteContentMock).not.toHaveBeenCalled()
  })

  it('band Edit → Replace opens the picker WITHOUT removing the video yet', () => {
    openVideos()
    fireEvent.click(screen.getByRole('button', { name: /Edit video slot 1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    // The picker opens, but v2 is NOT taken off — it only leaves when a replacement
    // is actually chosen, so closing the picker would keep it in place.
    expect(screen.getByText(/Pick from your library/)).toBeTruthy()
    expect(setOnSiteMock).not.toHaveBeenCalled()
  })

  it('band Replace + cancel keeps the original video on-site', () => {
    openVideos()
    fireEvent.click(screen.getByRole('button', { name: /Edit video slot 1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    // Nothing removed, nothing added.
    expect(setOnSiteMock).not.toHaveBeenCalled()
  })

  it('band Replace + pick swaps: old goes off-site, new goes on', () => {
    openVideos()
    fireEvent.click(screen.getByRole('button', { name: /Edit video slot 1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    fireEvent.click(screen.getByRole('button', { name: /Live at the Mohawk/ }))
    expect(setOnSiteMock).toHaveBeenCalledWith('video', 'v2', 'artist-1', false) // old off
    expect(setOnSiteMock).toHaveBeenCalledWith('video', 'v1', 'artist-1', true) // new on
  })

  it('CRITICAL: places a library video into a band slot from the picker (writes on_site)', () => {
    openVideos()
    // v2 fills band slot 1, so slot 2 is an empty "Pick a YouTube video" tile.
    fireEvent.click(screen.getByRole('button', { name: /Pick a YouTube video/ }))
    // The picker offers only OFF-site YouTube library (v1, v3), not the slotted v2
    // (exact match, so the slot's "Remove Studio session…" button doesn't count).
    expect(screen.queryByRole('button', { name: 'Studio session' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Live at the Mohawk/ }))
    expect(setOnSiteMock).toHaveBeenCalledWith('video', 'v1', 'artist-1', true)
  })

  it('points at the Videos page when the band library is empty', () => {
    renderInspector([], { videos: [yt({ id: 'v2', title: 'Studio session', poster: null, onSite: true })] })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /Pick a YouTube video/ })[0])
    expect(screen.getByRole('link', { name: /Add a video first/ }).getAttribute('href')).toBe('/artists/artist-1/videos')
  })

  it('shows the background slots (landscape + portrait + bio) as pickers, not uploads', () => {
    openVideos()
    expect(screen.getByText(/Landscape/)).toBeTruthy()
    expect(screen.getByText(/Portrait/)).toBeTruthy()
    expect(screen.getAllByText(/Bio background/).length).toBeGreaterThan(0)
    // No uploaded videos in the fixture → all three background slots are empty "Pick a
    // video" tiles, and there is NO file uploader (mock-upload) — they pick from assets.
    expect(screen.getAllByRole('button', { name: 'Pick a video' })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'mock-upload' })).toBeNull()
  })

  it('CRITICAL: places an uploaded video into the hero slot (assignHeroSlotAction, not on_site)', () => {
    const withUploaded: EditorVideo[] = [
      ...VIDEOS,
      { id: 'up', title: 'Landing Page (H)', provider: 'uploaded', isShort: false, siteRole: null, previewUrl: 'https://x/up.mp4#t=0.1', poster: null, onSite: false },
    ]
    renderInspector([], { videos: withUploaded })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick a video' })[0]) // landscape slot
    // The hero picker offers UPLOADED videos, not the YouTube band ones.
    expect(screen.queryByRole('button', { name: /Live at the Mohawk/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Landing Page/ }))
    expect(assignHeroMock).toHaveBeenCalledWith('artist-1', 'hero_landscape', 'up')
    // OPTIMISTIC: the slot fills right away (no refresh) — the bug was it stayed empty.
    expect(screen.getByText('Landing Page (H)')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Edit the Landscape/ })).toBeTruthy()
  })

  it('shows a placed hero video with a preview, and Edit → Remove clears the slot', () => {
    const placed: EditorVideo[] = [
      { id: 'up', title: 'Landing Page (H)', provider: 'uploaded', isShort: false, siteRole: 'hero_landscape', previewUrl: 'https://x/up.mp4#t=0.1', poster: null, onSite: true },
    ]
    const { container } = renderInspector([], { videos: placed })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
    expect(screen.getByText('Landing Page (H)')).toBeTruthy()
    // Preview thumbnail is a <video> seeked to the first frame.
    expect(container.querySelector('video')?.getAttribute('src')).toBe('https://x/up.mp4#t=0.1')
    // Edit opens the Replace/Remove menu; Remove clears the slot.
    fireEvent.click(screen.getByRole('button', { name: /Edit the Landscape/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(assignHeroMock).toHaveBeenCalledWith('artist-1', 'hero_landscape', null)
  })

  it('keeps uploaded videos and Shorts out of the YouTube band', () => {
    const mixed: EditorVideo[] = [
      yt({ id: 'y', title: 'A YouTube video', poster: null, onSite: true }),
      { id: 'u', title: 'Uploaded clip', provider: 'uploaded', isShort: false, siteRole: null, previewUrl: 'https://x/u.mp4#t=0.1', poster: null, onSite: true },
      { id: 's', title: 'A Short', provider: 'youtube', isShort: true, siteRole: null, previewUrl: null, poster: null, onSite: true },
    ]
    renderInspector([], { videos: mixed })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
    // Slot 1 filled by the YouTube video; slot 2 is an empty picker (uploaded + Short excluded).
    expect(screen.getByLabelText('Slot 1 title')).toBeTruthy()
    expect(screen.queryByLabelText('Slot 2 title')).toBeNull()
    expect(screen.getByRole('button', { name: /Pick a YouTube video/ })).toBeTruthy()
  })

  it('band Edit opens the full-panel item editor with the EMBED control set', () => {
    openVideos()
    fireEvent.click(screen.getByRole('button', { name: /Edit video slot 1/ }))
    expect(screen.getByRole('heading', { name: 'Edit Video slot 1' })).toBeTruthy()
    // Videos get their own vocabulary: no borders (Sam, 2026-08-03), and no Speed on an
    // embed — an iframe's playback can't be touched from outside.
    for (const control of ['Size', 'Transparency', 'Corners', 'Shadow']) {
      expect(screen.getByLabelText(`Video slot 1 ${control}`)).toBeTruthy()
    }
    expect(screen.queryByLabelText('Video slot 1 Border')).toBeNull()
    expect(screen.queryByLabelText('Video slot 1 Border color palette')).toBeNull()
    expect(screen.queryByLabelText('Video slot 1 Speed')).toBeNull()
  })

  it('styles a band video under its own per-item key (video:<id>), persisted on Save', async () => {
    const onApplyStyle = vi.fn()
    renderInspector([], { videos: VIDEOS, onApplyStyle })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
    fireEvent.click(screen.getByRole('button', { name: /Edit video slot 1/ }))
    // Size slider index 17 = scale-110 on the widened 25–175% ladder (2026-08-11).
    fireEvent.change(screen.getByLabelText('Video slot 1 Size'), { target: { value: '17' } })
    expect(onApplyStyle).toHaveBeenCalledWith('video:v2', 'scale-110')
    expect(saveStyleMock).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(saveStyleMock).toHaveBeenCalledWith('artist-1', 'video:v2', 'scale-110')
  })

  it('an uploaded background slot gets the FILE set: Speed saves under slot:<role>', async () => {
    const onApplyStyle = vi.fn()
    const placed: EditorVideo[] = [
      { id: 'up', title: 'Landing Page (H)', provider: 'uploaded', isShort: false, siteRole: 'hero_landscape', previewUrl: 'https://x/up.mp4#t=0.1', poster: null, onSite: true },
    ]
    renderInspector([], { videos: placed, onApplyStyle })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
    fireEvent.click(screen.getByRole('button', { name: /Edit the Landscape/ }))
    // The file set is Speed + Transparency — a full-bleed background has nothing
    // visible for size/corners/shadow to act on.
    expect(screen.getByLabelText('Landscape · desktop Transparency')).toBeTruthy()
    expect(screen.queryByLabelText('Landscape · desktop Size')).toBeNull()
    expect(screen.queryByLabelText('Landscape · desktop Border')).toBeNull()
    // Speed slider: index 5 of [0.25, 0.5, 0.75, Normal, 1.25, 1.5, 2] = 1.5×.
    fireEvent.change(screen.getByLabelText('Landscape · desktop Speed'), { target: { value: '5' } })
    expect(onApplyStyle).toHaveBeenCalledWith('slot:hero_landscape', 'speed-[1.5x]')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(saveStyleMock).toHaveBeenCalledWith('artist-1', 'slot:hero_landscape', 'speed-[1.5x]')
  })

  it('video Replace with an empty library points at the Videos page', () => {
    renderInspector([], { videos: [yt({ id: 'v2', title: 'Studio session', poster: null, onSite: true })] })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
    fireEvent.click(screen.getByRole('button', { name: /Edit video slot 1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    expect(screen.getByRole('link', { name: /Add a video first/ }).getAttribute('href')).toBe('/artists/artist-1/videos')
  })
})

describe('EditorInspector — Merch component', () => {
  function openMerch() {
    renderInspector([], { merch: MERCH })
    fireEvent.click(screen.getByRole('button', { name: /Merch/ }))
  }

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

describe('EditorInspector — Music panel (projects)', () => {
  function openMusic(releases: EditorProject[] = RELEASES) {
    renderInspector([], { releases })
    fireEvent.click(screen.getByRole('button', { name: /Music/ }))
  }

  it('the grid tile is just icon + label — no on-site count (Sam, 2026-08-12)', () => {
    renderInspector([], { releases: RELEASES })
    const tile = screen.getByRole('button', { name: /Music/ })
    expect(tile.textContent).toContain('Music')
    // The "2 of 3 on site" line was removed from the landing grid.
    expect(tile.textContent).not.toMatch(/on site/i)
  })

  it('lists one card per project, with its kind and song count — never individual songs', () => {
    openMusic()
    expect(screen.getByText('Midnight LP')).toBeTruthy()
    expect(screen.getByText('3 songs')).toBeTruthy()
    expect(screen.getByText('Album')).toBeTruthy()
    expect(screen.getByText('EP')).toBeTruthy()
    // Off-site projects still show (dimmed) — the whole catalog is arrangeable here.
    expect(screen.getByText('One Off')).toBeTruthy()
    expect(screen.getByText('1 song')).toBeTruthy()
  })

  it('toggling a project off flips on_site on ITS SONGS (not a release flag)', () => {
    openMusic()
    fireEvent.click(screen.getByRole('button', { name: 'Take Midnight LP off the site' }))
    expect(setSongsOnSiteMock).toHaveBeenCalledWith('artist-1', ['t1', 't2', 't3'], false)
  })

  it('toggling an off-site project on puts its songs up', () => {
    openMusic()
    fireEvent.click(screen.getByRole('button', { name: 'Put One Off on the site' }))
    expect(setSongsOnSiteMock).toHaveBeenCalledWith('artist-1', ['t9'], true)
  })

  it('projects are NOT draggable — order comes from release date, not the manager', () => {
    openMusic()
    expect(document.querySelectorAll('aside div[draggable="true"]').length).toBe(0)
  })

  it('renders projects in the order given (page sorts them newest-first)', () => {
    openMusic()
    const titles = [...document.querySelectorAll('aside .grid span')]
      .map((s) => s.textContent)
      .filter((t) => t === 'Midnight LP' || t === 'Sundown EP' || t === 'One Off')
    expect(titles).toEqual(['Midnight LP', 'Sundown EP', 'One Off'])
  })

  it('expands a project to reveal its songs, and the toggle does NOT expand it', () => {
    openMusic()
    // Collapsed: the album's songs aren't shown.
    expect(screen.queryByText('Nightdrive')).toBeNull()
    // Clicking the card face opens its tracklist.
    fireEvent.click(screen.getByRole('button', { name: /Midnight LP . 3 songs/ }))
    expect(screen.getByText('Intro')).toBeTruthy()
    expect(screen.getByText('Nightdrive')).toBeTruthy()
    // The on/off toggle is a separate control — clicking it toggles, never collapses.
    fireEvent.click(screen.getByRole('button', { name: 'Take Midnight LP off the site' }))
    expect(setSongsOnSiteMock).toHaveBeenCalled()
    expect(screen.getByText('Nightdrive')).toBeTruthy() // still open
  })

  it('points at the Music page when there are no projects', () => {
    renderInspector([], { releases: [] })
    fireEvent.click(screen.getByRole('button', { name: /Music/ }))
    expect(screen.getByRole('link', { name: /Add music/ }).getAttribute('href')).toBe('/artists/artist-1/music')
  })
})

/**
 * Style tools (SITE_STYLING_PLAN.md S4). The regions are NOT hardcoded here: a
 * custom site posts its own edit-list on `ready` (D-D), so the shell hands them in.
 * A stored class string REPLACES the region's base classes, so the field seeds with
 * the override when there is one and the base otherwise — clearing it restores the
 * base.
 */
describe('EditorInspector — Style component (no-code controls)', () => {
  // ELEMENT regions: reachable only via click focus (`focusStyle`) since 2026-08-12 —
  // the control tests drive them that way. Site-wide browsing is PAGE_REGIONS below.
  const REGIONS: ManifestStyleRegion[] = [
    { key: 'hero_wordmark', label: 'Hero wordmark (SKEEN)', base: 'font-black uppercase' },
    // text-center is the point, not decoration: the "base alignment is REPLACED" test
    // below was vacuous without an alignment class in the base to replace (2026-08-17
    // review) — its not.toContain passed against a base that never contained it.
    { key: 'footer', label: 'Footer', base: 'mt-auto border-t px-6 text-center' },
  ]
  // SITE-WIDE regions: what browsing the tab lists. Their controls are the SURFACE
  // allowlist (controlsForRegion) — no text styling on the page itself.
  const PAGE_REGIONS: ManifestStyleRegion[] = [
    { key: 'page', label: 'Page', base: 'bg-paper', scope: 'site' },
    { key: 'chrome', label: 'Chrome', base: 'border-t', scope: 'chrome' },
  ]
  const PALETTE: SiteStyleOptions = {
    fonts: [{ value: 'font-momo', label: 'Momo' }],
    textColors: [{ value: 'text-flash-1', label: 'Flash' }],
    bgColors: [{ value: 'bg-black', label: 'Black' }],
  }

  function openStyle(opts: Parameters<typeof renderInspector>[1] = {}) {
    renderInspector([], { styleRegions: REGIONS, ...opts })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
  }
  /** The click-to-edit route: mount with a frame selection — the panel opens focused
   *  on that one region, its controls already expanded. The only door to an element
   *  region since 2026-08-12. */
  function focusStyle(key: string, opts: Parameters<typeof renderInspector>[1] = {}) {
    renderInspector([], { styleRegions: REGIONS, selectedStyle: key, ...opts })
  }
  const expand = (label: string) => fireEvent.click(screen.getByRole('button', { name: `Edit ${label}` }))

  it('is an accordion: controls appear only when a section is opened', () => {
    // Browsing shows the site-wide list (surface controls) — the accordion rule lives
    // there now; a focused element region arrives already open.
    openStyle({ styleRegions: PAGE_REGIONS })
    expect(screen.queryByLabelText('Chrome Padding')).toBeNull()
    expand('Chrome')
    expect(screen.getByLabelText('Chrome Padding')).toBeTruthy()
  })

  it('the page background offers ONE color and nothing else — padding is the chrome bars\'', () => {
    // The component half of controlsForRegion's rule (the id list is pinned in
    // tests/style-controls.test.ts): the rendered rows really match the allowlist.
    openStyle({ styleRegions: PAGE_REGIONS })
    expand('Page')
    expect(screen.queryByLabelText('Page Vert padding')).toBeNull() // pulled 2026-08-14
    // Geometry is the CHROME bars' (Sam: "drop height and width from the middle").
    expect(screen.queryByLabelText('Page Width')).toBeNull()
    expect(screen.queryByLabelText('Page Height')).toBeNull()
    expect(screen.queryByLabelText('Page Frosted glass')).toBeNull() // nothing behind an opaque bar to blur
    expect(screen.getByLabelText('Page Background color hex')).toBeTruthy()
    expect(screen.queryByLabelText('Page Size')).toBeNull() // read as doing nothing — gone
    expect(screen.queryByLabelText('Page Boldness')).toBeNull()
    // One colour, no gradient (Sam, 2026-08-12).
    expect(screen.queryByLabelText('Page Background gradient start')).toBeNull()
    expect(screen.queryByLabelText('Page Divider line')).toBeNull() // bg-paper draws no line
    expand('Chrome')
    expect(screen.getByLabelText('Chrome Divider line')).toBeTruthy() // border-t in its base
    expect(screen.getByLabelText('Chrome Width')).toBeTruthy()
    expect(screen.getByLabelText('Chrome Height')).toBeTruthy()
  })

  it('reads the base classes into the controls (Black weight, Uppercase on)', () => {
    focusStyle('hero_wordmark')
    expect((screen.getByLabelText('Hero wordmark (SKEEN) Boldness') as HTMLSelectElement).value).toBe('font-black')
    // The toggles are role=switch buttons (not checkboxes), so the on/off state is
    // aria-checked — the same signal a screen reader reads.
    expect(screen.getByLabelText('Hero wordmark (SKEEN) Uppercase').getAttribute('aria-checked')).toBe('true')
  })

  it('changing Boldness swaps the weight class and PRESERVES the rest, repainting live', () => {
    const onApplyStyle = vi.fn()
    focusStyle('hero_wordmark', { onApplyStyle })
    fireEvent.change(screen.getByLabelText('Hero wordmark (SKEEN) Boldness'), { target: { value: 'weight-[700]' } })
    expect(onApplyStyle).toHaveBeenCalledWith('hero_wordmark', 'uppercase weight-[700]')
  })

  it('a toggle clears its class when unchecked', () => {
    const onApplyStyle = vi.fn()
    focusStyle('hero_wordmark', { onApplyStyle })
    fireEvent.click(screen.getByLabelText('Hero wordmark (SKEEN) Uppercase')) // uncheck
    expect(onApplyStyle).toHaveBeenCalledWith('hero_wordmark', 'font-black')
  })

  it('debounces the save, then persists the swapped class string', () => {
    vi.useFakeTimers()
    try {
      focusStyle('footer')
      // Derived from the real control: sizes became fluid clamps so text shrinks on a
      // phone, and a hardcoded `text-lg` here would assert against a scale that no
      // longer exists.
      const sizeCtl = buildStyleControls().find((c) => c.id === 'size')!
      const size = sizeCtl.kind === 'select' ? sizeCtl.options.find((o) => o.value)!.value : ''
      fireEvent.change(screen.getByLabelText('Footer Size'), { target: { value: size } })
      expect(saveStyleMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      expect(saveStyleMock).toHaveBeenCalledWith('artist-1', 'footer', `mt-auto border-t px-6 text-center ${size}`)
    } finally {
      vi.useRealTimers()
    }
  })

  it("returning the controls to the region's BASE saves '' — the override row is deleted, not pinned", async () => {
    // A stored copy of the defaults would win forever over any later change to the
    // site's own base classes (skeen brief, 2026-08-03).
    vi.useFakeTimers()
    try {
      focusStyle('hero_wordmark')
      const weight = screen.getByLabelText('Hero wordmark (SKEEN) Boldness')
      fireEvent.change(weight, { target: { value: 'weight-[700]' } })
      await vi.advanceTimersByTimeAsync(500)
      expect(saveStyleMock).toHaveBeenLastCalledWith('artist-1', 'hero_wordmark', 'uppercase weight-[700]')
      // Back to the base weight — VIA ITS TOKEN. The base says `font-black`, the control
      // now offers `weight-[900]`; the two must read as the same meaning or returning to
      // the base pins an override every time (the exact regression the migration risked).
      // (Async advance: the second persist chains behind the first's promise.)
      fireEvent.change(weight, { target: { value: 'weight-[900]' } })
      await vi.advanceTimersByTimeAsync(500)
      expect(saveStyleMock).toHaveBeenLastCalledWith('artist-1', 'hero_wordmark', '')
    } finally {
      vi.useRealTimers()
    }
  })

  it('DELTA ERA: a 0.24 site stores only the changed family, sentinel-led', async () => {
    // The whole point of delta overrides: the save carries `lse-delta weight-[700]`,
    // not a copy of the base — so the region never freezes, and the base's own hook
    // classes/claims keep flowing at render. End-to-end through the real panel.
    vi.useFakeTimers()
    try {
      focusStyle('hero_wordmark', { styleOptions: withStyleVars(undefined, '0.24.0') })
      fireEvent.change(screen.getByLabelText('Hero wordmark (SKEEN) Boldness'), { target: { value: 'weight-[700]' } })
      await vi.advanceTimersByTimeAsync(500)
      expect(saveStyleMock).toHaveBeenLastCalledWith('artist-1', 'hero_wordmark', 'lse-delta weight-[700]')
      // Back to the base's weight: the delta empties and the row is DELETED.
      fireEvent.change(screen.getByLabelText('Hero wordmark (SKEEN) Boldness'), { target: { value: 'weight-[900]' } })
      await vi.advanceTimersByTimeAsync(500)
      expect(saveStyleMock).toHaveBeenLastCalledWith('artist-1', 'hero_wordmark', '')
    } finally {
      vi.useRealTimers()
    }
  })

  it('Revert changes walks every touched region back to its session-start value', async () => {
    // Two chrome bars (the browse list can open several rows; both carry the padding
    // slider): 'nav' starts with NO stored row (before = null → revert deletes via '');
    // 'foot' starts with a stored override (before = that string → revert restores it).
    const regions: ManifestStyleRegion[] = [
      { key: 'nav', label: 'Nav', base: 'border-t', scope: 'chrome' },
      { key: 'foot', label: 'Foot', base: 'border-b', scope: 'chrome' },
    ]
    openStyle({ styleRegions: regions, styleValues: { foot: 'border-b text-lg' } })
    expand('Nav')
    // Padding is a slider: the range input's value is a STEP INDEX, not a class.
    fireEvent.change(screen.getByLabelText('Nav Padding'), { target: { value: '1' } })
    expand('Foot')
    fireEvent.change(screen.getByLabelText('Foot Padding'), { target: { value: '1' } })
    // Two keys touched → the walk-back covers BOTH. Driven through the never-published
    // fallback, which is the path that still uses the session ledger (2026-08-14); with a
    // published version the server restore replaces this walk entirely.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Revert changes' }))
    })
    // Reverse order: foot (touched last) first, then nav.
    expect(saveStyleMock).toHaveBeenCalledWith('artist-1', 'foot', 'border-b text-lg')
    expect(saveStyleMock).toHaveBeenLastCalledWith('artist-1', 'nav', '')
    // The ledger clears — the button leaves until something new is touched.
    expect(screen.queryByRole('button', { name: 'Revert changes' })).toBeNull()
  })

  it('Font is palette-gated; the colour pickers exist regardless — hex lifts inline anywhere', () => {
    focusStyle('footer')
    expect(screen.queryByLabelText('Footer Font')).toBeNull() // no palette declared
    expect(screen.getByLabelText('Footer Background color hex')).toBeTruthy() // 2026-08-12: always
    cleanup()
    focusStyle('footer', { styleOptions: PALETTE })
    expect(screen.getByLabelText('Footer Font')).toBeTruthy()
    expect(screen.getByLabelText('Footer Background color hex')).toBeTruthy()
  })

  it('paints the chosen value as text (the native control cannot render Inter)', () => {
    // The <select> is transparent and overlaid; the value beside it is ordinary DOM
    // text. If that text ever stops tracking the select, the panel silently lies about
    // what is set — so assert it moves with the value.
    focusStyle('footer')
    // The painted layer is the select's sibling — reading the wrapper instead would
    // also pick up every <option>'s text.
    const painted = () => (screen.getByLabelText('Footer Alignment').parentElement as HTMLElement).lastElementChild
    // The base sets text-center, so the control opens ON Center (the fixture gained an
    // alignment class on 2026-08-17 to arm the is-REPLACED assertion below).
    expect(painted()?.textContent).toBe('Center')
    fireEvent.change(screen.getByLabelText('Footer Alignment'), { target: { value: 'align-[right]' } })
    expect(painted()?.textContent).toBe('Right')
  })

  it('never exposes the raw Tailwind classes — no Advanced box for a manager to break', () => {
    focusStyle('footer')
    expect(screen.queryByLabelText('Footer classes')).toBeNull()
    expect(screen.queryByText(/advanced/i)).toBeNull()
  })

  it('still PRESERVES base classes the controls do not own when a control changes', () => {
    // The escape hatch is gone, so this is the only guarantee left that a region's
    // layout classes survive a styling change — the manager can no longer repair them
    // by hand if a control eats one.
    vi.useFakeTimers()
    try {
      focusStyle('footer')
      // A value that DIFFERS from the base's own alignment, or the save is '' (equal to
      // base → row deleted) and there is nothing to inspect.
      fireEvent.change(screen.getByLabelText('Footer Alignment'), { target: { value: 'align-[right]' } })
      vi.advanceTimersByTime(500)
      const saved = saveStyleMock.mock.calls.at(-1)?.[2] as string
      expect(saved).toContain('mt-auto')
      expect(saved).toContain('border-t')
      expect(saved).toContain('px-6')
      expect(saved).toContain('align-[right]')
      // …and the base's own alignment is REPLACED, not left to fight the new one.
      expect(saved).not.toContain('text-center')
    } finally {
      vi.useRealTimers()
    }
  })

  it('explains itself when the site declares no styleable regions', () => {
    renderInspector([], { styleRegions: [] })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    expect(screen.getByText(/hasn't declared any styleable sections/i)).toBeTruthy()
  })

  it('clicking a region in the SITE opens that section', () => {
    // The point of the embedded-frame model: click the thing, edit the thing.
    renderInspector([], { styleRegions: REGIONS, selectedStyle: 'footer' })
    // Style panel opened AND the Footer section expanded (its controls are present).
    expect(screen.getByLabelText('Footer Boldness')).toBeTruthy()
  })

  it('CRITICAL: manually opening the Style tab DROPS the click focus — no leftover element controls', () => {
    // Clicking footer in the frame focuses its controls; going back to the Style tab
    // by hand is browsing, and browsing shows site-wide styles only. Without the
    // drop, the last-clicked element lingers as a second edit path (Sam, 2026-08-12).
    renderInspector([], {
      styleRegions: [
        { key: 'page', label: 'Page background', base: '', scope: 'site' },
        { key: 'footer', label: 'Footer', base: 'mt-auto border-t px-6' },
      ],
      selectedStyle: 'footer',
    })
    expect(screen.getByLabelText('Footer Boldness')).toBeTruthy() // click focus active
    fireEvent.click(screen.getByRole('button', { name: 'Close' })) // back to the grid…
    fireEvent.click(screen.getByRole('button', { name: /Style/ })) // …then open Style by hand
    expect(screen.queryByLabelText('Footer Boldness')).toBeNull()
    expect(screen.getByText('Page background')).toBeTruthy()
  })

  it('CRITICAL: an element-scoped region is NOT listed — click-to-edit is its only door', () => {
    // One edit path per thing (Sam, 2026-08-12): the tab lists site-wide regions only;
    // an element region appears here solely when it was clicked in the preview.
    renderInspector([], {
      styleRegions: [
        { key: 'page', label: 'Page background', base: '', scope: 'site' },
        { key: 'bio', label: 'Biography', base: '' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    expect(screen.getByText('Page background')).toBeTruthy()
    expect(screen.queryByText('Biography')).toBeNull()
  })

  it('CRITICAL: a single-region group whose row repeats the heading shows it ONCE', () => {
    // The double-header fix (Sam, 2026-08-12): a "Footer" group over a "Footer" region
    // must not render both. The panel-level suppression (showHeading) is separate from
    // the sectionRowLabel unit tests, and was unpinned.
    renderInspector([], {
      styleRegions: [{ key: 'footer', label: 'Footer', base: 'border-t', group: 'Footer', scope: 'chrome' }],
    })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    expect(screen.getAllByText('Footer')).toHaveLength(1)
  })

  it('CRITICAL: an OPEN row shows an X, not a pencil — and it closes the row', () => {
    // Sam, 2026-08-14: "the edit button should be an x to close it". The pencil is also
    // hover-gated (opacity-0); an open row's X must be visible without hovering, or the
    // only affordance for closing is invisible.
    renderInspector([], {
      styleRegions: [{ key: 'page', label: 'Page background', base: 'bg-paper', scope: 'site' }],
    })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Page background' }))
    expect(screen.getByLabelText('Page background Background color hex')).toBeTruthy() // open
    const close = screen.getByRole('button', { name: 'Close Page background' })
    expect(screen.queryByRole('button', { name: 'Edit Page background' })).toBeNull() // swapped
    expect(close.className).not.toContain('opacity-0') // visible without a hover
    fireEvent.click(close)
    expect(screen.queryByLabelText('Page background Background color hex')).toBeNull()
  })

  it('CRITICAL: clicking anywhere outside an open row closes it', () => {
    // "when the editing panel is open, hitting the x or tapping anywhere else should
    // close it" (Sam, 2026-08-14).
    renderInspector([], {
      styleRegions: [{ key: 'page', label: 'Page background', base: 'bg-paper', scope: 'site' }],
    })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Page background' }))
    expect(screen.getByLabelText('Page background Background color hex')).toBeTruthy()
    fireEvent.mouseDown(document.body) // a click on empty panel chrome
    expect(screen.queryByLabelText('Page background Background color hex')).toBeNull()
  })

  it('CRITICAL: clicking a CONTROL inside the open body does not close it', () => {
    // The mirror of the rule above, and the one that makes it safe: every drag of a
    // slider starts with a mousedown INSIDE the body. Close on those and the panel
    // shuts the instant the manager tries to use it.
    renderInspector([], {
      styleRegions: [{ key: 'masthead', label: 'Masthead bar', base: 'flex border-b px-6 py-4', scope: 'chrome' }],
    })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Masthead bar' }))
    const pad = screen.getByLabelText('Masthead bar Padding')
    fireEvent.mouseDown(pad)
    expect(screen.getByLabelText('Masthead bar Padding')).toBeTruthy() // still open
    // …and the row's own header is inside too, so clicking its label never shuts it.
    fireEvent.mouseDown(screen.getByText('Masthead bar'))
    expect(screen.getByLabelText('Masthead bar Padding')).toBeTruthy()
    // WITNESS: prove the listener is armed at all. An unattached boundary ref closes
    // NOTHING, which would make both assertions above vacuously true.
    fireEvent.mouseDown(document.body)
    expect(screen.queryByLabelText('Masthead bar Padding')).toBeNull()
  })

  it('opening a SECOND row closes the first — one open row at a time', () => {
    renderInspector([], {
      styleRegions: [
        { key: 'page', label: 'Page background', base: 'bg-paper', scope: 'site' },
        { key: 'masthead', label: 'Masthead bar', base: 'flex border-b px-6 py-4', scope: 'chrome' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Page background' }))
    // The outside-click listener fires on mousedown, the open on click — so the second
    // row must still end up OPEN, not closed by its own opening gesture.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Edit Masthead bar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Masthead bar' }))
    expect(screen.getByLabelText('Masthead bar Padding')).toBeTruthy()
    expect(screen.queryByLabelText('Page background Background color hex')).toBeNull()
  })

  it('CRITICAL: clicking dead space in the PREVIEW closes the open row', () => {
    // Sam, 2026-08-14: "if I click inside the iframe and there is nothing in the editor
    // related to that click, simply close the opened edit panel". The frame already
    // posts `deselect` for a click on nothing marked; this is the editor honouring it.
    const view = renderInspector([], {
      styleRegions: [{ key: 'page', label: 'Page background', base: 'bg-paper', scope: 'site' }],
      deselectedAt: 1,
    })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Page background' }))
    expect(screen.getByLabelText('Page background Background color hex')).toBeTruthy()
    view.rerender(inspector([], {
      styleRegions: [{ key: 'page', label: 'Page background', base: 'bg-paper', scope: 'site' }],
      deselectedAt: 2, // a new click on nothing
    }))
    expect(screen.queryByLabelText('Page background Background color hex')).toBeNull()
  })

  it('CRITICAL: clicking an EDITABLE element in the preview swaps which row is open', () => {
    // The other half: "if I clicked somewhere that is editable, close the previous panel
    // and open the new one." One row open at a time, driven by the preview.
    const regions: ManifestStyleRegion[] = [
      { key: 'page', label: 'Page background', base: 'bg-paper', scope: 'site' },
      { key: 'masthead', label: 'Masthead bar', base: 'flex border-b px-6 py-4', scope: 'chrome' },
    ]
    const view = renderInspector([], { styleRegions: regions, selectedStyle: 'page' })
    expect(screen.getByLabelText('Page background Background color hex')).toBeTruthy()
    view.rerender(inspector([], { styleRegions: regions, selectedStyle: 'masthead' }))
    expect(screen.getByLabelText('Masthead bar Padding')).toBeTruthy()
    expect(screen.queryByLabelText('Page background Background color hex')).toBeNull()
  })

  it('a deselect does NOT reopen or disturb a row the manager opens afterwards', () => {
    // The signal is an EVENT (a counter), not a state. Once handled it must not keep
    // slamming rows shut, or the panel becomes unusable after one preview click.
    const regions: ManifestStyleRegion[] = [
      { key: 'page', label: 'Page background', base: 'bg-paper', scope: 'site' },
    ]
    const view = renderInspector([], { styleRegions: regions, deselectedAt: 1 })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    view.rerender(inspector([], { styleRegions: regions, deselectedAt: 2 }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Page background' }))
    expect(screen.getByLabelText('Page background Background color hex')).toBeTruthy()
  })

  it('CRITICAL: a heading-suppressed group still breaks from the group above it', () => {
    // The other half of the double-header fix (Sam, 2026-08-14: "the footer lies under
    // the hero section … The footer should be its own thing"). Suppressing the "Footer"
    // heading must not let the bare row visually attach to the "Hero" group above — the
    // group boundary renders as a separator even when its text is dropped.
    renderInspector([], {
      styleRegions: [
        { key: 'hero', label: 'Hero layout', base: 'grid', group: 'Hero', scope: 'site' },
        { key: 'footer', label: 'Footer', base: 'border-t', group: 'Footer', scope: 'chrome' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    expect(screen.getAllByText('Footer')).toHaveLength(1) // suppression itself still holds
    expect(screen.getByRole('separator')).toBeTruthy() // …but the boundary survives it
  })
})

describe('EditorInspector — the Revert changes button (session undo; named by Sam 2026-08-17)', () => {
  // A chrome bar: it carries the padding slider (the page background no longer does), and
  // the slider touches the ledger on `change` — no blur/commit needed like the colour hex.
  const REGIONS: ManifestStyleRegion[] = [
    { key: 'footer', label: 'Footer', base: 'border-t', scope: 'chrome' },
  ]
  const editPage = () => {
    renderInspector([], { styleRegions: REGIONS, styleValues: { footer: 'border-t text-lg' } })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Footer' }))
    fireEvent.change(screen.getByLabelText('Footer Padding'), { target: { value: '1' } })
  }

  beforeEach(() => window.localStorage.clear())

  it('CRITICAL: appears only once something is touched, and is called Revert changes', () => {
    renderInspector([], { styleRegions: REGIONS })
    fireEvent.click(screen.getByRole('button', { name: /Style/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Footer' }))
    expect(screen.queryByRole('button', { name: 'Revert changes' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Footer Padding'), { target: { value: '1' } })
    expect(screen.getByRole('button', { name: 'Revert changes' })).toBeTruthy()
  })

  it('CRITICAL: it undoes THIS SESSION only — it never restores a published version', () => {
    // Sam, 2026-08-15: "it just removes all the changes in the current session." Going
    // back to a PUBLISHED version is a separate, deliberate act, and it lives behind the
    // Restore version menu next to Publish — not on this button.
    const saveStyle = vi.mocked(saveEditorStyleAction)
    editPage()
    saveStyle.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Revert changes' }))
    // The region goes back to the value it had when the session started…
    expect(saveStyle).toHaveBeenCalledWith('artist-1', 'footer', 'border-t text-lg')
    // …and the published-restore path is never involved.
    expect(restorePublishedAction).not.toHaveBeenCalled()
  })

  it('CRITICAL: no confirmation and no version list — it is a plain undo', () => {
    // Both belong to Restore version now. A dialog in front of "undo what I just did"
    // is friction on the cheap, expected action.
    editPage()
    fireEvent.click(screen.getByRole('button', { name: 'Revert changes' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(listPublishMomentsAction).not.toHaveBeenCalled()
  })

  it('CRITICAL: there is NO Save/Done button', () => {
    // Sam, 2026-08-14: edits already autosave to the draft, so a button that only
    // dismissed the undo buffer was a second word for "save" that saved nothing.
    editPage()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Revert changes' })).toBeTruthy()
  })

  it('CRITICAL: the panel never announces "Saved" or "Saving…"', async () => {
    // "I dont need that text though to show up saying saved" (Sam, 2026-08-14). The
    // draft write is silent; only a FAILED write still speaks (pinned in site-tools).
    //
    // The timers MUST be driven: the write is debounced 500ms, so asserting straight
    // after the edit finds `idle` and passes whatever the component would have printed
    // — a vacuous green (caught by mutation check, 2026-08-14).
    vi.useFakeTimers()
    try {
      editPage()
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      expect(screen.queryByText('Saved')).toBeNull()
      expect(screen.queryByText('Saving…')).toBeNull()
      expect(saveEditorStyleAction).toHaveBeenCalled() // the write really did land
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * The editor's job is what's on the SITE (ADR 0006), so its counts must be on-site
 * counts. They used to be LIBRARY counts, which lied: skeen's YouTube sync imports
 * every video off-site (`insertDefaults: on_site:false`), so the panel read
 * "83 videos" while the public site served ZERO of them. Songs and links looked fine
 * only by luck — they happened to be 19/19 and 8/8, so library == on-site.
 */
describe('EditorInspector — what is ON the site is unambiguous', () => {
  // The per-kind on-site count that headed each browse row is GONE (Sam, 2026-08-12:
  // "I don't need to see the x of x on site") — the four label-assertion tests here
  // went with it. What survives is the STRUCTURAL guarantee the count only ever
  // narrated: a big off-site library never masquerades as filled slots.
  it('keeps a big off-site library out of the slots, so what is ON the site is unambiguous', () => {
    // An off-site video is NOT a filled slot — it sits in the library picker. So a
    // channel of 83 imports never reads as "83 on your site": both band slots are empty.
    renderInspector([], { videos: [yt({ id: 'v', title: 'Only', poster: null, onSite: false })] })
    fireEvent.click(screen.getByRole('button', { name: /Videos/ }))
    expect(screen.queryByLabelText('Slot 1 title')).toBeNull() // nothing placed
    expect(screen.getAllByRole('button', { name: /Pick a YouTube video/ })).toHaveLength(2)
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

describe('EditorInspector — a show’s supporting acts are linked ON the show', () => {
  // MOVED from the Links panel (Sam, 2026-08-09): "Those should just be added on the
  // tour dates section. There should be an edit button for the specific tour show and in
  // that should have the support section where you add the supporting artist's website
  // link." The old home was a flat list of every act across every date, each row
  // captioned with which show it belonged to — a fact about a show, filed away from it.
  const openShow = (opts: { support?: EditorSupportLink[] } = {}) => {
    renderInspector([], { tours: TOURS, supportLinks: opts.support ?? SUPPORT })
    fireEvent.click(screen.getByRole('button', { name: /Tour/ }))
    fireEvent.click(screen.getByRole('button', { name: /Edit Mohawk/ }))
  }

  it('CRITICAL: every show has an Edit button that opens it full-panel', () => {
    renderInspector([], { tours: TOURS, supportLinks: SUPPORT })
    fireEvent.click(screen.getByRole('button', { name: /Tour/ }))
    fireEvent.click(screen.getByRole('button', { name: /Edit Mohawk/ }))
    // Headed by the show, since the date column and venue line are no longer beside it.
    expect(screen.getByRole('heading', { name: /12 SEP 26 · Mohawk/ })).toBeTruthy()
    expect(screen.getByText('Supporting acts')).toBeTruthy()
  })

  it('CRITICAL: lists THIS show’s acts only, each with its own URL field', () => {
    // t1 carries Arlo + "Crosby, Stills & Nash"; t2 and t3 carry none. A panel that
    // leaked the other dates' acts would be the flat list again, one level down.
    openShow()
    expect(screen.getByLabelText('Link for Arlo')).toBeTruthy()
    expect(screen.getByLabelText('Link for Crosby, Stills & Nash')).toBeTruthy()
    // Arlo's stored URL is seeded from the payload, not blank.
    expect((screen.getByLabelText('Link for Arlo') as HTMLInputElement).value).toBe('https://arlo.example')
  })

  it('CRITICAL: debounce-saves by tour date + act name', () => {
    // The behaviour the old panel guarded, kept verbatim through the move — the write
    // is keyed by (tourDateId, name), which is what `support_urls` is keyed by.
    vi.useFakeTimers()
    try {
      openShow()
      fireEvent.change(screen.getByLabelText('Link for Arlo'), { target: { value: 'https://arlo.band' } })
      expect(setSupportUrlMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      expect(setSupportUrlMock).toHaveBeenCalledWith('artist-1', 't1', 'Arlo', 'https://arlo.band')
    } finally {
      vi.useRealTimers()
    }
  })

  it('CRITICAL: a frame click DISMISSES the show editor — the panel is never stuck', () => {
    // 2026-08-09 review. The frame-select router cleared editingItem/editingText but not
    // the new editingTour, and the tour editor sits ABOVE `active` in the render. So with
    // a show open, every click in the preview looked dead: the panel behind it changed
    // and the manager saw none of it.
    //
    // Routed to an ITEM deliberately. A text select opens the TEXT editor, which renders
    // ABOVE the tour editor and masks it — so that version of this test passed with the
    // bug still in place (caught by deleting the guard and watching it stay green). An
    // item select opens no editor at all, so a stale tour panel has nothing hiding it.
    const { rerender } = renderInspector([], { tours: TOURS, supportLinks: SUPPORT, videos: VIDEOS })
    fireEvent.click(screen.getByRole('button', { name: /Tour/ }))
    fireEvent.click(screen.getByRole('button', { name: /Edit Mohawk/ }))
    expect(screen.getByText('Supporting acts')).toBeTruthy()

    rerender(
      <EditorInspector
        artistId="artist-1"
        photos={[]}
        imageFields={[]}
        selectedRegion={{ target: { kind: 'item', assetType: 'video', id: 'v1' }, nonce: 7 }}
        textFields={[]}
        links={[]}
        supportLinks={SUPPORT}
        linkValues={{}}
        videos={VIDEOS}
        merch={[]}
        releases={[]}
        tours={TOURS}
      />,
    )
    expect(screen.queryByText('Supporting acts')).toBeNull()
  })

  it('CRITICAL: the show’s own details are editable right here', () => {
    // Sam, 2026-08-10: "There is no way to edit these tour dates in the left editing
    // panel. You should be able to edit some of the info right there and it updates in
    // the tour dates section." The editor's job was placement-only; a wrong venue meant
    // leaving for the Tour page. The fields save through the SAME generic CRUD the Tour
    // page uses, so there is one write path, and the refreshed draft re-sends init-data
    // — which is what updates the window.
    openShow()
    expect((screen.getByLabelText('Venue') as HTMLInputElement).value).toBe('Mohawk')
    expect((screen.getByLabelText('City') as HTMLInputElement).value).toBe('Austin')
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-09-12')
  })

  it('CRITICAL: editing a detail debounce-saves via the generic CRUD', () => {
    vi.useFakeTimers()
    try {
      openShow()
      fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'Hotel Vegas' } })
      expect(updateContentMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      expect(updateContentMock).toHaveBeenCalledTimes(1)
      const [type, id, artistId, fd] = updateContentMock.mock.calls[0]
      expect(type).toBe('tour_date')
      expect(id).toBe('t1')
      expect(artistId).toBe('artist-1')
      expect((fd as FormData).get('venue')).toBe('Hotel Vegas')
    } finally {
      vi.useRealTimers()
    }
  })

  it('CRITICAL: an act can be ADDED here, and the whole list saves', async () => {
    // Sam, 2026-08-10: "Allow to add supporting acts (multiple need be) and their links
    // in the side panel." Acts were entered only on the Tour page; this panel could just
    // link them. The save posts the WHOLE array — that is the column's write shape
    // (tour_dates.support text[], extracted via getAll).
    openShow()
    fireEvent.change(screen.getByLabelText('Add a supporting act'), { target: { value: 'Gudfella' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add act/i }))
    })
    expect(updateContentMock).toHaveBeenCalledTimes(1)
    const [type, id, , fd] = updateContentMock.mock.calls[0]
    expect(type).toBe('tour_date')
    expect(id).toBe('t1')
    expect((fd as FormData).getAll('support')).toEqual(['Arlo', 'Crosby, Stills & Nash', 'Gudfella'])
    // …and the new act immediately has its own link field.
    expect(screen.getByLabelText('Link for Gudfella')).toBeTruthy()
  })

  it('CRITICAL: removing an act saves the remaining list', async () => {
    openShow()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Arlo' }))
    })
    const [, , , fd] = updateContentMock.mock.calls[0]
    expect((fd as FormData).getAll('support')).toEqual(['Crosby, Stills & Nash'])
    expect(screen.queryByLabelText('Link for Arlo')).toBeNull()
  })

  it('removing the LAST act posts the blank sentinel, so the column actually clears', async () => {
    // extractUpdate only writes fields present in the FormData; with zero entries the
    // field would be absent and the old list silently kept (content-form.ts's own
    // comment). The blank entry is the documented sentinel: getAll → trim → filter →
    // [], which the NOT NULL column stores as empty.
    renderInspector([], {
      tours: [{ ...TOURS[0], id: 't9', venue: 'Solo Room', support: ['Only Act'] }],
      supportLinks: [],
    })
    fireEvent.click(screen.getByRole('button', { name: /Tour/ }))
    fireEvent.click(screen.getByRole('button', { name: /Edit Solo Room/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Only Act' }))
    })
    const [, , , fd] = updateContentMock.mock.calls[0]
    expect((fd as FormData).getAll('support')).toEqual([''])
  })

  it('a duplicate act name is refused — support_urls is keyed by name', async () => {
    // Two acts named "Arlo" would share one link row and one remove button; the second
    // is a mistake, not a lineup.
    openShow()
    fireEvent.change(screen.getByLabelText('Add a supporting act'), { target: { value: '  arlo ' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add act/i }))
    })
    expect(updateContentMock).not.toHaveBeenCalled()
    expect(screen.getByText(/already on this show/i)).toBeTruthy()
  })

  it('says so when a show has no supporting acts', () => {
    // A blank panel is indistinguishable from a broken one, and the acts are entered
    // elsewhere — so the empty state has to point there.
    renderInspector([], { tours: TOURS, supportLinks: [] })
    fireEvent.click(screen.getByRole('button', { name: /Tour/ }))
    fireEvent.click(screen.getByRole('button', { name: /Edit Empty Bottle/ }))
    expect(screen.getByText(/No supporting acts on this show yet/i)).toBeTruthy()
  })
})

describe('EditorInspector — a single-song project card IS its song', () => {
  it('CRITICAL: clicking a single’s card selects its one song — not just expands', () => {
    // Sam, 2026-08-10, OPERATOR: "clicking songs in the left panel doesnt highlight them
    // in the right." He was clicking song-titled CARDS — every track was a single, so
    // each card held exactly one song — and the card's only behaviour was expanding a
    // one-row tracklist. The [panel] click log never fired: the row he read as a song
    // was a container. When a card has ONE song there is no ambiguity about which song
    // the manager means, so the click selects it as well as expanding.
    const onHighlight = vi.fn()
    renderInspector([], {
      releases: [{ key: 'r9', title: 'Signal Lost', cover_url: null, kind: 'single', onSite: true, songs: [{ id: 's9', title: 'Signal Lost' }] }],
      onHighlight,
    })
    fireEvent.click(screen.getByRole('button', { name: /Music/ }))
    fireEvent.click(screen.getByRole('button', { name: /Signal Lost — / }))
    expect(onHighlight).toHaveBeenCalledWith({ kind: 'item', assetType: 'track', id: 's9' })
  })

  it('collapsing an open single does NOT re-select — the click is a put-away', () => {
    const onHighlight = vi.fn()
    renderInspector([], {
      releases: [{ key: 'r9', title: 'Signal Lost', cover_url: null, kind: 'single', onSite: true, songs: [{ id: 's9', title: 'Signal Lost' }] }],
      onHighlight,
    })
    fireEvent.click(screen.getByRole('button', { name: /Music/ }))
    const card = screen.getByRole('button', { name: /Signal Lost — / })
    fireEvent.click(card) // open + select
    fireEvent.click(card) // close — must not select again
    expect(onHighlight).toHaveBeenCalledTimes(1)
  })

  it('a MULTI-song card still only expands — which song is meant is genuinely unknown', () => {
    const onHighlight = vi.fn()
    renderInspector([], {
      releases: [{ key: 'r1', title: 'Neon Nights', cover_url: null, kind: 'album', onSite: true, songs: [{ id: 's1', title: 'A' }, { id: 's2', title: 'B' }] }],
      onHighlight,
    })
    fireEvent.click(screen.getByRole('button', { name: /Music/ }))
    fireEvent.click(screen.getByRole('button', { name: /Neon Nights — / }))
    expect(onHighlight).not.toHaveBeenCalled()
  })
})

describe('EditorInspector — tour tools', () => {
  const openTour = () => {
    renderInspector([], { tours: TOURS })
    fireEvent.click(screen.getByRole('button', { name: /Tour/ }))
  }

  it('offers a drag handle ONLY on undated shows', () => {
    // A dated show sorts itself by date on the site forever, so a dragged position
    // would not survive — only undated shows are reorderable (20260723120000).
    openTour()
    const rows = document.querySelectorAll('aside div[draggable="true"]')
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toContain('TBA')
  })

  it('persists only the undated shows, in their new order', () => {
    const undated: EditorTour[] = [
      { id: 'u1', date: null, venue: 'Well Studios', city: null, state: null, country: null, support: [], onSite: true },
      { id: 'u2', date: null, venue: 'REDLINE', city: null, state: null, country: null, support: [], onSite: true },
    ]
    renderInspector([], { tours: [TOURS[0], ...undated] })
    fireEvent.click(screen.getByRole('button', { name: /Tour/ }))
    const rows = document.querySelectorAll('aside div[draggable="true"]')
    expect(rows.length).toBe(2)
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[1])
    // The DATED show (t1) is absent: its sort_order is never read, so renumbering it
    // would overwrite a value for nothing.
    expect(reorderContentMock).toHaveBeenCalledWith('tour_date', 'artist-1', ['u2', 'u1'])
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

  it('never lets a DATED show be dragged — the site sorts those by date', () => {
    // Superseded the blanket "no drag handles anywhere" rule (20260723120000 added
    // sort_order as a tie-break for undated shows only). A dated show must still be
    // undraggable: its position comes from its date, so a dragged one would snap back.
    openTour()
    const dated = [...document.querySelectorAll('aside div[draggable]')].filter((el) =>
      el.textContent?.includes('Mohawk'),
    )
    expect(dated.length).toBe(1)
    expect(dated[0].getAttribute('draggable')).toBe('false')
  })

  it('points at the Tour page to add a date', () => {
    openTour()
    expect(screen.getByRole('link', { name: /Add date/ }).getAttribute('href')).toBe('/artists/artist-1/tour')
  })

  it('an empty Tour panel shows NO copy at all (Sam, 2026-08-12)', () => {
    // First "Add them on the Tour page…" went, then "No dates yet." too — an empty
    // panel is just empty. Neither the instruction nor the summary remains.
    renderInspector([], { tours: [] })
    fireEvent.click(screen.getByRole('button', { name: /Tour/ }))
    expect(screen.queryByText(/No dates yet/)).toBeNull()
    expect(screen.queryByText(/Add them on the Tour page/)).toBeNull()
  })
})


/* ── Component slots: a flat wall of numbered image slots (skeen's polaroids) ────────
 * The site declares the component and its count; the manager fills each slot. The slots
 * are shown as a FLAT numbered grid ("Slot 1 … Slot N", sequential across every instance)
 * — no named cards, no rename (Sam, 2026-07-28). A placed photo carries
 * `site_role = <key>_<n>_<slot>`, exactly the field key skeen declares, and leaves the
 * gallery collage groups. Slot 1 = polaroid_1_photo, Slot 2 = polaroid_1_caption, … */
describe('EditorInspector — component slots (flat numbered wall)', () => {
  const POLAROID: ManifestComponent = {
    key: 'polaroid',
    label: 'Polaroid',
    count: 2,
    slots: [
      { key: 'photo', label: 'Photo', hint: 'The square photo inside the frame' },
      { key: 'caption', label: 'Handwriting', prefersPng: true },
    ],
  }

  const openImages = (photos: GalleryPhoto[]) => {
    renderInspector(photos, { components: [POLAROID] })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
  }

  it('session Revert puts a slot placement back to its previous holder', async () => {
    // m2 takes Slot 1 (previously empty) → Revert re-places null.
    openImages(PHOTOS)
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1' }))
    fireEvent.click(screen.getByRole('button', { name: /h-lib\.jpg/ }))
    expect(assignSlotMock).toHaveBeenCalledWith('artist-1', 'polaroid_1_photo', 'm2')
    // The never-published fallback — the path that still walks the session ledger.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Revert changes' }))
    })
    expect(assignSlotMock).toHaveBeenLastCalledWith('artist-1', 'polaroid_1_photo', null)
    expect(screen.queryByRole('button', { name: 'Revert changes' })).toBeNull()
  })

  it('heads the wall "Custom slots" — where the artist arranges their own photos, not named cards', () => {
    openImages(PHOTOS)
    expect(screen.getByText('Custom slots')).toBeTruthy()
    expect(screen.queryByText(/polaroids/i)).toBeNull()
  })

  it('renders one flat numbered slot per image, across every instance — Slot 1 … Slot N', () => {
    openImages(PHOTOS)
    // 2 instances × 2 slots → Slot 1..4, all empty; no named "Polaroid" cards, no Slot 5.
    expect(screen.getByRole('button', { name: 'Slot 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Slot 4' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Slot 5' })).toBeNull()
    expect(screen.queryByText(/^Polaroid 1$/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull()
  })

  it('placing a photo into Slot 1 writes the role skeen reads (instance 1, first slot)', () => {
    openImages(PHOTOS)
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1' })) // opens the picker
    fireEvent.click(screen.getByRole('button', { name: /h-lib\.jpg/ }))
    expect(assignSlotMock).toHaveBeenCalledWith('artist-1', 'polaroid_1_photo', 'm2')
  })

  it('numbers sequentially ACROSS instances — Slot 3 is instance 2, first slot', () => {
    openImages(PHOTOS)
    fireEvent.click(screen.getByRole('button', { name: 'Slot 3' }))
    fireEvent.click(screen.getByRole('button', { name: /h-lib\.jpg/ }))
    expect(assignSlotMock).toHaveBeenCalledWith('artist-1', 'polaroid_2_photo', 'm2')
  })

  it('a slot-held photo LEAVES the gallery groups', () => {
    // Otherwise a handwriting PNG would show up in the photo collage.
    const held: GalleryPhoto[] = [
      { id: 'mp', storage_path: 'artist-1/gallery/hand.png', onSite: true, orientation: 'horizontal', siteRole: 'polaroid_1_caption' },
      ...PHOTOS,
    ]
    openImages(held)
    // polaroid_1_caption is Slot 2 — it is in its slot (its Edit button is present)...
    expect(screen.getByRole('button', { name: 'Edit Slot 2' })).toBeTruthy()
    // ...and not offered as a horizontal gallery card (only the two real ones are).
    expect(screen.queryByRole('button', { name: 'Edit horizontal photo 3' })).toBeNull()
  })

  it('warns (but does not block) when a PNG-preferring slot holds a non-PNG', () => {
    const jpg: GalleryPhoto[] = [
      { id: 'mj', storage_path: 'artist-1/gallery/hand.jpg', onSite: true, orientation: null, siteRole: 'polaroid_1_caption' },
    ]
    openImages(jpg)
    expect(screen.getByText(/transparent PNG/i)).toBeTruthy()
    // The image is still placed — a warning, not a rejection.
    expect(screen.getByRole('button', { name: 'Edit Slot 2' })).toBeTruthy()
  })

  it('does NOT warn when that slot holds a real PNG', () => {
    const png: GalleryPhoto[] = [
      { id: 'mp', storage_path: 'artist-1/gallery/hand.PNG', onSite: true, orientation: null, siteRole: 'polaroid_1_caption' },
    ]
    openImages(png)
    expect(screen.queryByText(/transparent PNG/i)).toBeNull()
  })

  const HELD_SLOT: GalleryPhoto[] = [
    { id: 'mp', storage_path: 'artist-1/gallery/a.jpg', onSite: true, orientation: null, siteRole: 'polaroid_1_photo' },
  ]

  /** Both polaroid PHOTO slots filled, for cross-item behaviour (styling one, then the
   *  other). Slots are flattened across cards, so card 2's photo is Slot 3 — card 1's
   *  caption is Slot 2. */
  const TWO_SLOTS: GalleryPhoto[] = [
    ...HELD_SLOT,
    { id: 'mq', storage_path: 'artist-1/gallery/b.jpg', onSite: true, orientation: null, siteRole: 'polaroid_2_photo' },
  ]

  it('Edit hands the WHOLE panel to that slot: header "Edit Slot 1", Replace, Remove, controls, Revert', () => {
    openImages(HELD_SLOT)
    // Not editing yet — the wall is shown, not the item editor.
    expect(screen.queryByRole('heading', { name: /^Edit / })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 1' }))
    // The panel is now the item editor for this slot, headed "Edit Slot 1".
    expect(screen.getByRole('heading', { name: 'Edit Slot 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Revert changes/ })).toBeTruthy()
    // The visual controls, keyed by the slot's label.
    expect(screen.getByLabelText('Slot 1 Size')).toBeTruthy()
    expect(screen.getByLabelText('Slot 1 Transparency')).toBeTruthy()
    expect(screen.getByLabelText('Slot 1 Border')).toBeTruthy()
    expect(screen.getByLabelText('Slot 1 Corners')).toBeTruthy()
    expect(screen.getByLabelText('Slot 1 Shadow')).toBeTruthy()
    // The border colour is one compact row by default — clear, the current colour (which
    // opens the palette), and the hex. The mixing surface stays folded away: it is used
    // occasionally but would cost panel height on every visit.
    expect(screen.getByLabelText('Slot 1 Border color hex')).toBeTruthy()
    expect(screen.getByLabelText('Slot 1 Border color palette')).toBeTruthy()
    expect(screen.queryByLabelText('Slot 1 Border color saturation and brightness')).toBeNull()
    expect(screen.queryByLabelText('Slot 1 Border color hue')).toBeNull()
    // Back returns to the wall.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('heading', { name: /^Edit / })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit Slot 1' })).toBeTruthy()
  })

  it('changes are STAGED: paint immediately, persist nothing until Save', async () => {
    const onApplyStyle = vi.fn()
    renderInspector(HELD_SLOT, { components: [POLAROID], onApplyStyle })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 1' }))
    // Nothing staged yet → both exit buttons idle.
    expect((screen.getByRole('button', { name: /Revert changes/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Slot 1 Corners'), { target: { value: '3' } })
    // The frame paints instantly; the DB is untouched.
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'rounded-[6px]')
    expect(saveStyleMock).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(saveStyleMock).toHaveBeenCalledWith('artist-1', 'slot:polaroid_1_photo', 'rounded-[6px]')
    // Saved → clean again.
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Revert restores the last-saved state on the sliders AND the frame, without saving', () => {
    const onApplyStyle = vi.fn()
    renderInspector(HELD_SLOT, { components: [POLAROID], onApplyStyle })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 1' }))
    fireEvent.change(screen.getByLabelText('Slot 1 Corners'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /Revert changes/ }))
    // Repainted back to the saved state ('' — unstyled), nothing written.
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', '')
    expect(saveStyleMock).not.toHaveBeenCalled()
    // Clean again: Back leaves without any Save/Discard question.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Edit Slot 1' })).toBeNull()
  })

  it('backing out with staged changes asks — Discard repaints and leaves, saving nothing', () => {
    const onApplyStyle = vi.fn()
    renderInspector(HELD_SLOT, { components: [POLAROID], onApplyStyle })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 1' }))
    fireEvent.change(screen.getByLabelText('Slot 1 Corners'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    // Still in the editor — the question is up instead.
    expect(screen.getByRole('dialog', { name: 'Save changes to Slot 1?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', '')
    expect(saveStyleMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Edit Slot 1' })).toBeNull()
  })

  it('backing out with staged changes asks — Save & close persists, then leaves', async () => {
    renderInspector(HELD_SLOT, { components: [POLAROID] })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 1' }))
    fireEvent.change(screen.getByLabelText('Slot 1 Corners'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save & close' }))
    })
    expect(saveStyleMock).toHaveBeenCalledWith('artist-1', 'slot:polaroid_1_photo', 'rounded-[6px]')
    expect(screen.queryByRole('heading', { name: 'Edit Slot 1' })).toBeNull()
  })

  /** Open the item editor for the held slot, unfold the palette, and hand back its parts.
   *  jsdom gives every element a zero-sized rect, so the square is measured explicitly —
   *  its geometry is the one thing a component test can't observe for free. */
  function openPalette(onApplyStyle = vi.fn()) {
    renderInspector(HELD_SLOT, { components: [POLAROID], onApplyStyle })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1 Border color palette' }))
    const area = screen.getByLabelText('Slot 1 Border color saturation and brightness')
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
    return {
      onApplyStyle,
      area,
      hue: screen.getByLabelText('Slot 1 Border color hue'),
      hex: screen.getByLabelText('Slot 1 Border color hex'),
    }
  }

  it('the palette opens as a modal and closes on Escape, Done, or the backdrop', () => {
    renderInspector(HELD_SLOT, { components: [POLAROID] })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 1' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const openIt = () => fireEvent.click(screen.getByRole('button', { name: 'Slot 1 Border color palette' }))

    openIt()
    expect(screen.getByRole('dialog', { name: 'Slot 1 Border color palette' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    openIt()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    openIt()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog) // the backdrop itself, not the card
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a colour mixed in the modal applies live, and survives closing it', () => {
    const { onApplyStyle, area, hue } = openPalette()
    fireEvent.change(hue, { target: { value: '240' } })
    fireEvent.pointerDown(area, { clientX: 200, clientY: 0 })
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'border-[#0000ff]')
    // No confirm step: the edit is already applied, so closing just closes.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getByLabelText('Slot 1 Border color hex') as HTMLInputElement).value).toBe('#0000ff')
  })

  it('the palette applies any hex the manager types, with or without the #', () => {
    const { onApplyStyle, hex } = openPalette()
    fireEvent.change(hex, { target: { value: '#123abc' } })
    fireEvent.blur(hex)
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'border-[#123abc]')
    // A bare hex is forgiven, and uppercase is normalised.
    fireEvent.change(hex, { target: { value: 'FFAA00' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'border-[#ffaa00]')
  })

  it('a half-typed hex is left alone rather than applied or destroyed', () => {
    const { onApplyStyle, hex } = openPalette()
    fireEvent.change(hex, { target: { value: '#12' } })
    fireEvent.blur(hex)
    expect(onApplyStyle).not.toHaveBeenCalled()
  })

  it('dragging the saturation/brightness square picks a colour off the palette', () => {
    const { onApplyStyle, area, hue } = openPalette()
    // Hue 240 (blue), then the top-right corner of the square = full saturation, full
    // brightness → pure blue.
    fireEvent.change(hue, { target: { value: '240' } })
    fireEvent.pointerDown(area, { clientX: 200, clientY: 0 })
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'border-[#0000ff]')
    // Drag continues over the window, and left/down darkens + desaturates: the middle of
    // the square at half brightness.
    fireEvent.pointerMove(window, { clientX: 100, clientY: 50 })
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'border-[#404080]')
    // The pointer leaving the square pins rather than jumping.
    fireEvent.pointerMove(window, { clientX: -500, clientY: -500 })
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'border-[#ffffff]')
    // After release the square stops following the pointer.
    fireEvent.pointerUp(window)
    onApplyStyle.mockClear()
    fireEvent.pointerMove(window, { clientX: 10, clientY: 90 })
    expect(onApplyStyle).not.toHaveBeenCalled()
  })

  it('the square is keyboard-operable (arrow keys move saturation and brightness)', () => {
    const { onApplyStyle, area } = openPalette()
    // Opens on red at full saturation + brightness. Down darkens by one 2% step.
    fireEvent.keyDown(area, { key: 'ArrowDown' })
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'border-[#fa0000]')
    // Home is fully desaturated at that brightness.
    fireEvent.keyDown(area, { key: 'Home' })
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'border-[#fafafa]')
  })

  it('the hue slider keeps its position when the colour is dragged to black', () => {
    const { onApplyStyle, area, hue } = openPalette()
    fireEvent.change(hue, { target: { value: '240' } })
    // Bottom of the square = black, which carries no hue of its own.
    fireEvent.pointerDown(area, { clientX: 200, clientY: 100 })
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'border-[#000000]')
    expect((hue as HTMLInputElement).value).toBe('240') // NOT snapped back to red
    // Dragging back up returns to the hue the manager chose, not to red.
    fireEvent.pointerMove(window, { clientX: 200, clientY: 0 })
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'border-[#0000ff]')
  })

  it("offers the SITE'S OWN palette as swatches, ahead of one-off colours", () => {
    // The site declares its colours as classes (`text-flash-1`); only the hex it also
    // declares can be painted as a swatch, because the editor never sees its stylesheet.
    const styleOptions = {
      textColors: [{ value: 'text-flash-1', label: 'Red', hex: '#c63a2a' }],
      bgColors: [{ value: 'bg-cream', label: 'Cream', hex: '#f4f1ea' }],
    }
    renderInspector(HELD_SLOT, {
      components: [POLAROID],
      styleOptions,
      styleValues: { footer: 'border-[#123abc]' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 1' }))
    // The swatches live in the palette modal, under the mixer.
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1 Border color palette' }))
    const swatches = screen
      .getAllByRole('button', { name: /^Slot 1 Border color #/ })
      .map((b) => b.getAttribute('aria-label'))
    // Declared palette first (those are the canonical ones), then the one-off already used.
    expect(swatches).toEqual([
      'Slot 1 Border color #c63a2a',
      'Slot 1 Border color #f4f1ea',
      'Slot 1 Border color #123abc',
    ])
  })

  it('offers the colours the site already uses, most-used first', () => {
    // Matching a colour you picked three sections ago should not mean remembering its hex.
    const styleValues = {
      hero_wordmark: 'text-[#ff0000]',
      'slot:polaroid_2_photo': 'border-[#123abc]',
      footer: 'bg-[#123ABC]', // same colour, different case — one swatch, not two
    }
    const onApplyStyle = vi.fn()
    renderInspector(HELD_SLOT, { components: [POLAROID], styleValues, onApplyStyle })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1 Border color palette' }))
    expect(screen.getByText('On site')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Slot 1 Border color #ff0000' })).toBeTruthy()
    // Clicking one applies it to this item.
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1 Border color #123abc' }))
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'border-[#123abc]')
    expect(screen.queryAllByRole('button', { name: /Border color #123abc/ })).toHaveLength(1)
  })

  it('a colour picked on one item is offered on the NEXT, without a reload', async () => {
    vi.useFakeTimers()
    try {
      renderInspector(TWO_SLOTS, { components: [POLAROID] })
      fireEvent.click(screen.getByRole('button', { name: /Images/ }))
      // Nothing used yet on a site with no saved styles and no declared palette.
      fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 1' }))
      fireEvent.click(screen.getByRole('button', { name: 'Slot 1 Border color palette' }))
      expect(screen.queryByText('On site')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
      const hex = screen.getByLabelText('Slot 1 Border color hex')
      fireEvent.change(hex, { target: { value: '#ff8800' } })
      fireEvent.blur(hex)
      // Staged model: Save first, so Back leaves without the Save/Discard question.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })
      fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      // The used-colour record is DEBOUNCED (recording per drag frame re-rendered the
      // whole inspector at pointer rate), so let it settle before the next item looks.
      act(() => {
        vi.advanceTimersByTime(500)
      })
      // The other photo can now reach for the same colour.
      fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 3' }))
      fireEvent.click(screen.getByRole('button', { name: 'Slot 3 Border color palette' }))
      expect(screen.getByRole('button', { name: 'Slot 3 Border color #ff8800' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the item preview in the pinned header, out of the scrolling body', () => {
    // The controls are what you scroll to; judging a border against an image you have to
    // scroll back up to see is guesswork.
    const { container } = renderInspector(HELD_SLOT, { components: [POLAROID] })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 1' }))
    const header = screen.getByRole('heading', { name: 'Edit Slot 1' }).parentElement!
    expect(header.querySelector('img')).not.toBeNull()
    // And exactly one preview of it — the body no longer carries its own copy.
    expect(container.querySelectorAll(`img[src*="${HELD_SLOT[0].storage_path}"]`)).toHaveLength(1)
  })

  it('None clears the border colour and keeps the other item styles', () => {
    const { onApplyStyle, hex } = openPalette()
    fireEvent.change(screen.getByLabelText('Slot 1 Corners'), { target: { value: '3' } })
    fireEvent.change(hex, { target: { value: '#123abc' } })
    fireEvent.blur(hex)
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'rounded-[6px] border-[#123abc]')
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1 Border color none' }))
    expect(onApplyStyle).toHaveBeenLastCalledWith('slot:polaroid_1_photo', 'rounded-[6px]')
  })

  it('Edit → Remove releases the slot without deleting the photo', () => {
    openImages(HELD_SLOT)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Slot 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(assignSlotMock).toHaveBeenCalledWith('artist-1', 'polaroid_1_photo', null)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('a placed slot is selectable and highlights its region in the frame', () => {
    const onHighlight = vi.fn()
    const held: GalleryPhoto[] = [
      { id: 'mp', storage_path: 'artist-1/gallery/a.jpg', onSite: true, orientation: null, siteRole: 'polaroid_1_photo' },
    ]
    renderInspector(held, { components: [POLAROID], onHighlight })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Slot 1' }))
    // polaroid slots are marked as field regions on the site.
    expect(onHighlight).toHaveBeenCalledWith({ kind: 'field', key: 'polaroid_1_photo' })
  })

  it('hides the collage groups when the site declares no image slot', () => {
    // skeen's About wall is polaroids now — it renders no collage, so an orientation
    // group in the editor would be a place to put work that never appears anywhere.
    renderInspector(PHOTOS, { components: [POLAROID], showGallery: false })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    expect(screen.getByRole('button', { name: 'Slot 1' })).toBeTruthy()
    expect(screen.queryByText('Horizontal')).toBeNull()
    expect(screen.queryByText('Vertical')).toBeNull()
    expect(screen.queryByRole('button', { name: /Add horizontal photo/i })).toBeNull()
  })

  it('says so plainly when the site declares no image slots at all', () => {
    renderInspector(PHOTOS, { showGallery: false })
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    expect(screen.getByText(/no image slots/i)).toBeTruthy()
  })

  it('offers no numbered slots when the site declares no component', () => {
    renderInspector(PHOTOS)
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    expect(screen.queryByRole('button', { name: 'Slot 1' })).toBeNull()
  })
})

describe('EditorInspector — the outdated-bridge flag', () => {
  it('shows a republish note when the connected site is behind', () => {
    renderInspector(PHOTOS, { bridgeOutdated: true })
    expect(screen.getByText(/older version/i)).toBeTruthy()
  })

  it('shows NO note when the site is up to date (not a permanent fixture)', () => {
    renderInspector(PHOTOS, { bridgeOutdated: false })
    expect(screen.queryByText(/older version/i)).toBeNull()
  })
})
