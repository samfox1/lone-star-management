// @vitest-environment jsdom
/**
 * The Site panel (cursor + trail). Pins the save loop's honesty: an optimistic
 * change paints the frame immediately, a confirmed save stays, and a REFUSED save
 * reverts both the panel and the frame — the failure the code comment warns about
 * ("an optimistic cursor the save refused would look applied right up until the
 * next full refresh dropped it") had no test until the 2026-08-11 review.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SiteTools } from '@/app/artists/[id]/(dashboard)/editor/panels/site-tools'
import { saveCursorFieldAction } from '@/app/artists/[id]/(dashboard)/actions'
import { CURSOR_CONTENT_KEYS, type CursorSettings } from '@samfox1/site-bridge/cursor'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveCursorFieldAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/media-uploader', () => ({
  GallerySlotUploader: () => null,
}))

const saveMock = vi.mocked(saveCursorFieldAction)
const NO_VALUES = Object.fromEntries(Object.values(CURSOR_CONTENT_KEYS).map((k) => [k, '']))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPanel(applied: CursorSettings[]) {
  return render(
    <SiteTools
      artistId="artist-1"
      photos={[]}
      values={NO_VALUES}
      onApplyCursor={(s) => applied.push(s)}
    />,
  )
}

describe('SiteTools — the save loop', () => {
  it('a confirmed save paints optimistically and stays', async () => {
    const applied: CursorSettings[] = []
    renderPanel(applied)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Trail style: Dots' }))
    })
    expect(saveMock).toHaveBeenCalledWith('artist-1', CURSOR_CONTENT_KEYS.trail, 'dots')
    expect(applied.at(-1)?.trail).toBe('dots')
    expect(screen.getByRole('button', { name: 'Trail style: Dots' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Saved')).toBeTruthy()
  })

  it('CRITICAL: a REFUSED save reverts the panel AND the frame', async () => {
    saveMock.mockResolvedValueOnce({ ok: false, error: 'nope' })
    const applied: CursorSettings[] = []
    renderPanel(applied)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Trail style: Dots' }))
    })
    // The optimistic paint happened — and the LAST paint undid it.
    expect(applied.some((s) => s.trail === 'dots')).toBe(true)
    expect(applied.at(-1)?.trail).toBe('')
    expect(screen.getByRole('button', { name: 'Trail style: Dots' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Save failed')).toBeTruthy()
  })

  it("CRITICAL: one key's failure does not roll back another key's committed value", async () => {
    // The first draft snapshotted the WHOLE map, so a slow failure on key A reverted a
    // concurrent success on key B — panel and preview then disagreed with the DB.
    let failTrail!: (v: { ok: boolean; error?: string }) => void
    saveMock.mockImplementation((_a, key) =>
      key === CURSOR_CONTENT_KEYS.trail
        ? new Promise((resolve) => { failTrail = resolve })
        : Promise.resolve({ ok: true }),
    )
    const applied: CursorSettings[] = []
    render(
      <SiteTools
        artistId="artist-1"
        photos={[]}
        values={{ ...NO_VALUES, [CURSOR_CONTENT_KEYS.image]: 'https://x.test/c.png' }}
        onApplyCursor={(s) => applied.push(s)}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Trail style: Line' })) // hangs, will fail
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Cursor' })) // a DIFFERENT key, commits
    })
    expect(applied.at(-1)?.image).toBe('')
    await act(async () => {
      failTrail({ ok: false, error: 'nope' })
    })
    // The trail reverted; the removed cursor image did NOT come back.
    expect(applied.at(-1)?.trail).toBe('')
    expect(applied.at(-1)?.image).toBe('')
  })
})
