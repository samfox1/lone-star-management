// @vitest-environment jsdom
/**
 * The Profile photo tile shows the + when empty, and a picked image is saved by its id.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/profile/photo-picker.tsx
 * Feature:  Profile page · Profile photo (PROFILE_TOOL_PLAN.md, prototypes/profile_tool_20261001.html
 *           round 3): the round tile and the big Images picker
 * Tier:     LIGHT (AGENTS.md "Test depth"): the UI is new and still moving. One main path.
 * Covers:   the empty tile shows the + inside the circle; picking an image calls the set action
 *           with THAT image's id, closes the picker and shows it in the tile; an upload that
 *           finishes while a pick is still saving is saved next (the later action wins)
 * Not here: the write (tests/unit/manager-tools/profile/profile-photo.test.ts); the upload itself
 *           (the uploader's own tests); looks (screenshots)
 * Fixtures: two library photos. Mocked: the server action, toast, the uploader (it records the
 *           onUploaded it was given, so a test can finish an upload).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ProfilePhotoControl } from '@/app/artists/[id]/(dashboard)/(manager-tools)/profile/photo-picker'
import { setProfilePhotoAction } from '@/app/artists/[id]/(dashboard)/profile-photo-actions'

vi.mock('@/app/artists/[id]/(dashboard)/profile-photo-actions', () => ({ setProfilePhotoAction: vi.fn(async () => ({})) }))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
const uploader: { onUploaded?: (m: { id: string; storage_path: string }) => void } = {}
vi.mock('@/app/artists/[id]/(dashboard)/media-uploader', () => ({
  MediaUploader: (props: { onUploaded?: (m: { id: string; storage_path: string }) => void }) => {
    uploader.onUploaded = props.onUploaded
    return null
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const PHOTOS = [
  { id: 'img-1', path: 'a1/gallery/one.jpg', thumb: 'https://x/one.jpg' },
  { id: 'img-2', path: 'a1/gallery/two.jpg', thumb: 'https://x/two.jpg' },
]

describe('ProfilePhotoControl', () => {
  // Round 3 of the mock: the + sits inside the empty circle.
  it('empty: the tile shows the + inside the circle, no photo', () => {
    render(<ProfilePhotoControl artistId="a1" current={null} photos={PHOTOS} />)
    const tile = screen.getByRole('button', { name: 'Add a profile photo' })
    expect(tile.querySelector('[data-icon="plus"]')).not.toBeNull()
    expect(tile.querySelector('img')).toBeNull()
  })

  // The main path: pick → the action gets that photo's id → the tile shows it.
  it('picking an image calls the set action with its id, closes, and the tile shows it', async () => {
    render(<ProfilePhotoControl artistId="a1" current={null} photos={PHOTOS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a profile photo' }))
    const picks = screen.getAllByRole('button', { name: 'Use this photo' })
    expect(picks).toHaveLength(2)
    await act(async () => {
      fireEvent.click(picks[1])
    })
    expect(setProfilePhotoAction).toHaveBeenCalledTimes(1)
    expect(setProfilePhotoAction).toHaveBeenCalledWith('a1', 'img-2')
    expect(screen.queryByRole('dialog', { name: 'Images' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Change the profile photo' }).querySelector('img')?.getAttribute('src')).toBe('https://x/two.jpg')
  })

  // The upload tile and a pick can overlap: an upload that finishes while a pick is still saving
  // used to land in Images and silently NOT become the profile photo. The later action wins.
  it('an upload that finishes while a pick is saving becomes the profile photo next', async () => {
    let release: (v: { error?: string }) => void = () => {}
    vi.mocked(setProfilePhotoAction).mockImplementationOnce(() => new Promise((r) => (release = r)))
    render(<ProfilePhotoControl artistId="a1" current={null} photos={PHOTOS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a profile photo' }))
    const finishUpload = uploader.onUploaded!
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Use this photo' })[0])
    })
    await act(async () => {
      finishUpload({ id: 'up-1', storage_path: 'a1/gallery/up.jpg' })
    })
    // The pick is still saving: the upload waits its turn rather than being dropped.
    expect(setProfilePhotoAction).toHaveBeenCalledTimes(1)
    await act(async () => {
      release({})
    })
    expect(setProfilePhotoAction).toHaveBeenCalledTimes(2)
    expect(setProfilePhotoAction).toHaveBeenLastCalledWith('a1', 'up-1')
    expect(screen.getByRole('button', { name: 'Change the profile photo' }).querySelector('img')?.getAttribute('src')).toContain('up.jpg')
  })
})
