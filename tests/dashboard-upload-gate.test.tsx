// @vitest-environment jsdom
/**
 * THE DASHBOARD'S OWN UPLOADERS GO THROUGH THE COMPRESSION GATE.
 *
 * Sam, 2026-08-06: "I just added an image and I saw no compression… we should add the
 * compression to the assets dashboard pages so every file that we store has been
 * compressed."
 *
 * He was right, and the reason is structural. The gate fires only when a budget reaches
 * it, and budgets are declared in the SITE's manifest — which arrives over the editor's
 * frame bridge and exists nowhere else. So the Photos page, the Media panel and the Brand
 * logos passed no budget at all (`media-uploader.tsx` even documented it: "the dashboard
 * pages have no manifest in scope"), and every artist on a built-in template had no
 * budgets anywhere. A 12MB phone photo went to storage whole and shipped to every visitor
 * forever, while the identical photo placed from the editor of a custom site compressed.
 *
 * `withFloor` is the fix and `asset-budget.test.ts` pins its numbers. THIS suite pins the
 * WIRING: the real Photos-page button and the real Brand logo field, opened and dropped
 * on, with no budget prop anywhere in sight — and the file that reaches storage is the
 * small one. A static check can see `kind="image"`; only this can see a budget arriving
 * through four components that never mention one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PhotoAddButton } from '@/app/artists/[id]/(dashboard)/images/photo-add'
import { LogoUpload } from '@/app/artists/[id]/(dashboard)/brand/logo-upload'
import { DEFAULT_BUDGETS } from '@/lib/site-editor/asset-budget'

// The file that actually reaches storage — the whole point of the gate is which one.
const upload = vi.fn<(f: File) => Promise<void>>(async () => {})
vi.mock('@/app/artists/[id]/(dashboard)/use-storage-upload', () => ({
  useStorageUpload: () => ({ busy: false, error: null, progress: null, upload, reset: vi.fn() }),
}))

vi.mock('@/app/artists/[id]/(dashboard)/brand/actions', () => ({
  setBrandAssetAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

// jsdom has no canvas; compress-image.test.ts covers the real pipeline. Here the subject
// is whether it is CALLED, and with what budget.
const compressImageFile = vi.fn<(f: File, b: unknown) => Promise<unknown>>(async () => ({
  file: SMALL,
  width: 2400,
  height: 1800,
  fits: true,
}))
vi.mock('@/lib/site-editor/compress-image', () => ({
  // Per FILE, not a constant: the fixtures differ in dimensions as well as bytes, and a
  // fixed 4032 here would make the "web-sized photo passes untouched" case impossible to
  // write — every photo would be over the edge cap.
  decodeEdgePx: async (f: File) => EDGE_PX[f.name],
  compressImageFile: (f: File, b: unknown) => compressImageFile(f, b),
}))

/** Longest edge per fixture, as a real decode would report it. */
const EDGE_PX: Record<string, number> = { 'IMG_4021.jpg': 4032, 'crop.jpg': 1600 }

const SMALL = new File(['small'], 'photo.webp', { type: 'image/webp' })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** A 12MB phone photo, without allocating 12MB. */
function phonePhoto(): File {
  const f = new File(['x'], 'IMG_4021.jpg', { type: 'image/jpeg' })
  Object.defineProperty(f, 'size', { value: 12_000_000 })
  return f
}

/** A web-sized crop that needs no help. */
function webPhoto(): File {
  const f = new File(['x'], 'crop.jpg', { type: 'image/jpeg' })
  Object.defineProperty(f, 'size', { value: 240_000 })
  return f
}

function dropFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  expect(input, 'the uploader rendered a file input').toBeTruthy()
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

/** The Photos page's "+ Add" → its modal, which is the exact path Sam used. */
function openPhotosAdd() {
  render(<PhotoAddButton artistId="a1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Add photo' }))
}

describe('adding a photo on the PHOTOS page', () => {
  it('CRITICAL: an oversized image opens the compression proposal', async () => {
    openPhotosAdd()
    dropFile(phonePhoto())

    expect(await screen.findByText(/Make this file site-sized/i)).toBeTruthy()
    await waitFor(() => expect(compressImageFile).toHaveBeenCalled())
    // Measured against the floor — the page passes no budget and has no manifest to read.
    expect(compressImageFile.mock.calls[0][1]).toEqual(DEFAULT_BUDGETS.image)
  })

  it('CRITICAL: the file that reaches storage is the COMPRESSED one', async () => {
    // The half that actually saves the bytes. A gate that shows the modal and then
    // uploads the original is the same bug with a reassuring dialog in front of it.
    openPhotosAdd()
    dropFile(phonePhoto())

    fireEvent.click(await screen.findByRole('button', { name: /Compress & upload/i }))
    await waitFor(() => expect(upload).toHaveBeenCalledWith(SMALL))
  })

  it('a web-sized photo uploads untouched, with no modal', async () => {
    // The floor must not put a dialog in front of every upload — a photo already fit for
    // the site is the common case, and friction there is what makes managers stop using
    // the tool.
    openPhotosAdd()
    dropFile(webPhoto())

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    expect(upload.mock.calls[0][0].name).toBe('crop.jpg')
    expect(screen.queryByText(/Make this file site-sized/i)).toBeNull()
    expect(compressImageFile).not.toHaveBeenCalled()
  })
})

describe('uploading a logo on the BRAND page', () => {
  it('CRITICAL: the second dashboard door compresses too', async () => {
    // A second real call site, because the floor lives in UploadField and the claim is
    // that EVERY dashboard image door inherits it — not that one page was patched.
    render(
      <LogoUpload artistId="a1" purpose="logo_primary" label="Primary logo" hint="h" currentUrl={null} />,
    )
    dropFile(phonePhoto())

    expect(await screen.findByText(/Make this file site-sized/i)).toBeTruthy()
    await waitFor(() => expect(compressImageFile).toHaveBeenCalledWith(expect.anything(), DEFAULT_BUDGETS.image))
  })
})
