// @vitest-environment jsdom
/**
 * The SEO / GEO Details tab: the page title and description save through the SEO gate (never
 * over their caps), the preview follows, and the share and photo rows open their editors.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/details/details-tab.tsx,
 *           og-image-picker.tsx
 * Feature:  SEO / GEO page · Details tab, the tool's own route (the Listing tab until 2026-09-29;
 *           round 2, prototypes/seo_variants_20260928_r2.html); feeds the `title`, `desc`,
 *           `share`, `preview` and `alt` tests
 * Tier:     STRICT (AGENTS.md "Test depth") for what gets saved (the gate, the key, never a value
 *           over its cap) and for the ids a test's pencil lands on (`share`, `alt`); LIGHT for the rest.
 * Covers:   • the title saves to seo_title; blank shows the composed default; the preview follows
 *           • a title or description over its cap is kept, refused in the gate's words, never sent
 *           • the share and alt rows carry the ids the pencils land on; #share opens the picture editor
 *           • the preview picture's background can be a Brand colour, with no Save pill
 *           • photo descriptions: one photo at a time, each saving to THAT photo; arrow keys move
 *             between photos except while typing
 *           • a count shows only while its field is being written
 * Not here: the save rules (tests/unit/manager-tools/seo/save-rules.test.ts); the preview
 *           picture's geometry (tests/unit/manager-tools/seo/og-card.test.ts).
 * Fixtures: the save actions, the preview-picture action and the router are mocks; one made-up
 *           photo list and one Brand colour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MAX_DESCRIPTION, MAX_TITLE } from '@samfox1/site-bridge/seo'
import { DetailsTab, DESCRIPTION_CAP, type AltPhoto } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/details/details-tab'
import { SEO_EDIT_TARGETS } from '@/lib/manager-tools/seo/sections'
import { saveSeoFieldAction, setMediaAltAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveSeoFieldAction: vi.fn(async () => ({ ok: true })),
  setMediaAltAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/actions', () => ({ saveOgCardAction: vi.fn(async () => ({ url: 'https://x/og.png' })) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const seoMock = vi.mocked(saveSeoFieldAction)
const altMock = vi.mocked(setMediaAltAction)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

const PHOTOS: AltPhoto[] = [{ id: 'm1', url: 'https://cdn/x/a.jpg', alt: '', slug: 'a', caption: 'Tour w: Jigitz' }]
const show = (over: Partial<Parameters<typeof DetailsTab>[0]> = {}) =>
  render(
    <DetailsTab
      artistId="a1"
      artistName="Skeen"
      defaultTitle="Skeen · Chicago house musician"
      bio="A Chicago DJ."
      siteUrl="https://www.skeenmusic.com"
      initial={{ seo_title: '', seo_description: '' }}
      shareUrl=""
      sources={[{ url: 'https://cdn/logo.png', label: 'Primary logo' }]}
      photos={PHOTOS}
      brandColors={[{ name: 'Cream', hex: '#f4f1ea', key: 'cream' }]}
      {...over}
    />,
  )

describe('Google', () => {
  // The title saves to its key through the SEO gate; blank shows the default, and the preview follows.
  it('CRITICAL: the title saves to seo_title through the SEO gate; blank shows the composed default', async () => {
    show()
    const box = screen.getByRole('textbox', { name: 'Page title' }) as HTMLInputElement
    expect(box.placeholder).toBe('Skeen · Chicago house musician')
    expect(screen.getByTestId('google-preview').textContent).toContain('Skeen · Chicago house musician')
    fireEvent.change(box, { target: { value: 'SKEEN' } })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', 'seo_title', 'SKEEN'))
    expect(screen.getByTestId('google-preview').textContent).toContain('SKEEN')
  })
  // A title over the cap is kept (not cut), refused in the gate's words, and never sent.
  it('CRITICAL: a title over the cap is refused in the gate’s words and never sent (kept, not cut)', async () => {
    vi.useFakeTimers()
    show()
    const box = screen.getByRole('textbox', { name: 'Page title' }) as HTMLInputElement
    fireEvent.change(box, { target: { value: 'x'.repeat(MAX_TITLE + 1) } })
    expect(box.value).toHaveLength(MAX_TITLE + 1)
    expect(screen.getByRole('alert').textContent).toBe(`Keep it under ${MAX_TITLE} characters. Not saved.`)
    vi.advanceTimersByTime(1000)
    expect(seoMock).not.toHaveBeenCalled()
  })
  // The description has ONE limit (Google's): over it, never sent; under it, saved.
  it('CRITICAL: the description saves to seo_description; over its ONE limit (Google’s) it is never sent', async () => {
    vi.useFakeTimers()
    show()
    const box = screen.getByRole('textbox', { name: 'Description' })
    fireEvent.change(box, { target: { value: 'y'.repeat(DESCRIPTION_CAP + 1) } })
    expect(DESCRIPTION_CAP).toBe(MAX_DESCRIPTION)
    expect(screen.getByRole('alert').textContent).toBe(`Keep it under ${MAX_DESCRIPTION} characters. Not saved.`)
    vi.advanceTimersByTime(1000)
    expect(seoMock).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: 'A Chicago house DJ and producer.' } })
    vi.advanceTimersByTime(1000)
    expect(seoMock).toHaveBeenCalledWith('a1', 'seo_description', 'A Chicago house DJ and producer.')
  })
})

describe('share and alt', () => {
  // The share and alt tests' pencils land on these rows' ids.
  it('CRITICAL: the rows carry the ids a test’s pencil lands on', () => {
    show()
    for (const target of ['share', 'alt'] as const) {
      const hash = SEO_EDIT_TARGETS[target].split('#')[1]
      expect(document.getElementById(hash), target).toBeTruthy()
    }
  })
  // Arriving on #share opens the preview picture editor.
  it('landing on #share opens the preview picture editor', async () => {
    window.history.replaceState(null, '', `/artists/a1/${SEO_EDIT_TARGETS.share}`)
    show()
    expect(await screen.findByRole('dialog', { name: 'Preview picture' })).toBeTruthy()
  })
  // A Brand colour can be the background; trying colours writes nothing (one explicit action, no Save pill).
  it('the background can be a Brand colour: the picker offers it first, and the picture takes it', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Make a preview picture' }))
    const dialog = screen.getByRole('dialog', { name: 'Preview picture' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Background palette' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /^Background Cream/ }))
    expect((within(dialog).getByLabelText('Preview picture') as HTMLCanvasElement).style.backgroundColor).toBe('rgb(244, 241, 234)')
    // One explicit action, an icon, never a Save pill: trying colours writes nothing.
    expect(within(dialog).getByRole('button', { name: 'Use this picture' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull()
  })
})

describe('photo descriptions', () => {
  const THREE: AltPhoto[] = [
    { id: 'm1', url: 'https://cdn/x/a.jpg', alt: '', slug: 'a', caption: 'Tour w: Jigitz' },
    { id: 'm2', url: 'https://cdn/x/b.jpg', alt: 'Skeen at the Salt Shed', slug: 'b', caption: null },
    { id: 'm3', url: 'https://cdn/x/c.jpg', alt: '', slug: 'c', caption: null },
  ]
  // Photo descriptions: one at a time, each saved to THAT photo, with a readable suggestion (no file-name code).
  it('CRITICAL: one photo at a time; its words save to THAT photo; no file-name code', async () => {
    show({ photos: THREE })
    expect(screen.getByText('3 photos')).toBeTruthy()
    expect(screen.queryByText(/described for you/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open the photos' }))
    const dialog = screen.getByRole('dialog', { name: 'Photo descriptions' })
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1)
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull() // each photo saves itself
    expect(within(dialog).getByText('1 of 3')).toBeTruthy()
    expect((within(dialog).getByRole('textbox', { name: 'Description of photo 1' }) as HTMLTextAreaElement).placeholder).toBe('Skeen, Tour with Jigitz')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next photo' }))
    const second = within(dialog).getByRole('textbox', { name: 'Description of photo 2' }) as HTMLTextAreaElement
    expect(second.value).toBe('Skeen at the Salt Shed')
    fireEvent.change(second, { target: { value: 'Skeen at the Salt Shed, Chicago' } })
    await vi.waitFor(() => expect(altMock).toHaveBeenCalledWith('a1', 'm2', 'Skeen at the Salt Shed, Chicago'))
    expect(altMock).not.toHaveBeenCalledWith('a1', 'm1', expect.anything())
  })
  // Arrow keys move between photos, except while typing.
  it('the arrow keys move between photos, except while typing', () => {
    show({ photos: THREE })
    fireEvent.click(screen.getByRole('button', { name: 'Open the photos' }))
    const dialog = screen.getByRole('dialog', { name: 'Photo descriptions' })
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(within(dialog).getByText('2 of 3')).toBeTruthy()
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'ArrowRight' })
    expect(within(dialog).getByText('2 of 3')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(within(dialog).getByText('1 of 3')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Previous photo' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('calm rows', () => {
  // Calm rows: a count only while typing in its field, and no descriptor lines (Sam's notes).
  it('a count shows only while its field is being written; no descriptor lines', () => {
    show()
    expect(screen.queryByText(/ of 70$/)).toBeNull()
    expect(screen.queryByText('Blank builds it from Facts.')).toBeNull()
    expect(screen.queryByText('Blank uses the bio.')).toBeNull()
    const title = screen.getByRole('textbox', { name: 'Page title' })
    fireEvent.focus(title)
    expect(screen.getByText(/ of 70$/)).toBeTruthy()
    fireEvent.blur(title)
    expect(screen.queryByText(/ of 70$/)).toBeNull()
  })
})
