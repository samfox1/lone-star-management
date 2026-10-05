// @vitest-environment jsdom
// The lineup on a tour date: click an act to edit its name and website, the + to add one.
/**
 * SupportActs, the LINEUP row, on the click-to-edit list (Sam, 2026-10-05). At rest each act
 * is its name alone; its website shows only once the act is clicked open, as a second line
 * beside the name. Every change is ONE call carrying the whole lineup (names + links), so the
 * server never sees a name without its link.
 *
 *   - Edit: click an act → name and website lines → Enter saves both, order kept;
 *   - Add: the bare + → name and website lines → the lineup with the new act appended;
 *   - Remove: the open act's trash → the lineup without it;
 *   - a refused save says why and KEEPS what was typed (the website is the usual refusal).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SupportActs } from '@/app/artists/[id]/(dashboard)/tour/support-acts'
import { setSupportActsAction } from '@/app/artists/[id]/(dashboard)/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  setSupportActsAction: vi.fn(async (_a: string, _t: string, acts: unknown) => ({ acts })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

const ARTIST = 'artist-1'
const DATE = 'td-1'
const two = [
  { name: 'Jigitz', url: 'https://www.jigitz.online/' },
  { name: 'Gudfella', url: null },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const actButton = (name: string) => screen.getByRole('button', { name })
const website = () => screen.getByRole('textbox', { name: 'Website' })

describe('SupportActs (click-to-edit)', () => {
  it('an act is its name at rest; clicked, its name and website open, and Enter saves both in place', async () => {
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText('https://www.jigitz.online/')).toBeNull()

    fireEvent.click(actButton('Gudfella'))
    const name = screen.getByRole('textbox', { name: 'Act' })
    expect(name).toHaveValue('Gudfella')
    expect(website()).toHaveValue('')
    fireEvent.change(name, { target: { value: 'Gudfella Trio' } })
    fireEvent.change(website(), { target: { value: 'https://gudfella.example' } })
    await act(async () => {
      fireEvent.keyDown(website(), { key: 'Enter' })
    })
    expect(setSupportActsAction).toHaveBeenCalledWith(ARTIST, DATE, [two[0], { name: 'Gudfella Trio', url: 'https://gudfella.example' }])
    expect(actButton('Gudfella Trio')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('the bare + adds ONE act with its website, appended; the trash removes one', async () => {
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    const plus = screen.getByRole('button', { name: 'Add act' })
    expect(plus.textContent).toBe('')
    fireEvent.click(plus)
    fireEvent.change(screen.getByRole('textbox', { name: 'New act' }), { target: { value: 'ZHU' } })
    fireEvent.change(website(), { target: { value: 'https://zhumusic.com' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    })
    expect(setSupportActsAction).toHaveBeenCalledWith(ARTIST, DATE, [...two, { name: 'ZHU', url: 'https://zhumusic.com' }])
    expect(actButton('ZHU')).toBeInTheDocument()

    fireEvent.click(actButton('Jigitz'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Jigitz' }))
    })
    await waitFor(() => expect(setSupportActsAction).toHaveBeenLastCalledWith(ARTIST, DATE, [two[1], { name: 'ZHU', url: 'https://zhumusic.com' }]))
    expect(screen.queryByRole('button', { name: 'Jigitz' })).toBeNull()
  })

  it('CRITICAL: a refused save says why, keeps the lineup as it was, and keeps what was typed', async () => {
    vi.mocked(setSupportActsAction).mockResolvedValueOnce({ error: 'Enter a valid URL for Bad.' })
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add act' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New act' }), { target: { value: 'Bad' } })
    fireEvent.change(website(), { target: { value: 'javascript:alert(1)' } })
    await act(async () => {
      fireEvent.keyDown(website(), { key: 'Enter' })
    })
    expect(toast).toHaveBeenCalledWith('Enter a valid URL for Bad.', 'error')
    expect(screen.queryByRole('button', { name: 'Bad' })).toBeNull()
    expect(actButton('Jigitz')).toBeInTheDocument()
    expect(website()).toHaveValue('javascript:alert(1)')
  })
})
