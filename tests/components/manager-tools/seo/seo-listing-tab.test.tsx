// @vitest-environment jsdom
// SEO / GEO Listing: the title and description save through the SEO gate (never over their
// caps), the preview follows, the share and alt rows keep their ids and open their editors.
/**
 * Round 2's Listing (prototypes/seo_variants_20260928_r2.html). STRICT for what gets saved
 * (the gate, the key, never a value over its cap) and for the ids a test's pencil lands on
 * (`share`, `alt`: sections.ts SEO_EDIT_TARGETS); LIGHT for the rest.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MAX_TITLE } from '@samfox1/site-bridge/seo'
import { ListingTab, DESCRIPTION_CAP, type AltPhoto } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/listing/listing-tab'
import { SEO_EDIT_TARGETS } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/sections'
import { renameMediaAction, saveSeoFieldAction, setMediaAltAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveSeoFieldAction: vi.fn(async () => ({ ok: true })),
  setMediaAltAction: vi.fn(async () => ({})),
  renameMediaAction: vi.fn(async () => ({ storage_path: 'a1/gallery/skeen-oslo.jpg' })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/actions', () => ({ saveOgCardAction: vi.fn(async () => ({ url: 'https://x/og.png' })) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const seoMock = vi.mocked(saveSeoFieldAction)
const altMock = vi.mocked(setMediaAltAction)
const renameMock = vi.mocked(renameMediaAction)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

const PHOTOS: AltPhoto[] = [{ id: 'm1', url: 'https://cdn/x/a.jpg', alt: '', slug: 'a', caption: 'Tour w: Jigitz' }]
const show = (over: Partial<Parameters<typeof ListingTab>[0]> = {}) =>
  render(
    <ListingTab
      artistId="a1"
      artistName="Skeen"
      defaultTitle="Skeen · Chicago house musician"
      bio="A Chicago DJ."
      siteUrl="https://www.skeenmusic.com"
      initial={{ seo_title: '', seo_description: '' }}
      shareUrl=""
      sources={[{ url: 'https://cdn/logo.png', label: 'Primary logo' }]}
      photos={PHOTOS}
      {...over}
    />,
  )

describe('Google', () => {
  it('CRITICAL: the title saves to seo_title through the SEO gate; blank shows the composed default', async () => {
    show()
    const box = screen.getByRole('textbox', { name: 'Page title' }) as HTMLInputElement
    expect(box.placeholder).toBe('Skeen · Chicago house musician')
    expect(screen.getByTestId('google-preview').textContent).toContain('Skeen · Chicago house musician')
    fireEvent.change(box, { target: { value: 'SKEEN' } })
    await vi.waitFor(() => expect(seoMock).toHaveBeenCalledWith('a1', 'seo_title', 'SKEEN'))
    expect(screen.getByTestId('google-preview').textContent).toContain('SKEEN')
  })
  it('CRITICAL: a title over the cap is refused in the gate’s words and never sent (kept, not cut)', async () => {
    vi.useFakeTimers()
    show()
    const box = screen.getByRole('textbox', { name: 'Page title' }) as HTMLInputElement
    fireEvent.change(box, { target: { value: 'x'.repeat(MAX_TITLE + 1) } })
    expect(box.value).toHaveLength(MAX_TITLE + 1)
    expect(screen.getByRole('alert').textContent).toBe(`Keep it under ${MAX_TITLE} characters.`)
    vi.advanceTimersByTime(1000)
    expect(seoMock).not.toHaveBeenCalled()
  })
  it('CRITICAL: the description saves to seo_description; over its cap it is never sent', async () => {
    vi.useFakeTimers()
    show()
    const box = screen.getByRole('textbox', { name: 'Description' })
    fireEvent.change(box, { target: { value: 'y'.repeat(DESCRIPTION_CAP + 1) } })
    vi.advanceTimersByTime(1000)
    expect(seoMock).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: 'A Chicago house DJ and producer.' } })
    vi.advanceTimersByTime(1000)
    expect(seoMock).toHaveBeenCalledWith('a1', 'seo_description', 'A Chicago house DJ and producer.')
  })
})

describe('share and alt', () => {
  it('CRITICAL: the rows carry the ids a test’s pencil lands on', () => {
    show()
    for (const target of ['share', 'alt'] as const) {
      const hash = SEO_EDIT_TARGETS[target].split('#')[1]
      expect(document.getElementById(hash), target).toBeTruthy()
    }
  })
  it('landing on #share opens the share picture editor', async () => {
    window.history.replaceState(null, '', '/artists/a1/tools/seo/listing#share')
    show()
    expect(await screen.findByRole('dialog', { name: 'Share image' })).toBeTruthy()
  })
  it('alt text saves as it is typed; the file name renames when the field is left', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Open the photos' }))
    const alt = screen.getByRole('textbox', { name: 'Alt text for a' }) as HTMLInputElement
    expect(alt.placeholder).toBe('Skeen, Tour with Jigitz')
    fireEvent.change(alt, { target: { value: 'Skeen at Smartbar' } })
    await vi.waitFor(() => expect(altMock).toHaveBeenCalledWith('a1', 'm1', 'Skeen at Smartbar'))
    const file = screen.getByRole('textbox', { name: 'File name for a' })
    fireEvent.change(file, { target: { value: 'skeen-oslo' } })
    fireEvent.blur(file)
    await vi.waitFor(() => expect(renameMock).toHaveBeenCalledWith('a1', 'm1', 'skeen-oslo'))
  })
})
