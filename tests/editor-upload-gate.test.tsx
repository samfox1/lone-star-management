// @vitest-environment jsdom
/**
 * THE EDITOR'S OWN UPLOADERS GO THROUGH THE COMPRESSION GATE.
 *
 * Sam, 2026-08-06: "when users want to upload images/videos/etc through the editor panel
 * instead of through the assets page, I want to make sure these compression modals are in
 * place as well." They were not. The gate shipped wired into `media-uploader.tsx`, while
 * the editor's own hero-image / profile-photo modal hand-assembled the same drop field
 * and skipped it — so the identical oversized photo compressed from one panel and
 * uploaded whole from another.
 *
 * `upload-field-coverage.test.ts` guards the SHAPE (nobody hand-rolls an uploader). This
 * one guards the WIRING end to end: it renders the real inspector, opens the real upload
 * modal, drops a real oversized file, and expects the real proposal. A static check
 * cannot do that — it can see a `budget=` attribute but not whether a budget actually
 * arrives through four components, which is exactly the thread that was broken.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EditorInspector } from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'
import type { EditorImageField } from '@/app/artists/[id]/(dashboard)/editor/inspector-types'
import { DEFAULT_BUDGETS, type AssetBudgets } from '@/lib/site-editor/asset-budget'

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

// jsdom has no canvas; the compressor's own behaviour is covered in compress-image.test.
const compressImageFile = vi.fn<(f: File, b: unknown) => Promise<unknown>>(async () => ({
  file: new File(['small'], 'photo.webp', { type: 'image/webp' }),
  width: 1200,
  height: 900,
  fits: true,
}))
vi.mock('@/lib/site-editor/compress-image', () => ({
  decodeEdgePx: async () => 4000,
  compressImageFile: (f: File, b: unknown) => compressImageFile(f, b),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Skeen's real declared budgets. */
const BUDGETS: AssetBudgets = {
  image: { maxEdgePx: 2000, maxBytes: 800_000, mime: 'image/webp' },
  slots: { polaroid_photo: { maxEdgePx: 1200, maxBytes: 400_000, mime: 'image/webp' } },
}

const IMAGE_FIELDS: EditorImageField[] = [
  { key: 'profile_photo', label: 'Profile photo', previewUrl: null, target: { store: 'media', purpose: 'profile_photo' } },
]

function fatFile(): File {
  const f = new File(['x'], 'huge.jpg', { type: 'image/jpeg' })
  Object.defineProperty(f, 'size', { value: 6_000_000 })
  return f
}

function renderEditor(assetBudgets?: AssetBudgets) {
  return render(
    <EditorInspector
      artistId="artist-1"
      photos={[]}
      imageFields={IMAGE_FIELDS}
      assetBudgets={assetBudgets}
      selectedRegion={null}
      textFields={[]}
      links={[]}
      supportLinks={[]}
      linkValues={{}}
      videos={[]}
      merch={[]}
      releases={[]}
      tours={[]}
      components={[]}
      showGallery={false}
      styleRegions={[]}
      styleValues={{}}
      selectedStyle={null}
      linkRegions={[]}
      selectedLink={null}
    />,
  )
}

/** Open Images → the empty Profile photo slot → its upload modal. */
function openUploadModal() {
  fireEvent.click(screen.getByRole('button', { name: /Images/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Profile photo' }))
}

/** The drop field's hidden <input type=file>, wherever the modal put it. */
function dropFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  expect(input, 'the upload modal rendered a file input').toBeTruthy()
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

describe('uploading an image from the EDITOR panel', () => {
  it('CRITICAL: an oversized file opens the compression proposal', async () => {
    renderEditor(BUDGETS)
    openUploadModal()
    dropFile(fatFile())

    // The proposal, from the editor's own tile — the panel that used to bypass it.
    expect(await screen.findByText(/Make this file site-sized/i)).toBeTruthy()
    await waitFor(() => expect(compressImageFile).toHaveBeenCalled())
    // …and it was measured against the SITE's image budget, not an invented default.
    expect(compressImageFile.mock.calls[0][1]).toEqual(BUDGETS.image)
  })

  it('CRITICAL: with no budgets declared the FLOOR applies — it is never ungated', async () => {
    // This test used to assert the opposite: no declared budgets meant no gate, so an
    // artist on a built-in template (which declare none, as do older skeen builds) had
    // no compression anywhere. Sam, 2026-08-06: "every file that we store has been
    // compressed." The site's own numbers still win where it has them — see the case
    // above, which passes BUDGETS.image, not the floor.
    renderEditor(undefined)
    openUploadModal()
    dropFile(fatFile())

    expect(await screen.findByText(/Make this file site-sized/i)).toBeTruthy()
    await waitFor(() => expect(compressImageFile).toHaveBeenCalled())
    expect(compressImageFile.mock.calls[0][1]).toEqual(DEFAULT_BUDGETS.image)
  })
})
