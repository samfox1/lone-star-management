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
import { saveArtistFactAction, saveCursorFieldAction, saveSeoFieldAction } from '@/app/artists/[id]/(dashboard)/actions'
import { ABOUT_PLACEMENTS } from '@samfox1/site-bridge/seo'
import { CURSOR_CONTENT_KEYS, type CursorSettings } from '@samfox1/site-bridge/cursor'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveCursorFieldAction: vi.fn(async () => ({ ok: true })),
  saveSeoFieldAction: vi.fn(async () => ({ ok: true })),
  saveArtistFactAction: vi.fn(async () => ({ ok: true })),
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
    // A successful draft write is SILENT now (Sam, 2026-08-14). The state that proves it
    // landed is the persisted call + the paint above; only a failure speaks (next test).
    expect(screen.queryByText('Saved')).toBeNull()
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

describe('SiteTools — SEO / GEO group (SEO_GEO_PLAN B6)', () => {
  const seoMock = vi.mocked(saveSeoFieldAction)
  const factMock = vi.mocked(saveArtistFactAction)

  it("CRITICAL: typing a title saves through the SEO gate, not the generic field path", async () => {
    render(<SiteTools artistId="artist-1" photos={[]} values={NO_VALUES} seo={{ seo_title: '' }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'SKEEN' } })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('artist-1', 'seo_title', 'SKEEN'))
  })

  it('genre and location save to the ARTIST, and the type select too', async () => {
    render(<SiteTools artistId="artist-1" photos={[]} values={NO_VALUES} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Genre' }), { target: { value: 'House' } })
    await vi.waitFor(() => expect(factMock).toHaveBeenCalledWith('artist-1', 'genre', 'House'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Artist type' }), { target: { value: 'Person' } })
    await vi.waitFor(() => expect(factMock).toHaveBeenCalledWith('artist-1', 'schema_type', 'Person'))
  })

  it("CRITICAL: About offers only what the site declares, plus hidden — and 'Site default' names the site's default", async () => {
    render(<SiteTools artistId="artist-1" photos={[]} values={NO_VALUES} about={{ placements: ['page'], default: 'page' }} />)
    const select = screen.getByRole('combobox', { name: 'About placement' }) as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['', 'page', 'hidden'])
    expect(select.options[0].textContent).toContain('Its own page')
    fireEvent.change(select, { target: { value: 'hidden' } })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('artist-1', 'about_placement', 'hidden'))
  })

  it('a site that declares nothing about its bio offers hidden only', () => {
    render(<SiteTools artistId="artist-1" photos={[]} values={NO_VALUES} about={null} />)
    const select = screen.getByRole('combobox', { name: 'About placement' }) as HTMLSelectElement
    expect([...select.options].map((o) => o.value).filter(Boolean)).toEqual(['hidden'])
    // Registry-derived: every placement is either offered or explicitly gated.
    expect(ABOUT_PLACEMENTS).toContain('hidden')
  })

  it('Bio opens the text editor', () => {
    const onEditBio = vi.fn()
    render(<SiteTools artistId="artist-1" photos={[]} values={NO_VALUES} onEditBio={onEditBio} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit bio' }))
    expect(onEditBio).toHaveBeenCalled()
  })
})
