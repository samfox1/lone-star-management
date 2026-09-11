// @vitest-environment jsdom
// The lineup chips on a tour date: click a chip to edit or remove an act, "+" to add one.
/**
 * SupportActs — the LINEUP row (prototype G, 2026-09-11). Acts are chips; a chip opens a
 * small popover with the act's name and website, plus Remove. The dashed "+" chip opens
 * the same popover empty. Every change is ONE call carrying the whole lineup (names +
 * links), so the server never sees a name without its link.
 *
 *   - a chip with a website wears the link mark; one without does not;
 *   - Add: "+" → name + website → the lineup with the new act appended;
 *   - Edit: rename and relink in place, order kept;
 *   - Remove: the lineup without that act;
 *   - a refused save shows the error and the chips stay as they were;
 *   - Enter inside the popover commits — it must NOT submit a surrounding form.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const chip = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const popover = () => screen.getByRole('dialog', { name: /act/i })

describe('SupportActs (chips)', () => {
  it('shows each act as a chip; only a linked act wears the link mark', () => {
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    expect(chip('Jigitz')).toHaveAccessibleName('Jigitz, linked')
    expect(chip('Gudfella')).toHaveAccessibleName('Gudfella')
  })

  it('adds ONE act with its website through the "+" chip, appended to the lineup', async () => {
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add act' }))
    const pop = popover()
    fireEvent.change(within(pop).getByLabelText('Name'), { target: { value: 'ZHU' } })
    fireEvent.change(within(pop).getByLabelText('Website'), { target: { value: 'https://zhumusic.com' } })
    fireEvent.click(within(pop).getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(setSupportActsAction).toHaveBeenCalledWith(ARTIST, DATE, [...two, { name: 'ZHU', url: 'https://zhumusic.com' }]),
    )
    expect(chip('ZHU')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /act/i })).toBeNull()
  })

  it('Enter in the popover commits and does NOT submit the surrounding form', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <SupportActs artistId={ARTIST} tourDateId={DATE} acts={[]} />
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add act' }))
    const name = within(popover()).getByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Solo' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    await waitFor(() => expect(setSupportActsAction).toHaveBeenCalledWith(ARTIST, DATE, [{ name: 'Solo', url: null }]))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('edits an act in place — new name and link, same position', async () => {
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    fireEvent.click(chip('Gudfella'))
    const pop = popover()
    expect(within(pop).getByLabelText('Name')).toHaveValue('Gudfella')
    fireEvent.change(within(pop).getByLabelText('Name'), { target: { value: 'Gudfella Trio' } })
    fireEvent.change(within(pop).getByLabelText('Website'), { target: { value: 'https://gudfella.example' } })
    fireEvent.click(within(pop).getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(setSupportActsAction).toHaveBeenCalledWith(ARTIST, DATE, [two[0], { name: 'Gudfella Trio', url: 'https://gudfella.example' }]),
    )
    expect(chip('Gudfella Trio')).toBeInTheDocument()
  })

  it('removes one act from its popover, leaving the rest in order', async () => {
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    fireEvent.click(chip('Jigitz'))
    fireEvent.click(within(popover()).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(setSupportActsAction).toHaveBeenCalledWith(ARTIST, DATE, [two[1]]))
    expect(screen.queryByRole('button', { name: /^Jigitz/ })).toBeNull()
    expect(chip('Gudfella')).toBeInTheDocument()
  })

  it('CRITICAL: a refused save shows the error and keeps the chips as they were', async () => {
    vi.mocked(setSupportActsAction).mockResolvedValueOnce({ error: 'Enter a valid URL.' })
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add act' }))
    const pop = popover()
    fireEvent.change(within(pop).getByLabelText('Name'), { target: { value: 'Bad' } })
    fireEvent.change(within(pop).getByLabelText('Website'), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(within(pop).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Enter a valid URL.', 'error'))
    expect(screen.queryByRole('button', { name: /^Bad/ })).toBeNull()
    expect(chip('Jigitz')).toBeInTheDocument()
  })
})
