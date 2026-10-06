// @vitest-environment jsdom
// Removing the hero image or profile photo from the editor asks first.
/**
 * A filled Set-slot tile (hero image, profile photo) clears its image only after the manager
 * confirms.
 *
 * Code:     src/app/artists/[id]/(dashboard)/editor/panels/photo-tools.tsx (ImageFieldTile)
 * Feature:  Site editor › Images panel › Set slots
 * Tier:     STRICT (AGENTS.md "Test depth"): data that can be lost. Remove nulls
 *           artists.hero_image_url, which has no library to pick the old file from again, or
 *           deletes the profile-photo row, which Revert cannot bring back.
 * Covers:   • a click on the tile, then on Remove, writes nothing until the question is confirmed
 *           • Cancel writes nothing
 * Not here: the confirm dialog itself (tests/components/dashboard/confirm-dialog.test.tsx).
 * Fixtures: setImageFieldAction is mocked; the hero field is a plain object.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PhotoTools } from '@/app/artists/[id]/(dashboard)/editor/panels/photo-tools'
import { setImageFieldAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({ setImageFieldAction: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const HERO = { key: 'hero_image', label: 'Hero image', previewUrl: 'https://x/hero.jpg', target: { store: 'artist', column: 'hero_image_url' } } as const

function renderHero() {
  render(
    <PhotoTools
      photos={[]}
      imageFields={[HERO]}
      focusedKey={null}
      onFocus={vi.fn()}
      onEditItem={vi.fn()}
      components={[]}
      imageCollections={[]}
      artistId="a1"
      onAdd={vi.fn()}
      onPlace={vi.fn()}
      onUnplace={vi.fn()}
      onToggleOnSite={vi.fn()}
      onPlaceSlot={vi.fn()}
    />,
  )
  // A click on the tile opens its Replace / Remove menu over the whole tile (Sam, 2026-10-05:
  // the row is the target), so the second click of a double-click lands on that menu.
  fireEvent.click(screen.getByRole('button', { name: 'Select Hero image' }))
  const remove = screen.getByRole('button', { name: 'Remove Hero image' })
  fireEvent.mouseDown(remove)
  fireEvent.click(remove)
  return screen.getByRole('dialog', { name: 'Remove the hero image?' })
}

describe('removing a Set-slot image', () => {
  // The double-click path: Remove asks, and only Confirm clears the image.
  it('CRITICAL: Remove clears nothing until the question is confirmed', async () => {
    const dialog = renderHero()
    expect(setImageFieldAction).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    })
    expect(setImageFieldAction).toHaveBeenCalledTimes(1)
    expect(setImageFieldAction).toHaveBeenCalledWith('a1', 'hero_image', null, HERO.target)
  })

  // Cancel is a no: the image stays.
  it('Cancel clears nothing', async () => {
    const dialog = renderHero()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    })
    expect(setImageFieldAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
