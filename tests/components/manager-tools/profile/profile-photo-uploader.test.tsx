// @vitest-environment jsdom
/**
 * A profile photo uploaded from the Site & profile page or the editor's tile lands in Images too,
 * then becomes the profile photo by that Images photo's id.
 *
 * Code:     src/app/artists/[id]/(dashboard)/profile-photo-uploader.tsx;
 *           src/app/artists/[id]/(dashboard)/editor/panels/photo-tools.tsx (the Profile photo tile)
 * Feature:  Profile photo (PROFILE_TOOL_PLAN.md, Sam 2026-10-02: "an upload lands in Images too").
 *           These two doors used to upload into `profile/` only, so a replaced photo could never be
 *           picked again: no Revert path brings a profile photo back.
 * Tier:     LIGHT (AGENTS.md "Test depth"): the doors are new UI. One main path per door.
 * Covers:   • the Site & profile page's upload writes an Images row (gallery_image, gallery folder)
 *             and then sets the profile photo by THAT row's id
 *           • the editor's Profile photo tile does the same, and does not write the slot by path
 * Not here: the write itself (tests/unit/manager-tools/profile/profile-photo.test.ts); a file two
 *           rows share surviving a delete (tests/unit/media/storage-gc-shared-file.test.ts) and the
 *           publish sweep (tests/unit/media/storage-gc-media.test.ts); the compression gate on the
 *           editor tile (tests/components/site-editor/editor-upload-gate.test.tsx).
 * Fixtures: the uploader is mocked to a button that reports one finished upload, with the props it
 *           was given recorded; the server actions and the toast are mocked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ProfilePhotoUploader } from '@/app/artists/[id]/(dashboard)/profile-photo-uploader'
import { setProfilePhotoAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/profile/photo-actions'
import { setImageFieldAction } from '@/app/artists/[id]/(dashboard)/actions'
import { EditorInspector } from '@/app/artists/[id]/(dashboard)/editor/editor-inspector'

const uploaderProps: Record<string, unknown>[] = []
vi.mock('@/app/artists/[id]/(dashboard)/media-uploader', () => ({
  MediaUploader: (props: { onUploaded?: (m: { id: string; storage_path: string }) => void }) => {
    uploaderProps.push(props)
    return (
      <button type="button" onClick={() => props.onUploaded?.({ id: 'lib-9', storage_path: 'a1/gallery/new.jpg' })}>
        mock-upload
      </button>
    )
  },
  GallerySlotUploader: () => null,
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/profile/photo-actions', () => ({ setProfilePhotoAction: vi.fn(async () => ({})) }))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions', () => import('@tests/helpers/connections-actions'))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => import('@tests/helpers/editor-actions'))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  uploaderProps.length = 0
})

describe('profile photo uploads land in Images', () => {
  // The Site & profile page: into Images first, then that Images photo becomes the profile photo.
  it('the Site & profile upload writes an Images row, then sets the profile photo by its id', async () => {
    const onSet = vi.fn()
    render(<ProfilePhotoUploader artistId="a1" label="Add photo" onSet={onSet} />)
    expect(uploaderProps.at(-1)).toMatchObject({ artistId: 'a1', purpose: 'gallery_image', folder: 'gallery' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'mock-upload' }))
    })
    expect(setProfilePhotoAction).toHaveBeenCalledWith('a1', 'lib-9')
    expect(onSet).toHaveBeenCalledWith('a1/gallery/new.jpg')
  })

  // The editor's tile: the same door, so a replaced photo stays in Images; never a write by path.
  it('the editor’s Profile photo tile uploads into Images and sets the photo by id', async () => {
    render(
      <EditorInspector
        artistId="a1"
        photos={[]}
        imageFields={[{ key: 'profile_photo', label: 'Profile photo', previewUrl: null, target: { store: 'media', purpose: 'profile_photo' } }]}
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
        imageCollections={[]}
        styleRegions={[]}
        styleValues={{}}
        selectedStyle={null}
        linkRegions={[]}
        selectedLink={null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Images/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Profile photo' }))
    expect(uploaderProps.at(-1)).toMatchObject({ artistId: 'a1', purpose: 'gallery_image', folder: 'gallery' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'mock-upload' }))
    })
    expect(setProfilePhotoAction).toHaveBeenCalledWith('a1', 'lib-9')
    expect(setImageFieldAction).not.toHaveBeenCalled()
  })
})
