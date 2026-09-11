// @vitest-environment jsdom
// The video modal on the modal kit: the player, a Title row that renames, a read-only Link row.
/**
 * VideoCard on modal-kit (prototype G, Sam, 2026-09-11). The two-column player / sparkline
 * modal with a ⋯ menu and a separate "Rename video" sheet becomes one card: the player,
 * then rows — Title (saves through renameVideoAction), Link (read-only, with the open
 * mark) — Share and Analytics in the corner, Delete / Done in the footer. No Save, no
 * Rename sheet, no click numbers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { VideoCard, type VideoItem } from '@/app/artists/[id]/(dashboard)/videos/video-card'
import { renameVideoAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  deleteContentAction: vi.fn(async () => ({})),
  renameVideoAction: vi.fn(async () => ({})),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const video: VideoItem = {
  id: 'v1', title: 'Live at Navy Pier', provider: 'youtube', poster: null,
  embed_url: 'https://www.youtube.com/embed/abc123def', storage_path: null, source: 'youtube',
  is_short: false, on_site: true, youtube_views: 45300, stat: 12,
}

function openVideo(v: VideoItem = video) {
  render(<VideoCard video={v} artistId="a1" onSite onToggleOnSite={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Live at Navy Pier/ }))
  return screen.getByRole('dialog', { name: v.title })
}

function rowOf(scope: HTMLElement, label: string): HTMLElement {
  const lab = within(scope).getAllByText(label, { selector: 'span' }).find((el) => el.closest('.group'))!
  return lab.closest('.group') as HTMLElement
}

describe('the video modal', () => {
  it('is headed by the video, plays it, and shows no click numbers', () => {
    const dialog = openVideo()
    expect(within(dialog).getByRole('heading', { name: 'Live at Navy Pier' })).toBeInTheDocument()
    expect(dialog.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube.com/embed/abc123def')
    expect(within(dialog).queryByText(/clicks/i)).toBeNull()
    expect(within(dialog).queryByText(/^12$/)).toBeNull()
  })

  it('CRITICAL: the Title row renames through renameVideoAction', async () => {
    const dialog = openVideo()
    fireEvent.click(within(rowOf(dialog, 'Title')).getByRole('button'))
    const input = within(dialog).getByRole('textbox', { name: 'Title' })
    fireEvent.change(input, { target: { value: 'Navy Pier, full set' } })
    fireEvent.blur(input)
    await waitFor(() => expect(renameVideoAction).toHaveBeenCalledWith('v1', 'a1', 'Navy Pier, full set'))
    // The header follows the row.
    expect(within(dialog).getByRole('heading', { name: 'Navy Pier, full set' })).toBeInTheDocument()
  })

  it('the Link row is read-only and opens the public video page', () => {
    const dialog = openVideo()
    const row = rowOf(dialog, 'Link')
    expect(within(row).queryByRole('button')).toBeNull()
    expect(within(row).getByText('https://www.youtube.com/watch?v=abc123def')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /Open the video/ })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc123def')
  })

  it('a Short links to /shorts/ and keeps a portrait player', () => {
    const dialog = openVideo({ ...video, is_short: true })
    expect(within(dialog).getByRole('link', { name: /Open the video/ })).toHaveAttribute('href', 'https://www.youtube.com/shorts/abc123def')
    expect(dialog.querySelector('iframe')?.parentElement?.className).toMatch(/aspect-\[9\/16\]/)
  })

  it('Share and Analytics sit in the corner; the footer is Delete and Done; no Save, no Rename sheet', () => {
    const dialog = openVideo()
    expect(within(dialog).getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/artists/a1')
    expect(within(dialog).getByRole('button', { name: /Delete/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /^(Save|Rename|Cancel)$/ })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /options/ })).toBeNull()
  })
})
