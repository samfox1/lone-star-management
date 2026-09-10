// @vitest-environment jsdom
/**
 * PressKitForm — the hand-typed half of the press kit.
 *
 * What matters here is the CONTRACT WITH THE SERVER, not the markup: the three quote
 * fields post as three parallel lists that `readPressQuotesFromForm` zips by index. If
 * a row ever rendered its inputs out of order, or an added row posted only some of its
 * fields, a quote would silently acquire someone else's source. These tests submit the
 * real form and read back the FormData the action received.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PressKitForm } from '@/app/artists/[id]/(dashboard)/epk/press-kit-form'
import { savePressKitAction } from '@/app/artists/[id]/(dashboard)/epk/actions'

vi.mock('@/app/artists/[id]/(dashboard)/epk/actions', () => ({
  savePressKitAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

const mockedSave = vi.mocked(savePressKitAction)

/** The FormData the bound action was called with on the most recent submit. */
function submitted(): FormData {
  const call = mockedSave.mock.calls.at(-1)
  if (!call) throw new Error('the action was never called')
  return call[1] as FormData
}

beforeEach(() => mockedSave.mockClear())
afterEach(cleanup)

const QUOTES = [
  { quote: 'A blistering live act.', source: 'NME', url: 'https://nme.com/x' },
  { quote: 'Unmissable.', source: 'Pitchfork', url: null },
]

describe('PressKitForm', () => {
  it('posts the existing pitch and quotes unchanged', async () => {
    render(<PressKitForm artistId="a1" pitch="Austin four-piece." quotes={QUOTES} />)
    fireEvent.submit(screen.getByRole('button', { name: 'Save press kit' }).closest('form')!)

    const fd = submitted()
    expect(fd.get('press_pitch')).toBe('Austin four-piece.')
    expect(fd.getAll('quote')).toEqual(['A blistering live act.', 'Unmissable.'])
    expect(fd.getAll('source')).toEqual(['NME', 'Pitchfork'])
    expect(fd.getAll('quote_url')).toEqual(['https://nme.com/x', ''])
  })

  it('CRITICAL: the three lists stay aligned when a row is added', async () => {
    render(<PressKitForm artistId="a1" pitch="" quotes={QUOTES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add quote' }))

    fireEvent.submit(screen.getByRole('button', { name: 'Save press kit' }).closest('form')!)

    // A new blank row must contribute an entry to EVERY list, or the zip shifts.
    expect(submitted().getAll('quote')).toHaveLength(3)
    expect(submitted().getAll('source')).toHaveLength(3)
    expect(submitted().getAll('quote_url')).toHaveLength(3)
  })

  it('CRITICAL: removing the first row removes its source and url too', async () => {
    render(<PressKitForm artistId="a1" pitch="" quotes={QUOTES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove quote 1' }))
    fireEvent.submit(screen.getByRole('button', { name: 'Save press kit' }).closest('form')!)

    const fd = submitted()
    expect(fd.getAll('quote')).toEqual(['Unmissable.'])
    expect(fd.getAll('source')).toEqual(['Pitchfork'])
  })

  it('starts with one empty row when there are no quotes yet', () => {
    render(<PressKitForm artistId="a1" pitch="" quotes={[]} />)
    expect(screen.getAllByPlaceholderText('What the reviewer said')).toHaveLength(1)
  })

  it('removing the only row leaves an empty one rather than nothing to type in', () => {
    render(<PressKitForm artistId="a1" pitch="" quotes={[QUOTES[0]]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove quote 1' }))
    expect(screen.getAllByPlaceholderText('What the reviewer said')).toHaveLength(1)
  })

  it('stops offering Add quote at the cap', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ quote: `q${i}`, source: '', url: null }))
    render(<PressKitForm artistId="a1" pitch="" quotes={many} />)
    expect(screen.queryByRole('button', { name: 'Add quote' })).toBeNull()
  })
})
