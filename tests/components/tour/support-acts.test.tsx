// @vitest-environment jsdom
// The supporting-acts editor on a tour date: add one act with its link, edit or remove one.
/**
 * SupportActs — the lineup editor inside a tour date's modal (Sam, 2026-09-11: "add
 * supporting acts one at a time with their website link and edit/remove existing ones").
 * It replaced the names-only chip field. Every change is ONE call carrying the whole
 * lineup (names + links), so the server can never see a name without its link.
 *
 *   - Add: name + website → the lineup with the new act appended;
 *   - Remove: the lineup without that act;
 *   - Edit: rename and relink in place, order kept;
 *   - a refused save (bad URL) shows the error and the list stays as it was;
 *   - Enter inside the add row adds an act — it must NOT submit the surrounding form.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  { name: 'Arlo', url: 'https://arlo.example' },
  { name: 'Bo Reed', url: null },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SupportActs', () => {
  it('lists each act with its link', () => {
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    expect(screen.getByText('Arlo')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /arlo\.example/ })).toHaveAttribute('href', 'https://arlo.example')
    expect(screen.getByText('Bo Reed')).toBeInTheDocument()
  })

  it('adds ONE act with its website, appended to the lineup', async () => {
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    fireEvent.change(screen.getByLabelText('Act name'), { target: { value: 'Gudfella' } })
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://gudfella.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add act' }))
    await waitFor(() =>
      expect(setSupportActsAction).toHaveBeenCalledWith(ARTIST, DATE, [...two, { name: 'Gudfella', url: 'https://gudfella.example' }]),
    )
    expect(screen.getByText('Gudfella')).toBeInTheDocument()
    // The add row is cleared for the next act.
    expect(screen.getByLabelText('Act name')).toHaveValue('')
  })

  it('Enter in the add row adds the act and does NOT submit the surrounding form', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <SupportActs artistId={ARTIST} tourDateId={DATE} acts={[]} />
      </form>,
    )
    fireEvent.change(screen.getByLabelText('Act name'), { target: { value: 'Solo' } })
    fireEvent.keyDown(screen.getByLabelText('Act name'), { key: 'Enter' })
    await waitFor(() => expect(setSupportActsAction).toHaveBeenCalledWith(ARTIST, DATE, [{ name: 'Solo', url: null }]))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('removes one act, leaving the rest in order', async () => {
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Arlo' }))
    await waitFor(() => expect(setSupportActsAction).toHaveBeenCalledWith(ARTIST, DATE, [two[1]]))
    expect(screen.queryByText('Arlo')).toBeNull()
    expect(screen.getByText('Bo Reed')).toBeInTheDocument()
  })

  it('edits an act in place — new name and link, same position', async () => {
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Bo Reed' }))
    fireEvent.change(screen.getByDisplayValue('Bo Reed'), { target: { value: 'Bo Reed Trio' } })
    fireEvent.change(screen.getByLabelText('Website for Bo Reed'), { target: { value: 'https://bo.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save act' }))
    await waitFor(() =>
      expect(setSupportActsAction).toHaveBeenCalledWith(ARTIST, DATE, [two[0], { name: 'Bo Reed Trio', url: 'https://bo.example' }]),
    )
    expect(screen.getByText('Bo Reed Trio')).toBeInTheDocument()
  })

  it('CRITICAL: a refused save shows the error and keeps the lineup as it was', async () => {
    vi.mocked(setSupportActsAction).mockResolvedValueOnce({ error: 'Enter a valid URL.' })
    render(<SupportActs artistId={ARTIST} tourDateId={DATE} acts={two} />)
    fireEvent.change(screen.getByLabelText('Act name'), { target: { value: 'Bad' } })
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add act' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Enter a valid URL.', 'error'))
    expect(screen.queryByText('Bad')).toBeNull()
    expect(screen.getByText('Arlo')).toBeInTheDocument()
  })
})
