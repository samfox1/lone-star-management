// @vitest-environment jsdom
// SEO / GEO Answers: the five fixed questions, two of them read-only (from Tour and Music), the
// rest edit in place into their FAQ keys; extra questions fill the next free slot.
/**
 * Round 2's Answers (prototypes/seo_variants_20260928_r2.html). STRICT for what gets saved
 * (each answer to ITS key, derived from FAQ_KEYS / FAQ_EXTRA, never hand-listed) and for the
 * automatic-only rows (never editable, never showing a stored answer the site ignores).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FAQ_AUTO_ONLY, probePrompts } from '@samfox1/site-bridge/seo'
import { FAQ_EXTRA, FAQ_KEYS } from '@/lib/site-content-schema'
import { AnswersTab } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/answers/answers-tab'
import { saveSeoFieldAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({ saveSeoFieldAction: vi.fn(async () => ({ ok: true })) }))

const seoMock = vi.mocked(saveSeoFieldAction)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const Q = probePrompts('Skeen', 'MusicGroup')
const AUTO = ['Skeen is a Chicago DJ.', 'Skeen makes House.', 'No shows are scheduled right now.', 'Skeen’s latest releases: Loose.', 'Skeen’s official website is skeenmusic.com.']
const show = (initial: Record<string, string> = {}) => render(<AnswersTab artistId="a1" name="Skeen" schemaType="MusicGroup" initial={initial} auto={AUTO} />)
const autoOnly = Object.keys(FAQ_AUTO_ONLY).map((n) => Number(n) - 1)

describe('the fixed questions', () => {
  it('CRITICAL: next show and latest releases are read-only: they come from Tour and Music, with the way there', () => {
    show({ [FAQ_KEYS[autoOnly[0]]]: 'Stale.' })
    for (const i of autoOnly) {
      expect(screen.queryByRole('button', { name: `Edit: ${Q[i]}` })).toBeNull()
      expect(screen.getByText(AUTO[i])).toBeTruthy()
    }
    // The automatic answer shows, never a stored written one (the site ignores it).
    expect(screen.queryByText('Stale.')).toBeNull()
    // The tag is the way there.
    expect(screen.getByRole('link', { name: 'comes from Tour' }).getAttribute('href')).toBe('/artists/a1/tour')
    expect(screen.getByRole('link', { name: 'comes from Music' }).getAttribute('href')).toBe('/artists/a1/music')
  })
  it('CRITICAL: an editable answer opens in place, starting from the automatic one, and saves to its FAQ key', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: `Edit: ${Q[1]}` }))
    const box = screen.getByRole('textbox', { name: `Answer: ${Q[1]}` }) as HTMLTextAreaElement
    expect(box.value).toBe(AUTO[1])
    // Opening writes nothing.
    expect(seoMock).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: 'House, from Chicago.' } })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', FAQ_KEYS[1], 'House, from Chicago.'))
  })
  it('CRITICAL: going back to the automatic answer asks first; No keeps the words', async () => {
    show({ [FAQ_KEYS[0]]: 'My own words.' })
    fireEvent.click(screen.getByRole('button', { name: 'Use the automatic answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await new Promise((r) => setTimeout(r, 20))
    expect(seoMock).not.toHaveBeenCalled()
    expect(screen.getByText('My own words.')).toBeTruthy()
  })
  it('a written answer can go back to the automatic one (after Yes); with none written there is nothing to clear', async () => {
    show({ [FAQ_KEYS[0]]: 'My own words.' })
    expect(screen.getByText('My own words.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use the automatic answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use automatic' }))
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', FAQ_KEYS[0], ''))
    expect(screen.getByText(AUTO[0])).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use the automatic answer' })).toBeNull()
  })
})

describe('your own questions', () => {
  it('CRITICAL: Add question fills the next free slot; Remove clears both halves', async () => {
    show({ [FAQ_EXTRA[0].q]: 'Can I book Skeen?', [FAQ_EXTRA[0].a]: 'Yes.' })
    expect(screen.getByText('Can I book Skeen?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New question' }), { target: { value: 'Where is Skeen from?' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New question' }), { key: 'Enter' })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', FAQ_EXTRA[1].q, 'Where is Skeen from?'))
    // Its answer opens in place.
    fireEvent.change(screen.getByRole('textbox', { name: 'Answer: Where is Skeen from?' }), { target: { value: 'Chicago.' } })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', FAQ_EXTRA[1].a, 'Chicago.'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove: Can I book Skeen?' }))
    // It asks first: nothing is removed until Remove is pressed.
    expect(seoMock).not.toHaveBeenCalledWith('a1', FAQ_EXTRA[0].q, '')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', FAQ_EXTRA[0].q, ''))
    expect(seoMock).toHaveBeenCalledWith('a1', FAQ_EXTRA[0].a, '')
  })
  it('no more than the slots there are: Add question goes when they are full', () => {
    show(Object.fromEntries(FAQ_EXTRA.flatMap((e, i) => [[e.q, `Q${i}?`], [e.a, `A${i}.`]])))
    expect(screen.queryByRole('button', { name: 'Add question' })).toBeNull()
    expect(within(document.body).getAllByRole('button', { name: /^Remove: / })).toHaveLength(FAQ_EXTRA.length)
  })
})
