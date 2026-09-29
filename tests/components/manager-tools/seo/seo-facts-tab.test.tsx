// @vitest-environment jsdom
// SEO / GEO Facts: each fact saves through its own gate, a value the gate would refuse shows the
// gate's own words and is never sent, a tidied country is shown back, the bio keeps its rules.
/**
 * Round 2's Facts (prototypes/seo_variants_20260928_r2.html). STRICT for what gets saved: the
 * city to artists.location, region / country / other names / the year to their fact keys
 * (lib/seo-facts.ts), the bio to artists.bio through the editor's gate and never over its
 * cap. The messages asserted are the validator's own (`cleanFactValue`), read from it, never
 * copied. LIGHT for the rest (the visual-artist note, the profile rows).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ABOUT_PLACEMENTS, FACT_CONTENT_KEYS } from '@samfox1/site-bridge/seo'
import { cleanFactValue, thisYearAt } from '@/lib/seo-facts'
import { TEXT_LIMITS, tooLongError } from '@/lib/site-editor/text-limits'
import { FactsTab, type FactsTabProps } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/facts/facts-tab'
import { SEO_EDIT_TARGETS } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/sections'
import { saveArtistFactAction, saveEditorFieldAction, saveSeoFieldAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveSeoFieldAction: vi.fn(async () => ({ ok: true })),
  saveArtistFactAction: vi.fn(async () => ({ ok: true })),
  saveEditorFieldAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const seoMock = vi.mocked(saveSeoFieldAction)
const factMock = vi.mocked(saveArtistFactAction)
const fieldMock = vi.mocked(saveEditorFieldAction)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

const EMPTY_FACTS = Object.fromEntries(Object.values(FACT_CONTENT_KEYS).map((k) => [k, '']))
const props = (over: Partial<FactsTabProps> = {}): FactsTabProps => ({
  artistId: 'a1',
  artistName: 'Skeen',
  schemaType: 'MusicGroup',
  genre: 'House, Tech House',
  city: 'Chicago',
  facts: EMPTY_FACTS,
  bio: 'Old',
  bioGoal: 2500,
  about: { placement: '', heading: '' },
  bookingEmail: '',
  profiles: [{ slug: 'spotify', label: 'Spotify', display: 'open.spotify.com/artist/x', inFactCard: true }],
  databases: {},
  musicBrainzCreate: 'https://musicbrainz.org/artist/create?edit-artist.name=Skeen',
  ...over,
})
const show = (over: Partial<FactsTabProps> = {}) => render(<FactsTab {...props(over)} />)
const ctx = () => ({ artistName: 'Skeen', thisYear: thisYearAt(new Date()) })
const refusal = (key: (typeof FACT_CONTENT_KEYS)[keyof typeof FACT_CONTENT_KEYS], raw: string) => {
  const r = cleanFactValue(key, raw, ctx())
  if (!('error' in r)) throw new Error(`the validator took ${raw}`)
  return r.error
}

describe('where', () => {
  it('CRITICAL: the city saves to artists.location; region and country to their fact keys', async () => {
    show()
    fireEvent.change(screen.getByRole('textbox', { name: 'City' }), { target: { value: 'Evanston' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Region' }), { target: { value: 'Illinois' } })
    await vi.waitFor(() => expect(factMock).toHaveBeenCalledWith('a1', 'location', 'Evanston'))
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', FACT_CONTENT_KEYS.region, 'Illinois'))
  })
  it('CRITICAL: a refused value shows the validator’s words and is never sent', async () => {
    vi.useFakeTimers()
    show()
    fireEvent.change(screen.getByRole('textbox', { name: 'Region' }), { target: { value: '<b>Illinois</b>' } })
    expect(screen.getByRole('alert').textContent).toBe(refusal(FACT_CONTENT_KEYS.region, '<b>Illinois</b>'))
    fireEvent.change(screen.getByRole('textbox', { name: 'City' }), { target: { value: 'Chi<cago' } })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(seoMock).not.toHaveBeenCalled()
    expect(factMock).not.toHaveBeenCalled()
  })
  it('CRITICAL: a country the gate tidies is shown back as saved ("usa" → the table’s name)', async () => {
    show()
    const country = screen.getByRole('textbox', { name: 'Country' }) as HTMLInputElement
    fireEvent.change(country, { target: { value: 'usa' } })
    const stored = cleanFactValue(FACT_CONTENT_KEYS.country, 'usa', ctx())
    if (!('value' in stored)) throw new Error('usa refused')
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', FACT_CONTENT_KEYS.country, 'usa'))
    expect(await screen.findByText(`Saved as ${stored.value}`)).toBeTruthy()
    fireEvent.blur(country)
    expect(country.value).toBe(stored.value)
  })
})

describe('who', () => {
  it('CRITICAL: Active since takes a four-digit year and refuses anything else, unsent', async () => {
    vi.useFakeTimers()
    show()
    const year = screen.getByRole('textbox', { name: 'Active since' })
    fireEvent.change(year, { target: { value: '20x4' } })
    expect(screen.getByRole('alert').textContent).toBe(refusal(FACT_CONTENT_KEYS.activeSince, '20x4'))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(seoMock).not.toHaveBeenCalled()
    fireEvent.change(year, { target: { value: '2014' } })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(seoMock).toHaveBeenCalledWith('a1', FACT_CONTENT_KEYS.activeSince, '2014')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('for a visual artist the year is kept but not on the fact card, and it says so', () => {
    show({ schemaType: 'Person' })
    expect(screen.getByText('Not on your fact card for a visual artist')).toBeTruthy()
    cleanup()
    show()
    expect(screen.queryByText('Not on your fact card for a visual artist')).toBeNull()
  })
  it('CRITICAL: another name that is the artist’s own is refused in the validator’s words', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Add a name' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a name' }), { target: { value: 'skeen' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add a name' }), { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toBe(refusal(FACT_CONTENT_KEYS.aliases, 'skeen'))
    expect(seoMock).not.toHaveBeenCalled()
  })
  it('a genre chip is added and saved to artists.genre as one list', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Add a genre' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a genre' }), { target: { value: 'Techno' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add a genre' }), { key: 'Enter' })
    await vi.waitFor(() => expect(factMock).toHaveBeenCalledWith('a1', 'genre', 'House, Tech House, Techno'))
  })
  it('a stored value the gate would refuse today is flagged on arrival', () => {
    show({ facts: { ...EMPTY_FACTS, [FACT_CONTENT_KEYS.activeSince]: '1850' } })
    expect(screen.getByRole('alert').textContent).toBe(refusal(FACT_CONTENT_KEYS.activeSince, '1850'))
  })
  it('the type saves as the artist’s schema type', async () => {
    show()
    fireEvent.click(screen.getByRole('combobox', { name: 'Type' }))
    fireEvent.click(screen.getByRole('option', { name: 'Visual artist' }))
    await vi.waitFor(() => expect(factMock).toHaveBeenCalledWith('a1', 'schema_type', 'Person'))
  })
})

describe('the bio', () => {
  it('CRITICAL: the row carries the id a test’s pencil lands on, and landing there opens the editor', async () => {
    window.history.replaceState(null, '', `/artists/a1/${SEO_EDIT_TARGETS.bio}`)
    show()
    expect(document.getElementById(SEO_EDIT_TARGETS.bio.split('#')[1])).toBeTruthy()
    expect(await screen.findByRole('dialog', { name: 'Bio' })).toBeTruthy()
  })
  it('CRITICAL: the bio saves to artists.bio (the one bio); over the cap it counts, refuses and is never sent', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Edit the bio' }))
    const box = within(screen.getByRole('dialog', { name: 'Bio' })).getByRole('textbox', { name: 'Bio' })
    fireEvent.change(box, { target: { value: 'New bio' } })
    await vi.waitFor(() => expect(fieldMock).toHaveBeenCalledWith('a1', 'artist_bio', 'New bio', { store: 'artist', column: 'bio' }))
    fieldMock.mockClear()
    vi.useFakeTimers()
    fireEvent.change(box, { target: { value: 'x'.repeat(TEXT_LIMITS.bio + 1) } })
    expect((box as HTMLTextAreaElement).value).toHaveLength(TEXT_LIMITS.bio + 1)
    expect(screen.getByRole('alert').textContent).toBe(tooLongError(TEXT_LIMITS.bio))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(fieldMock).not.toHaveBeenCalled()
  })
  it('CRITICAL: Placement offers only what can take effect here (no site declaration on this page)', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Edit the bio' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Placement' }))
    const offered = screen.getAllByRole('option').map((o) => o.textContent)
    expect(offered).toEqual(['Site default', 'Hidden from visitors'])
    expect(ABOUT_PLACEMENTS).toContain('page')
  })
})

describe('profiles', () => {
  it('connected profiles and how many reach the fact card; MusicBrainz offers its own editor, filled in', () => {
    show({
      profiles: [
        { slug: 'spotify', label: 'Spotify', display: 'x', inFactCard: true },
        { slug: 'cash app', label: 'Cash App', display: 'y', inFactCard: false },
      ],
    })
    expect(screen.getByText('1 of 2 in your fact card')).toBeTruthy()
    const create = screen.getByRole('link', { name: 'Create the page' })
    expect(create.getAttribute('href')).toBe('https://musicbrainz.org/artist/create?edit-artist.name=Skeen')
    expect(create.getAttribute('target')).toBe('_blank')
  })
  it('a connected fact database shows what is linked instead', () => {
    show({ databases: { musicbrainz: 'musicbrainz.org/artist/abc' } })
    expect(screen.getByText('musicbrainz.org/artist/abc')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Create the page' })).toBeNull()
  })
})
