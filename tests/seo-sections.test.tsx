// @vitest-environment jsdom
/**
 * The SEO / GEO editor's sections (Sam, 2026-08-28): every section in the registry saves
 * through the SAME gates the editor uses; the bio edits the artist column, never a
 * site_content key. Expectations derive from the registries.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ListingSection } from '@/app/artists/[id]/(dashboard)/tools/seo/sections/listing'
import { FactsSection } from '@/app/artists/[id]/(dashboard)/tools/seo/sections/facts'
import { AboutSection } from '@/app/artists/[id]/(dashboard)/tools/seo/sections/about'
import { AiSection, probePrompts } from '@/app/artists/[id]/(dashboard)/tools/seo/sections/ai'
import { AltSection } from '@/app/artists/[id]/(dashboard)/tools/seo/sections/alt'
import { SEO_SECTIONS, isSeoSection } from '@/app/artists/[id]/(dashboard)/tools/seo/sections'
import { FAQ_KEYS } from '@/lib/site-content-schema'
import { ABOUT_PLACEMENTS } from '@samfox1/site-bridge/seo'
import { saveArtistFactAction, saveEditorFieldAction, saveSeoFieldAction, setMediaAltAction, renameMediaAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveSeoFieldAction: vi.fn(async () => ({ ok: true })),
  saveArtistFactAction: vi.fn(async () => ({ ok: true })),
  saveEditorFieldAction: vi.fn(async () => ({ ok: true })),
  setMediaAltAction: vi.fn(async () => ({})),
  renameMediaAction: vi.fn(async () => ({ storage_path: 'a1/gallery/skeen-oslo.jpg' })),
}))
const seoMock = vi.mocked(saveSeoFieldAction)
const factMock = vi.mocked(saveArtistFactAction)
const fieldMock = vi.mocked(saveEditorFieldAction)
const altMock = vi.mocked(setMediaAltAction)
const renameMock = vi.mocked(renameMediaAction)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('registry', () => {
  it('every section is routable and unique', () => {
    expect(new Set(SEO_SECTIONS.map((s) => s.seg)).size).toBe(SEO_SECTIONS.length)
    for (const s of SEO_SECTIONS) expect(isSeoSection(s.seg)).toBe(true)
    expect(isSeoSection('nope')).toBe(false)
  })
})

describe('sections save through the gates', () => {
  it('CRITICAL: listing → saveSeoFieldAction, and the Google preview follows the words', async () => {
    render(<ListingSection artistId="a1" name="Skeen" bio="A Chicago DJ." siteUrl="https://www.skeenmusic.com" initial={{ seo_title: '', seo_description: '' }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name in search results' }), { target: { value: 'SKEEN' } })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', 'seo_title', 'SKEEN'))
    expect(screen.getByText('SKEEN')).toBeTruthy()
  })
  it('facts → saveArtistFactAction', async () => {
    render(<FactsSection artistId="a1" initial={{ genre: '', location: '', schema_type: 'MusicGroup' }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Based in' }), { target: { value: 'Chicago' } })
    await vi.waitFor(() => expect(factMock).toHaveBeenCalledWith('a1', 'location', 'Chicago'))
  })
  it('CRITICAL: the bio saves to artists.bio (the one bio), placement to the SEO gate', async () => {
    render(<AboutSection artistId="a1" initialBio="Old" initial={{ about_placement: '', about_heading: '' }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'About the artist' }), { target: { value: 'New bio' } })
    await vi.waitFor(() => expect(fieldMock).toHaveBeenCalledWith('a1', 'artist_bio', 'New bio', { store: 'artist', column: 'bio' }))
    const select = screen.getByRole('combobox', { name: 'Placement' }) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'hidden' } })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', 'about_placement', 'hidden'))
  })
  /**
   * Review 2026-09-03, M9: this page offered the whole ABOUT_PLACEMENTS registry while the
   * editor's Site panel offers only what the connected site's manifest declares. On a site
   * declaring `home`, picking "Its own page" saved fine and did nothing — no /about route,
   * and no error anywhere. Same filter as site-tools.tsx now: `hidden` always (the bridge's
   * aboutPlacement allows it unconditionally), the rest only when declared.
   */
  it('CRITICAL: Placement offers only what the site declares it can render', () => {
    render(<AboutSection artistId="a1" initialBio="" initial={{ about_placement: '', about_heading: '' }} />)
    // No declaration reaches this page today, so only the universally-renderable option.
    expect([...(screen.getByRole('combobox', { name: 'Placement' }) as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'hidden'])
    cleanup()
    render(<AboutSection artistId="a1" initialBio="" initial={{ about_placement: '', about_heading: '' }} about={{ placements: ['home'], default: 'home' }} />)
    expect([...(screen.getByRole('combobox', { name: 'Placement' }) as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'home', 'hidden'])
    expect(ABOUT_PLACEMENTS).toContain('page')
  })
  it('the site default names where the bio goes when nothing is chosen', () => {
    render(<AboutSection artistId="a1" initialBio="" initial={{ about_placement: '', about_heading: '' }} about={{ placements: ['home', 'page'], default: 'page' }} />)
    expect(screen.getByRole('option', { name: 'Site default (Its own page)' })).toBeTruthy()
  })
  it('CRITICAL: the five fixed questions show their automatic answers; editing one saves to its FAQ key', async () => {
    render(<AiSection artistId="a1" name="Skeen" schemaType="MusicGroup" initial={{}} auto={['', 'Skeen makes House.', '', '', '']} />)
    expect(probePrompts('Skeen', 'MusicGroup')).toHaveLength(FAQ_KEYS.length)
    expect(screen.getByText('Skeen makes House.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit: What kind of music does Skeen make, and where are they based?' }))
    fireEvent.change(screen.getByRole('textbox', { name: /^Answer: What kind/ }), { target: { value: 'House, from Chicago.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', FAQ_KEYS[1], 'House, from Chicago.'))
  })
  it('CRITICAL: Add question fills the next free extra slot; Remove clears it', async () => {
    render(<AiSection artistId="a1" name="Skeen" schemaType="MusicGroup" initial={{ faq_extra_1_q: 'Can I book Skeen?', faq_extra_1_a: 'Yes.' }} auto={['', '', '', '', '']} />)
    expect(screen.getByText('Can I book Skeen?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New question' }), { target: { value: 'Where is Skeen from?' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'New answer' }), { target: { value: 'Chicago.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', 'faq_extra_2_q', 'Where is Skeen from?'))
    expect(seoMock).toHaveBeenCalledWith('a1', 'faq_extra_2_a', 'Chicago.')
    fireEvent.click(screen.getByRole('button', { name: 'Remove: Can I book Skeen?' }))
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', 'faq_extra_1_q', ''))
  })
  it('a fixed question with no written answer cannot be removed (nothing to clear)', () => {
    render(<AiSection artistId="a1" name="Skeen" schemaType="MusicGroup" initial={{}} auto={['', '', '', '', '']} />)
    expect((screen.getByRole('button', { name: 'Reset: Who is Skeen, the musician?' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('alt tags: alt saves live, the file name renames on blur, the thumbnail opens a preview', async () => {
    render(<AltSection artistId="a1" artistName="Skeen" photos={[{ id: 'm1', url: 'https://cdn/x/a.jpg', alt: '', slug: 'a', caption: 'Tour w: Jigitz' }]} />)
    expect((screen.getByRole('textbox', { name: 'Alt text for a' }) as HTMLInputElement).placeholder).toBe('Skeen, Tour with Jigitz')
    fireEvent.change(screen.getByRole('textbox', { name: 'Alt text for a' }), { target: { value: 'Skeen at Smartbar' } })
    await vi.waitFor(() => expect(altMock).toHaveBeenCalledWith('a1', 'm1', 'Skeen at Smartbar'))
    const file = screen.getByRole('textbox', { name: 'File name for a' })
    fireEvent.change(file, { target: { value: 'skeen-oslo' } })
    fireEvent.blur(file)
    await vi.waitFor(() => expect(renameMock).toHaveBeenCalledWith('a1', 'm1', 'skeen-oslo'))
    fireEvent.click(screen.getByRole('button', { name: 'Preview a' }))
    expect(screen.getByRole('dialog', { name: 'Preview a' })).toBeTruthy()
  })
})
