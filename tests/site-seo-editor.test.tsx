// @vitest-environment jsdom
/**
 * A SEO/GEO TEXT FIELD OPENS FULL-PANEL, LIKE EVERY OTHER TEXT FIELD.
 *
 * Sam, 2026-09-09, with a screenshot of the description clipped mid-word: "the seo and
 * geo section isnt designed well to be edited. There should be a snippet of the text in
 * the side panel, and then there should be an edit button that opens its own editing side
 * panel (like the rest of the editable components/text) where the user can see all the
 * text instead of just editing in that little section."
 *
 * The panel half — snippet rows and what the pencil hands up — is pinned in
 * tests/site-tools.test.tsx. This is the half above it: the inspector opening the SAME
 * editor the Text panel opens, and routing the save to the right place. Those are two
 * different places (`saveSeoFieldAction` for seo_*, `saveArtistFactAction` for the artist
 * columns), which is exactly why the descriptor carries `store` rather than a bare key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EditorInspector } from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'
import { saveArtistFactAction, saveSeoFieldAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/media-uploader', () => ({ GallerySlotUploader: () => null, MediaUploader: () => null }))
// Listed rather than proxied: vitest validates a module mock's shape at collection time,
// and a Proxy answers `has` for everything including the ESM interop probes.
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveSeoFieldAction: vi.fn(async () => ({ ok: true })),
  saveArtistFactAction: vi.fn(async () => ({ ok: true })),
  saveCursorFieldAction: vi.fn(async () => ({ ok: true })),
  saveEditorFieldAction: vi.fn(async () => ({})),
  saveEditorStyleAction: vi.fn(async () => ({ ok: true })),
  saveEditorLinkAction: vi.fn(async () => ({ ok: true })),
  deleteMediaAction: vi.fn(async () => ({})),
  reorderGalleryAction: vi.fn(async () => ({})),
  updateContentAction: vi.fn(async () => ({})),
  deleteContentAction: vi.fn(async () => ({})),
  reorderContentAction: vi.fn(async () => ({})),
  renameVideoAction: vi.fn(async () => ({})),
  setOnSiteAction: vi.fn(async () => ({})),
  placeGalleryPhotoAction: vi.fn(async () => ({})),
  setMediaLabelAction: vi.fn(async () => ({})),
  setMediaAltAction: vi.fn(async () => ({})),
  setMediaKindAction: vi.fn(async () => ({})),
  renameMediaAction: vi.fn(async () => ({})),
  setSupportUrlAction: vi.fn(async () => ({})),
  assignHeroSlotAction: vi.fn(async () => ({})),
  assignComponentSlotAction: vi.fn(async () => ({})),
  setSongsOnSiteAction: vi.fn(async () => ({})),
  setImageFieldAction: vi.fn(async () => ({ ok: true })),
  addContentAction: vi.fn(async () => ({})),
  restorePublishedAction: vi.fn(async () => ({ ok: true, changed: 0, hasPublished: true })),
  listPublishMomentsAction: vi.fn(async () => ({ ok: true, moments: [] })),
}))

const seoMock = vi.mocked(saveSeoFieldAction)
const factMock = vi.mocked(saveArtistFactAction)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const LONG =
  'Meet Skeen, a Chicago house producer whose records run long enough that a 200px input shows about a fifth of one.'

function openSite(over: Record<string, unknown> = {}) {
  render(
    <EditorInspector
      artistId="artist-1"
      photos={[]}
      seoValues={{ seo_title: 'SKEEN', seo_description: LONG }}
      artistFacts={{ genre: 'House, Tech House', location: 'Chicago', schema_type: 'MusicGroup' }}
      {...over}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Site' }))
}

describe('the SEO description opens in the full editor', () => {
  it('CRITICAL: the pencil opens a box holding the WHOLE value', () => {
    // The report, in one assertion. The snippet is truncated by design; the editor is not.
    openSite()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Description' }))
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(box.value).toBe(LONG)
    expect(box.tagName, 'a single-line input would move the clipping, not end it').toBe('TEXTAREA')
  })

  it('CRITICAL: typing saves through the SEO gate', async () => {
    openSite()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Description' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A shorter description.' } })
    await vi.waitFor(() =>
      expect(seoMock).toHaveBeenCalledWith('artist-1', 'seo_description', 'A shorter description.'),
    )
  })

  it('CRITICAL: an ARTIST FACT saves to the artist, never through the SEO gate', () => {
    // The half that makes `store` load-bearing. Routing genre through saveSeoFieldAction
    // would write a site_content row nothing reads and the fact sheet would never change.
    openSite()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Genre' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Techno' } })
    return vi.waitFor(() => {
      expect(factMock).toHaveBeenCalledWith('artist-1', 'genre', 'Techno')
      expect(seoMock).not.toHaveBeenCalled()
    })
  })

  it('CRITICAL: going back shows the panel again, with the NEW value in the snippet', async () => {
    // Without this the row would still read the draft the page was rendered with, so an
    // edit would appear to have done nothing until a refresh.
    openSite()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Title' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'SKEEN — live' } })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByRole('button', { name: 'Edit Title' })).toBeTruthy()
    expect(screen.getByText('SKEEN — live')).toBeTruthy()
  })

  it('the title opens single-line — only the description is a paragraph', () => {
    openSite()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Title' }))
    expect((screen.getByRole('textbox') as HTMLElement).tagName).toBe('INPUT')
  })
})
