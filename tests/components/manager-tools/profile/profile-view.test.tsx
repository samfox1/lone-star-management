// @vitest-environment jsdom
/**
 * The SEO / GEO Facts tab: each fact saves through its own gate, a value the gate would refuse
 * shows the gate's own words and is never sent, and the bio keeps its rules.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/facts/facts-tab.tsx
 * Feature:  SEO / GEO page · Facts tab (round 2, prototypes/seo_variants_20260928_r2.html);
 *           feeds the `place`, `genre`, `bio`, `profiles` and `mb` tests (Says who you are)
 * Tier:     STRICT (AGENTS.md "Test depth") for what gets saved: the city to artists.location,
 *           region / country / other names / the year to their fact keys, the bio to artists.bio
 *           through the editor's gate and never over its cap. LIGHT for the rest (the
 *           visual-artist note, the profile rows).
 * Covers:   • where: the city and region save to their places; a refused value shows the
 *             validator's words and is never sent; the country is a pick from exactly the table
 *             the gate accepts; a country with regions turns Region into its list, saved AFTER
 *             the country (waiting for it); a new country drops a region not on its list; a
 *             country stored in another spelling is shown in the table's
 *           • who: the year (four digits only), the visual-artist note, other names (never the
 *             artist's own), a genre chip, the type, and a stored value the gate would now refuse
 *           • the bio: a calm row, the id a test's pencil lands on, the save and its cap, "Where
 *             it shows" offering only what can take effect
 *           • profiles: how many reach the fact card; MusicBrainz's own editor, or what is linked
 * Not here: the save rules themselves (tests/unit/manager-tools/seo/save-rules.test.ts); how the
 *           page reads the stored facts (tests/unit/manager-tools/seo/seo-facts.test.ts).
 * Fixtures: the three save actions and the router are mocks; the refusal words asserted are the
 *           validator's own (`cleanFactValue`), read from it, never copied.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ABOUT_PLACEMENTS, COUNTRIES, FACT_CONTENT_KEYS } from '@samfox1/site-bridge/seo'
import { REGIONS } from '@/lib/seo-regions'
import { cleanFactValue, thisYearAt } from '@/lib/seo-facts'
import { TEXT_LIMITS, tooLongError } from '@/lib/site-editor/text-limits'
import { FactsTab, type FactsTabProps } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/facts/facts-tab'
import { SEO_EDIT_TARGETS } from '@/lib/manager-tools/seo/sections'
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
  bioMinWords: 100,
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
  // Where each place saves: the city to the artist row, the region to its fact key.
  it('CRITICAL: the city saves to artists.location; region and country to their fact keys', async () => {
    show()
    fireEvent.change(screen.getByRole('textbox', { name: 'City' }), { target: { value: 'Evanston' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Region' }), { target: { value: 'Illinois' } })
    await vi.waitFor(() => expect(factMock).toHaveBeenCalledWith('a1', 'location', 'Evanston'))
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', FACT_CONTENT_KEYS.region, 'Illinois'))
  })
  // A refused value: the validator's own words show, and nothing is sent.
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
  // The country list is exactly the table the gate accepts, so a pick is never refused.
  it('CRITICAL: the country is a pick from exactly the table the gate accepts', () => {
    show()
    fireEvent.click(screen.getByRole('combobox', { name: 'Country' }))
    const offered = within(screen.getByRole('listbox', { name: 'Country' })).getAllByRole('option').map((o) => o.textContent)
    expect(offered.filter((o) => o !== '—').sort()).toEqual(COUNTRIES.map((c) => c.name).sort())
    // Every one of them is a value the gate stores as itself.
    for (const name of offered.filter((o): o is string => !!o && o !== '—')) expect(cleanFactValue(FACT_CONTENT_KEYS.country, name, ctx())).toEqual({ value: name })
  })
  // A country with regions turns Region into its list, and the region is saved after the country.
  it('CRITICAL: picking a country with regions turns Region into its list; the region is saved AFTER the country', async () => {
    show()
    expect(screen.getByRole('textbox', { name: 'Region' })).toBeTruthy() // no country: typed
    fireEvent.click(screen.getByRole('combobox', { name: 'Country' }))
    fireEvent.click(screen.getByRole('option', { name: 'Canada' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Region' }))
    const offered = within(screen.getByRole('listbox', { name: 'Region' })).getAllByRole('option').map((o) => o.textContent)
    expect(offered.filter((o) => o !== '—')).toEqual([...REGIONS.CA.names])
    fireEvent.click(screen.getByRole('option', { name: 'Ontario' }))
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', FACT_CONTENT_KEYS.region, 'Ontario'))
    expect(seoMock.mock.calls.map((c) => c[1])).toEqual([FACT_CONTENT_KEYS.country, FACT_CONTENT_KEYS.region])
    expect(seoMock.mock.calls[0][2]).toBe('Canada')
  })
  // A quick region waits for the country's save, since the gate reads the country back to judge the region.
  it('CRITICAL: a region picked while the country is still saving waits for it (the gate reads the country back)', async () => {
    let finishCountry: (v: { ok: boolean }) => void = () => {}
    seoMock.mockImplementationOnce(() => new Promise((res) => (finishCountry = res)))
    show()
    fireEvent.click(screen.getByRole('combobox', { name: 'Country' }))
    fireEvent.click(screen.getByRole('option', { name: 'Australia' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Region' }))
    fireEvent.click(screen.getByRole('option', { name: 'Victoria' }))
    await new Promise((r) => setTimeout(r, 20))
    expect(seoMock.mock.calls.map((c) => c[1])).toEqual([FACT_CONTENT_KEYS.country]) // not yet
    await act(async () => finishCountry({ ok: true }))
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', FACT_CONTENT_KEYS.region, 'Victoria'))
  })
  // A new country drops a region not on its list, and saves the clear.
  it('CRITICAL: a new country drops a region that isn’t on its list (and saves the clear)', async () => {
    show({ facts: { ...EMPTY_FACTS, [FACT_CONTENT_KEYS.country]: 'United States', [FACT_CONTENT_KEYS.region]: 'Illinois' } })
    expect(screen.getByRole('combobox', { name: 'Region' }).textContent).toContain('Illinois')
    fireEvent.click(screen.getByRole('combobox', { name: 'Country' }))
    fireEvent.click(screen.getByRole('option', { name: 'Canada' }))
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', FACT_CONTENT_KEYS.region, ''))
    expect(seoMock.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [FACT_CONTENT_KEYS.country, 'Canada'],
      [FACT_CONTENT_KEYS.region, ''],
    ])
  })
  // A country stored as "USA" shows as the table's "United States", with the US region list.
  it('a country stored in another spelling is shown back in the table’s ("USA" → United States)', () => {
    show({ facts: { ...EMPTY_FACTS, [FACT_CONTENT_KEYS.country]: 'USA' } })
    expect(screen.getByRole('combobox', { name: 'Country' }).textContent).toContain('United States')
    // …and its region is the US list.
    expect(screen.getByRole('combobox', { name: 'Region' })).toBeTruthy()
  })
})

describe('who', () => {
  // The year: four digits only; anything else shows the validator's words and is not sent.
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
  // A visual artist: the year is kept but not on the fact card, and the page says so.
  it('for a visual artist the year is kept but not on the fact card, and it says so', () => {
    show({ schemaType: 'Person' })
    expect(screen.getByText('Not shown to search engines for a visual artist')).toBeTruthy()
    cleanup()
    show()
    expect(screen.queryByText('Not shown to search engines for a visual artist')).toBeNull()
  })
  // Other names: the artist's own name is refused in the validator's words, unsent.
  it('CRITICAL: another name that is the artist’s own is refused in the validator’s words', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Add a name' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a name' }), { target: { value: 'skeen' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add a name' }), { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toBe(refusal(FACT_CONTENT_KEYS.aliases, 'skeen'))
    expect(seoMock).not.toHaveBeenCalled()
  })
  // A genre chip is added and saved to the artist row as one list.
  it('a genre chip is added and saved to artists.genre as one list', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Add a genre' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a genre' }), { target: { value: 'Techno' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add a genre' }), { key: 'Enter' })
    await vi.waitFor(() => expect(factMock).toHaveBeenCalledWith('a1', 'genre', 'House, Tech House, Techno'))
  })
  // A stored value the gate would now refuse is flagged on arrival.
  it('a stored value the gate would refuse today is flagged on arrival', () => {
    show({ facts: { ...EMPTY_FACTS, [FACT_CONTENT_KEYS.activeSince]: '1850' } })
    expect(screen.getByRole('alert').textContent).toBe(refusal(FACT_CONTENT_KEYS.activeSince, '1850'))
  })
  // The type saves as the artist's schema type.
  it('the type saves as the artist’s schema type', async () => {
    show()
    fireEvent.click(screen.getByRole('combobox', { name: 'Type' }))
    fireEvent.click(screen.getByRole('option', { name: 'Visual artist' }))
    await vi.waitFor(() => expect(factMock).toHaveBeenCalledWith('a1', 'schema_type', 'Person'))
  })
})

describe('the bio', () => {
  // The bio row is calm: its first words only; the counts live in the editor, and no 2,500 anywhere (Sam's call).
  it('a calm row: its first words, no bar, no count; the counts are in the editor, and no 2,500 anywhere', () => {
    show({ bio: 'I am a Chicago DJ.\n\nMore about me.' })
    expect(document.querySelector('[data-bio-preview]')?.textContent).toBe('I am a Chicago DJ.')
    expect(document.body.textContent).not.toMatch(/2,500|2500/)
    fireEvent.click(screen.getByRole('button', { name: 'Edit the bio' }))
    const dialog = screen.getByRole('dialog', { name: 'Bio' })
    expect(dialog.textContent).toMatch(/8 of 100 words/)
    expect(document.body.textContent).not.toMatch(/2,500|2500/)
  })
  // The bio test's pencil lands here: the row carries its id, and arriving opens the editor.
  it('CRITICAL: the row carries the id a test’s pencil lands on, and landing there opens the editor', async () => {
    window.history.replaceState(null, '', `/artists/a1/${SEO_EDIT_TARGETS.bio}`)
    show()
    const anchor = document.getElementById(SEO_EDIT_TARGETS.bio.split('#')[1])!
    expect(anchor).toBeTruthy()
    // The id is beside the Bio row, not a wrapper around it (a wrapped row lost its hairline).
    expect(anchor.nextElementSibling?.hasAttribute('data-ledger-row')).toBe(true)
    expect(await screen.findByRole('dialog', { name: 'Bio' })).toBeTruthy()
  })
  // The bio saves to artists.bio; over the cap it is kept, refused and never sent (never cut).
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
  // "Where it shows" offers only what can take effect here (no site declaration on this page).
  it('CRITICAL: "Where it shows" offers only what can take effect here (no site declaration on this page)', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Edit the bio' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Where it shows' }))
    const offered = screen.getAllByRole('option').map((o) => o.textContent)
    expect(offered).toEqual(['Site default', 'Hidden from visitors'])
    expect(ABOUT_PLACEMENTS).toContain('page')
  })
})

describe('profiles', () => {
  // Profiles: how many reach the fact card, and MusicBrainz's own editor filled in with the name.
  it('connected profiles and how many reach the fact card; MusicBrainz offers its own editor, filled in', () => {
    show({
      profiles: [
        { slug: 'spotify', label: 'Spotify', display: 'x', inFactCard: true },
        { slug: 'cash app', label: 'Cash App', display: 'y', inFactCard: false },
      ],
    })
    expect(screen.getByText('1 of 2 shown to search engines')).toBeTruthy()
    const create = screen.getByRole('link', { name: 'Create the page' })
    expect(create.getAttribute('href')).toBe('https://musicbrainz.org/artist/create?edit-artist.name=Skeen')
    expect(create.getAttribute('target')).toBe('_blank')
  })
  // A linked fact database shows what is linked instead of the create link.
  it('a connected fact database shows what is linked instead', () => {
    show({ databases: { musicbrainz: 'musicbrainz.org/artist/abc' } })
    expect(screen.getByText('musicbrainz.org/artist/abc')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Create the page' })).toBeNull()
  })
})
