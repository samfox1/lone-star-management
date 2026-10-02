// @vitest-environment jsdom
/**
 * The Profile photo tile shows the + when empty, and a picked image is saved by its id.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/profile/photo-picker.tsx
 * Feature:  Profile page · Profile photo (PROFILE_TOOL_PLAN.md, prototypes/profile_tool_20261001.html
 *           round 3): the round tile and the big Images picker
 * Tier:     LIGHT (AGENTS.md "Test depth"): the UI is new and still moving. One main path.
 * Covers:   the empty tile shows the + inside the circle; picking an image calls the set action
 *           with THAT image's id, closes the picker and shows it in the tile
 * Not here: the write (tests/unit/manager-tools/profile/profile-photo.test.ts); the upload path
 *           (the uploader's own tests); looks (screenshots)
 * Fixtures: two library photos. Mocked: the server action, toast, the uploader.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ProfilePhotoControl } from '@/app/artists/[id]/(dashboard)/(manager-tools)/profile/photo-picker'
import { setProfilePhotoAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/profile/photo-actions'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/profile/photo-actions', () => ({ setProfilePhotoAction: vi.fn(async () => ({})) }))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/media-uploader', () => ({ MediaUploader: () => null }))

afterEach(cleanup)

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
})
