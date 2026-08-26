// @vitest-environment jsdom
/**
 * The SEO / GEO page's editable rows save through the SAME gates the editor's Site tab
 * uses (saveSeoFieldAction / saveArtistFactAction) — never a form that bypasses them,
 * which is what the old tools/seo page did until 2026-08-26.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SeoAbout, SeoFacts, SeoWords } from '@/app/artists/[id]/(dashboard)/tools/seo/seo-fields'
import { saveArtistFactAction, saveSeoFieldAction } from '@/app/artists/[id]/(dashboard)/actions'
import { ABOUT_PLACEMENTS } from '@samfox1/site-bridge/seo'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveSeoFieldAction: vi.fn(async () => ({ ok: true })),
  saveArtistFactAction: vi.fn(async () => ({ ok: true })),
}))
const seoMock = vi.mocked(saveSeoFieldAction)
const factMock = vi.mocked(saveArtistFactAction)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SEO / GEO page fields', () => {
  it('CRITICAL: title and description save through the SEO gate', async () => {
    render(<SeoWords artistId="a1" name="Skeen" initial={{ seo_title: '', seo_description: '' }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'SKEEN' } })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', 'seo_title', 'SKEEN'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Chicago DJ' } })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', 'seo_description', 'Chicago DJ'))
  })
  it('genre, location and type save to the artist', async () => {
    render(<SeoFacts artistId="a1" initial={{ genre: '', location: '', schema_type: 'MusicGroup' }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Based in' }), { target: { value: 'Chicago' } })
    await vi.waitFor(() => expect(factMock).toHaveBeenCalledWith('a1', 'location', 'Chicago'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'Person' } })
    await vi.waitFor(() => expect(factMock).toHaveBeenCalledWith('a1', 'schema_type', 'Person'))
  })
  it('about placement offers every registry value plus the site default', async () => {
    render(<SeoAbout artistId="a1" initial={{ about_placement: '', about_heading: '' }} />)
    const select = screen.getByRole('combobox', { name: 'Where the bio shows' }) as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['', ...ABOUT_PLACEMENTS])
    fireEvent.change(select, { target: { value: 'hidden' } })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', 'about_placement', 'hidden'))
  })
})
