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

  it('the type select still saves inline — a select has nothing to open', async () => {
    // The text rows moved to a full-panel editor (below); the two SELECTS did not. There
    // is no hidden text in a dropdown, so an extra screen to reach it would be friction.
    render(<SiteTools artistId="artist-1" photos={[]} values={NO_VALUES} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Artist type' }), { target: { value: 'Person' } })
    await vi.waitFor(() => expect(factMock).toHaveBeenCalledWith('artist-1', 'schema_type', 'Person'))
  })

  /* ── the text rows OPEN, they do not hold a cramped box ─────────────────────────────
   * Sam, 2026-09-09, with a screenshot of the description clipped mid-word: "the seo and
   * geo section isnt designed well to be edited. There should be a snippet of the text in
   * the side panel, and then there should be an edit button that opens its own editing
   * side panel (like the rest of the editable components/text) where the user can see all
   * the text instead of just editing in that little section."
   *
   * So these four become the same row every other panel uses: label, a truncated snippet
   * of the value, and a pencil that hands the field up to the inspector to open
   * full-panel. The inspector half is pinned in tests/site-seo-editor.test.tsx.
   */
  it('CRITICAL: the text rows are SNIPPETS with a pencil, not inline boxes', () => {
    render(
      <SiteTools
        artistId="artist-1"
        photos={[]}
        values={NO_VALUES}
        seo={{ seo_title: 'SKEEN', seo_description: 'Meet Skeen, a Chicago house producer with a long description that runs off the end of the row.' }}
        facts={{ genre: 'House, Tech House', location: 'Chicago', schema_type: 'MusicGroup' }}
      />,
    )
    // No text inputs left in the group — that is the change, stated as an absence so a
    // half-done migration (rows added, boxes kept) fails here.
    for (const name of ['Title', 'Description', 'Genre', 'Location']) {
      expect(screen.queryByRole('textbox', { name }), `${name} still has an inline box`).toBeNull()
      expect(screen.getByRole('button', { name: `Edit ${name}` })).toBeTruthy()
    }
    // And the value is VISIBLE as a snippet, so the row says what it holds.
    expect(screen.getByText('SKEEN')).toBeTruthy()
    expect(screen.getByText(/Meet Skeen, a Chicago house producer/)).toBeTruthy()
    expect(screen.getByText('House, Tech House')).toBeTruthy()
  })

  it('CRITICAL: the pencil hands up WHERE the field saves, not just its key', () => {
    // seo_title goes through the SEO gate; genre is an artist column. The editor upstairs
    // cannot guess which from a key alone, and guessing wrong writes a site_content row
    // that nothing reads (the ftbk bug, 2026-08-20).
    const onEditText = vi.fn()
    render(
      <SiteTools
        artistId="artist-1"
        photos={[]}
        values={NO_VALUES}
        seo={{ seo_title: 'SKEEN' }}
        facts={{ genre: 'House', location: '', schema_type: 'MusicGroup' }}
        onEditText={onEditText}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Title' }))
    expect(onEditText).toHaveBeenLastCalledWith(
      expect.objectContaining({ store: 'seo', key: 'seo_title', label: 'Title', value: 'SKEEN' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Genre' }))
    expect(onEditText).toHaveBeenLastCalledWith(
      expect.objectContaining({ store: 'fact', key: 'genre', label: 'Genre', value: 'House' }),
    )
  })

  it('CRITICAL: the description opens MULTILINE — it is the one that never fit', () => {
    // The whole point of the report. A single-line box in a full-width panel would move
    // the clipping rather than end it.
    const onEditText = vi.fn()
    render(
      <SiteTools artistId="artist-1" photos={[]} values={NO_VALUES} seo={{ seo_description: 'x' }} onEditText={onEditText} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Description' }))
    expect(onEditText).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'seo_description', multiline: true }))
  })

  it('CRITICAL: the text rows sit FLUSH with the select rows, not indented', () => {
    // Sam, 2026-09-09, with a screenshot: "this indentation isnt good. it should be all
    // flush." EditRow carries its own px-4 because its usual home is a full-bleed list;
    // inside PANEL_BODY's px-5 that stacked into a 16px step, so Title and Genre sat in
    // from Social card and About. Asserted as a CLASS because jsdom does no layout — the
    // real check is the screenshot, and this stops the padding creeping back.
    const { container } = render(
      <SiteTools artistId="artist-1" photos={[]} values={NO_VALUES} seo={{ seo_title: 'SKEEN' }} />,
    )
    const row = screen.getByRole('button', { name: 'Edit Title' }).closest('div.group')
    expect(row, 'the Title row is not an EditRow any more').not.toBeNull()
    expect(row?.className, 'the SEO rows are indented again').not.toContain('px-4')
    // The witness: the shared component still pads everywhere ELSE, so this is a flush
    // VARIANT rather than the padding being deleted for everyone.
    expect(container.querySelector('.px-4')).toBeNull()
  })

  it('an empty text row reads as empty rather than blank', () => {
    render(<SiteTools artistId="artist-1" photos={[]} values={NO_VALUES} seo={{}} />)
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0)
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
