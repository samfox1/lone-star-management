// @vitest-environment jsdom
/**
 * CLICKING A THING IN THE PREVIEW SELECTS THAT THING IN THE PANEL — for every kind,
 * not just images. And the panel answers back with a highlight.
 *
 * Sam, 2026-08-06: "when I click on the cover art of a song the song should be selected
 * in the left editor panel. When I select the TOUR text, that text should be selected in
 * the left panel. The same goes with selecting stuff in the left panel — there should be
 * a blue outline around the component in the preview."
 *
 * The bridge already carried all of it: skeen marks the TOUR heading (`data-lse-field`)
 * and posts the select; it renders the blue outline on `highlight` and scrolls it into
 * view. The drops were both in THIS inspector: a text-field select fell through the
 * image-only routing (editor-inspector's isImageRegion guard) and died, item selects for
 * track/video/tour_date/merch died the same way, and only the Images panel ever posted a
 * highlight back. These tests pin the router — each select kind lands in its panel — and
 * the return path: selecting in the panel calls onHighlight with the same target the
 * frame would use to find the element.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EditorInspector } from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'
import type {
  EditorProject,
  EditorTextField,
  EditorTour,
  EditorVideo,
} from '@/app/artists/[id]/(dashboard)/editor/inspector-types'
import type { SelectTarget } from '@/lib/site-editor/bridge'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  deleteMediaAction: vi.fn(async () => ({})),
  saveEditorFieldAction: vi.fn(async () => ({ ok: true })),
  saveEditorStyleAction: vi.fn(async () => ({ ok: true })),
  saveEditorLinkAction: vi.fn(async () => ({ ok: true })),
  updateContentAction: vi.fn(async () => ({})),
  setGalleryOnSiteAction: vi.fn(async () => ({})),
  reorderGalleryAction: vi.fn(async () => ({})),
  assignHeroSlotAction: vi.fn(async () => ({})),
  assignComponentSlotAction: vi.fn(async () => ({})),
  setSongsOnSiteAction: vi.fn(async () => ({})),
  setImageFieldAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const TEXT_FIELDS: EditorTextField[] = [
  { key: 'tour_heading', label: 'Tour heading', type: 'text', value: 'TOUR', multiline: false },
  { key: 'about_body', label: 'About', type: 'text', value: 'Words', multiline: true },
]

const PROJECTS: EditorProject[] = [
  {
    key: 'release:r1',
    title: 'Neon Nights',
    cover_url: null,
    kind: 'album',
    songs: [
      { id: 's1', title: 'Opener' },
      { id: 's2', title: 'Deep Cut' },
    ],
    onSite: true,
  },
  {
    key: 'release:r2',
    title: 'Loose Single',
    cover_url: null,
    kind: 'single',
    songs: [{ id: 's3', title: 'Wanderer' }],
    onSite: true,
  },
]

const VIDEOS: EditorVideo[] = [
  { id: 'v1', title: 'Live at Mohawk', provider: 'youtube', isShort: false, siteRole: null, poster: null, previewUrl: null, onSite: true } as unknown as EditorVideo,
]

const TOURS: EditorTour[] = [
  { id: 'td1', date: '2026-09-01', venue: 'Mohawk', city: 'Austin', state: 'TX', country: null, support: [], onSite: true },
]

function renderInspector(over: Partial<React.ComponentProps<typeof EditorInspector>> = {}) {
  const onHighlight = vi.fn<(t: SelectTarget) => void>()
  const onClearHighlight = vi.fn()
  const utils = render(
    <EditorInspector
      artistId="artist-1"
      photos={[]}
      imageFields={[]}
      selectedRegion={null}
      textFields={TEXT_FIELDS}
      links={[]}
      supportLinks={[]}
      linkValues={{}}
      videos={VIDEOS}
      merch={[]}
      releases={PROJECTS}
      tours={TOURS}
      components={[]}
      showGallery={false}
      styleRegions={[]}
      styleValues={{}}
      selectedStyle={null}
      linkRegions={[]}
      selectedLink={null}
      onHighlight={onHighlight}
      onClearHighlight={onClearHighlight}
      {...over}
    />,
  )
  return { ...utils, onHighlight, onClearHighlight }
}

const select = (target: SelectTarget, nonce = 1) => ({ target, nonce })

describe('frame select → the matching panel', () => {
  it('CRITICAL: clicking the TOUR text in the preview opens that field in the Text panel', () => {
    // The named case. skeen posts {kind:'field', key:'tour_heading'}; before this router
    // the inspector dropped it because the key is not an image region.
    renderInspector({ selectedRegion: select({ kind: 'field', key: 'tour_heading' }) })

    // The field EDITOR is open — its "Edit <label>" heading, not merely the Text list.
    expect(screen.getByRole('heading', { name: /Edit tour heading/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /all text|back/i })).toBeTruthy()
  })

  it('CRITICAL: clicking a song in the preview opens Music with its project expanded', () => {
    // The other named case: cover art on the site is a track item. The song lives inside
    // a project card, so "selected in the panel" means the owning project's tracklist is
    // open with the song visible.
    renderInspector({ selectedRegion: select({ kind: 'item', assetType: 'track', id: 's2' }) })

    // The card face's aria-label is "<title> — <n> songs"; the on/off toggle is a
    // separate button whose label also contains the title, so match the face precisely.
    expect(screen.getByRole('button', { name: /Neon Nights — / })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Deep Cut')).toBeTruthy()
  })

  it('a video item select opens the Videos panel', () => {
    renderInspector({ selectedRegion: select({ kind: 'item', assetType: 'video', id: 'v1' }) })
    // The panel's own furniture (its background-slot section) — titles render in
    // editable inputs, so a text query can't see them.
    expect(screen.getByText('Landing page')).toBeTruthy()
    expect(screen.getByDisplayValue('Live at Mohawk')).toBeTruthy()
  })

  it('a tour_date item select opens the Tour panel', () => {
    renderInspector({ selectedRegion: select({ kind: 'item', assetType: 'tour_date', id: 'td1' }) })
    expect(screen.getByText(/Mohawk/)).toBeTruthy()
  })

  it('an unknown select kind still routes nowhere — no crash, no wrong panel', () => {
    // A future skeen may mark something this build has no panel for; the router must
    // drop it exactly as the old code did, not throw or misfile it.
    renderInspector({ selectedRegion: select({ kind: 'item', assetType: 'mystery' as never, id: 'x' }) })
    expect(screen.getByRole('button', { name: /Images/ })).toBeTruthy() // still the browse list
  })
})

describe('panel selection → highlight in the frame', () => {
  it('CRITICAL: a frame select highlights the SAME target back (outline follows selection)', () => {
    // The outline in the preview is drawn by skeen on `highlight` — the frame's own
    // select does not outline anything. So routing without highlighting leaves the
    // manager with a panel that moved and a preview that shows nothing selected.
    const { onHighlight } = renderInspector({
      selectedRegion: select({ kind: 'field', key: 'tour_heading' }),
    })
    expect(onHighlight).toHaveBeenCalledWith({ kind: 'field', key: 'tour_heading' })
  })

  it('CRITICAL: opening a text field FROM THE PANEL posts its highlight', () => {
    // Panel → preview, the direction Sam described second. Text panel → tap the field.
    const { onHighlight } = renderInspector()
    fireEvent.click(screen.getByRole('button', { name: /Text/ }))
    fireEvent.click(screen.getByRole('button', { name: /Tour heading/ }))
    expect(onHighlight).toHaveBeenCalledWith({ kind: 'field', key: 'tour_heading' })
  })

  it('CRITICAL: selecting a song in the Music panel posts its item highlight', () => {
    const { onHighlight } = renderInspector()
    fireEvent.click(screen.getByRole('button', { name: /Music/ }))
    fireEvent.click(screen.getByRole('button', { name: /Neon Nights — / })) // expand the project
    fireEvent.click(screen.getByRole('button', { name: /Deep Cut/ })) // the song row
    expect(onHighlight).toHaveBeenCalledWith({ kind: 'item', assetType: 'track', id: 's2' })
  })

  it('closing the text editor clears the highlight', () => {
    const { onClearHighlight } = renderInspector({
      selectedRegion: select({ kind: 'field', key: 'tour_heading' }),
    })
    fireEvent.click(screen.getByRole('button', { name: /All text|Back/i }))
    expect(onClearHighlight).toHaveBeenCalled()
  })
})

describe('a routed select is VISIBLE where it lands', () => {
  // jsdom implements no scrollIntoView; the spy IS the assertion surface.
  const scrollSpy = vi.fn()
  beforeEach(() => {
    Element.prototype.scrollIntoView = scrollSpy
  })

  it('CRITICAL: a polaroid select scrolls its slot tile into view', () => {
    // Sam, 2026-08-06: "the images on the polaroid, when clicked, dont bring it up in
    // the side panel." The tile DID ring — off-screen, at the bottom of a long panel,
    // where a ring nobody can see is indistinguishable from a dropped select.
    renderInspector({
      components: [{ key: 'polaroid', label: 'Polaroid', count: 5, slots: [{ key: 'photo', label: 'Photo' }] }],
      // The slot must be FILLED: an empty slot renders a drop target with nothing to
      // ring, and the click Sam described lands on a photo that exists.
      photos: [{ id: 'p3', storage_path: 'artist-1/gallery/p3.jpg', onSite: true, orientation: 'horizontal', siteRole: 'polaroid_3_photo' }],
      selectedRegion: select({ kind: 'field', key: 'polaroid_3_photo' }),
    })
    // Slots number sequentially across instances: polaroid_3_photo is Slot 3.
    expect(screen.getByRole('button', { name: 'Select Slot 3' }).getAttribute('aria-pressed')).toBe('true')
    expect(scrollSpy).toHaveBeenCalled()
  })

  it('CRITICAL: a social-button select opens Links with ITS row open and current', () => {
    // Sam, 2026-08-06: "I should also see the editor responding to … the socials
    // buttons." skeen posts item:link:<label lowercased> — the label, because the row id
    // never reaches the deployed site; this side re-joins on the identical
    // normalization, so "Apple Music" finds "apple music" and case never splits them.
    const { onHighlight } = renderInspector({
      links: [
        { id: 'l1', label: 'Instagram', url: 'https://ig', onSite: true },
        { id: 'l2', label: 'Spotify', url: 'https://sp', onSite: true },
      ],
      selectedRegion: select({ kind: 'item', assetType: 'link', id: 'instagram' }),
    })
    const row = document.querySelector('[aria-current="true"]')
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('Instagram')
    expect(row!.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true')
    expect(scrollSpy).toHaveBeenCalled()
    // …and the outline follows: the same target goes back as the highlight.
    expect(onHighlight).toHaveBeenCalledWith({ kind: 'item', assetType: 'link', id: 'instagram' })
  })

  it('CRITICAL: a video select marks its card current and scrolls to it', () => {
    // The Videos panel had no focus affordance at all — a routed select opened the
    // panel and showed nothing selected.
    renderInspector({ selectedRegion: select({ kind: 'item', assetType: 'video', id: 'v1' }) })
    const current = document.querySelector('[aria-current="true"]')
    expect(current).not.toBeNull()
    // The card's face is a thumbnail + a title INPUT — no text content — so the label
    // carries its identity.
    expect(current!.getAttribute('aria-label')).toMatch(/Video slot/)
    expect(scrollSpy).toHaveBeenCalled()
  })
})
