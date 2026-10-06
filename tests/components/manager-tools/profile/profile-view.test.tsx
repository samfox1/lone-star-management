// @vitest-environment jsdom
/**
 * The Profile page: each row saves through its own gate, a value the gate would refuse shows the
 * gate's own words and is never sent, the bio keeps its rules, and the nudge under it leads to
 * the outside bios. Moved here with the SEO / GEO Facts tab (2026-10-02, PROFILE_TOOL_PLAN.md).
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/profile/profile-view.tsx, bio-row.tsx
 * Feature:  Profile (prototypes/profile_tool_20261001.html); feeds the `place`, `genre`, `bio`
 *           tests (Says who you are)
 * Tier:     STRICT (AGENTS.md "Test depth") for what gets saved: the name to artists.name through
 *           its action, the city to artists.location, region / country / other names / the year
 *           to their fact keys, the bio to artists.bio through the editor's gate and never over
 *           its cap. LIGHT for the rest (the visual-artist note, the nudge line).
 * Covers:   • who: the name (saved; a blank one refused, unsent), the year (four digits only),
 *             the visual-artist note, other names (never the artist's own; added, edited and
 *             removed as one list), genres (the same), the type, and a stored value the gate
 *             would now refuse
 *           • where: the city and region save to their places; a refused value shows the
 *             validator's words and is never sent; the country is a pick from exactly the table
 *             the gate accepts; a country with regions turns Region into its list, saved AFTER
 *             the country (waiting for it); a new country drops a region not on its list; a
 *             country stored in another spelling is shown in the table's
 *           • the bio: a calm row, the id a test's pencil lands on, the save and its cap, a
 *             window that is only the writing, whose count switches at the AI test's floor
 *             (where it shows and its heading moved to the editor's Site panel,
 *             tests/components/site/site-tools.test.tsx, site-seo-editor.test.tsx); the nudge
 *             to SEO / GEO › Profiles
 * Not here: the save rules themselves (tests/unit/manager-tools/seo/save-rules.test.ts); how the
 *           page reads the stored facts (tests/unit/manager-tools/seo/seo-facts.test.ts); the
 *           connected profiles and MusicBrainz, now on SEO / GEO › Profiles
 *           (tests/components/manager-tools/seo/connected-rows.test.tsx).
 * Fixtures: the save actions and the router are mocks; the refusal words asserted are the
 *           validators' own (`cleanFactValue`, `artistNameError`), read from them, never copied.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { COUNTRIES, FACT_CONTENT_KEYS } from '@samfox1/site-bridge/seo'
import { REGIONS } from '@/lib/seo-regions'
import { cleanFactValue, thisYearAt } from '@/lib/seo-facts'
import { TEXT_LIMITS, tooLongError } from '@/lib/site-editor/text-limits'
import { ProfileView, type ProfileViewProps } from '@/app/artists/[id]/(dashboard)/(manager-tools)/profile/profile-view'
import { saveArtistNameAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/profile/actions'
import { artistNameError } from '@/lib/manager-tools/profile/profile'
import { seoTabSeg } from '@/lib/manager-tools/seo/sections'
import { SEO_EDIT_TARGETS } from '@/lib/manager-tools/seo/sections'
import { saveArtistFactAction, saveEditorFieldAction, saveSeoFieldAction } from '@/app/artists/[id]/(dashboard)/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveSeoFieldAction: vi.fn(async () => ({ ok: true })),
  saveArtistFactAction: vi.fn(async () => ({ ok: true })),
  saveEditorFieldAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/profile/actions', () => ({
  saveArtistNameAction: vi.fn(async () => ({})),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

const seoMock = vi.mocked(saveSeoFieldAction)
const factMock = vi.mocked(saveArtistFactAction)
const fieldMock = vi.mocked(saveEditorFieldAction)
const nameMock = vi.mocked(saveArtistNameAction)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

const EMPTY_FACTS = Object.fromEntries(Object.values(FACT_CONTENT_KEYS).map((k) => [k, '']))
const props = (over: Partial<ProfileViewProps> = {}): ProfileViewProps => ({
  artistId: 'a1',
  artistName: 'Skeen',
  schemaType: 'MusicGroup',
  genre: 'House, Tech House',
  city: 'Chicago',
  facts: EMPTY_FACTS,
  bio: 'Old',
  bioMinWords: 100,
  ...over,
})
const show = (over: Partial<ProfileViewProps> = {}) => render(<ProfileView {...props(over)} />)
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
  // The name saves through its own action (moved from Settings); a blank name shows the rule's words and is never sent.
  it('CRITICAL: the name saves through its action; a blank one is refused in the rule’s words and never sent', async () => {
    vi.useFakeTimers()
    show()
    const box = screen.getByRole('textbox', { name: 'Name' })
    expect((box as HTMLInputElement).value).toBe('Skeen')
    fireEvent.change(box, { target: { value: '  ' } })
    expect(screen.getByRole('alert').textContent).toBe(artistNameError('  '))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(nameMock).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: 'Skeen Live' } })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(nameMock).toHaveBeenCalledWith('a1', 'Skeen Live')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  // The year: four digits only; anything else shows the validator's words and is not sent.
  it('CRITICAL: Started takes a four-digit year and refuses anything else, unsent', async () => {
    vi.useFakeTimers()
    show()
    const year = screen.getByRole('textbox', { name: 'Started' })
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
  // Other names: the artist's own name is refused in the validator's words, unsent, and the
  // field keeps it (EditList: a refusal never wipes the draft).
  it('CRITICAL: another name that is the artist’s own is refused in the validator’s words', async () => {
    vi.useFakeTimers()
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Add name' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New other name' }), { target: { value: 'skeen' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New other name' }), { key: 'Enter' })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(toast).toHaveBeenCalledWith(refusal(FACT_CONTENT_KEYS.aliases, 'skeen'), 'error')
    expect((screen.getByRole('textbox', { name: 'New other name' }) as HTMLInputElement).value).toBe('skeen')
    expect(seoMock).not.toHaveBeenCalled()
  })
  // Other names, the main path: add, edit and remove each save the whole list to its fact key.
  it('other names: add, edit and remove save the whole list to fact_aliases', async () => {
    show({ facts: { ...EMPTY_FACTS, [FACT_CONTENT_KEYS.aliases]: 'Skeen Music' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add name' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New other name' }), { target: { value: 'DJ Skeen' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New other name' }), { key: 'Enter' })
    await vi.waitFor(() => expect(seoMock).toHaveBeenLastCalledWith('a1', FACT_CONTENT_KEYS.aliases, 'Skeen Music\nDJ Skeen'))
    fireEvent.click(screen.getByRole('button', { name: 'Skeen Music' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Other name' }), { target: { value: 'Skeen Sounds' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Other name' }), { key: 'Enter' })
    await vi.waitFor(() => expect(seoMock).toHaveBeenLastCalledWith('a1', FACT_CONTENT_KEYS.aliases, 'Skeen Sounds\nDJ Skeen'))
    fireEvent.click(screen.getByRole('button', { name: 'DJ Skeen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove DJ Skeen' }))
    await vi.waitFor(() => expect(seoMock).toHaveBeenLastCalledWith('a1', FACT_CONTENT_KEYS.aliases, 'Skeen Sounds'))
  })
  // Genres, the main path: add, edit and remove each save artists.genre as one list.
  it('genres: add, edit and remove save artists.genre as one list', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Add genre' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New genre' }), { target: { value: 'Techno' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New genre' }), { key: 'Enter' })
    await vi.waitFor(() => expect(factMock).toHaveBeenLastCalledWith('a1', 'genre', 'House, Tech House, Techno'))
    fireEvent.click(screen.getByRole('button', { name: 'House' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Genre' }), { target: { value: 'Deep House' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Genre' }), { key: 'Enter' })
    await vi.waitFor(() => expect(factMock).toHaveBeenLastCalledWith('a1', 'genre', 'Deep House, Tech House, Techno'))
    fireEvent.click(screen.getByRole('button', { name: 'Tech House' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tech House' }))
    await vi.waitFor(() => expect(factMock).toHaveBeenLastCalledWith('a1', 'genre', 'Deep House, Techno'))
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
    expect(dialog.querySelector('[data-bio-counts]')?.textContent).toBe('8 / 100 words')
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
  // The window is only the writing; its count reads "N / floor" below the AI test's floor, then just "N words" in ink.
  it('the window is only the bio; the count says "N / 100 words" below the floor and "N words" once met', () => {
    show({ bio: Array(99).fill('word').join(' ') })
    fireEvent.click(screen.getByRole('button', { name: 'Edit the bio' }))
    const dialog = screen.getByRole('dialog', { name: 'Bio' })
    const count = () => dialog.querySelector('[data-bio-counts]')!
    expect(count().textContent).toBe('99 / 100 words')
    expect(count().hasAttribute('data-met')).toBe(false)
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Bio' }), { target: { value: Array(104).fill('word').join(' ') } })
    expect(count().textContent).toBe('104 words')
    expect(count().hasAttribute('data-met')).toBe(true)
    // Where it shows and its heading live in the editor now; closing is done (it autosaves).
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1)
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull()
  })
  // The count is the AI test's own (seo-tests/match.ts wordCount): a spaced dash is not a word,
  // so it cannot tip the window to "met" while the test still says the bio is under its floor.
  it('counts words as the AI test does: a spaced dash is not the 100th word', () => {
    show({ bio: `${Array(50).fill('word').join(' ')} — ${Array(49).fill('word').join(' ')}` })
    fireEvent.click(screen.getByRole('button', { name: 'Edit the bio' }))
    const count = screen.getByRole('dialog', { name: 'Bio' }).querySelector('[data-bio-counts]')!
    expect(count.textContent).toBe('99 / 100 words')
    expect(count.hasAttribute('data-met')).toBe(false)
  })
})

describe('the nudge', () => {
  // After a Publish changed a fact, the Bio row says how many outside bios may be out of date, linking to SEO / GEO › Profiles.
  it('the Bio row shows the nudge, linking to SEO / GEO › Profiles; nothing when there is none', () => {
    show({ bioNudge: '2 outside bios may be out of date' })
    const link = screen.getByRole('link', { name: /2 outside bios may be out of date/ })
    expect(link.getAttribute('href')).toBe(`/artists/a1/${seoTabSeg('profiles')}`)
    cleanup()
    show()
    expect(document.querySelector('[data-bio-nudge]')).toBeNull()
  })
})
