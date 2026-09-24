// @vitest-environment jsdom
// The Tab icon tab's three rows: built-in titles, guide text, previews, and the bar colour.
/**
 * IconRows (brand/icons/icon-rows.tsx, BRAND_PAGE_PLAN.md "Tab icon"): Tab icon, Home-screen
 * icon, Browser bar. All three are BUILT-IN rows — a fixed title and fixed grey guide text,
 * never renamable, never a note. The two icons preview the generated file (the home-screen
 * one in a rounded phone-icon square) with a pencil that opens the editor; the browser bar
 * is a swatch + hex that saves as you go.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DEFAULT_FRAMING, faviconDrawBox } from '@/lib/brand'
import { canvas, installCanvasFakes, lastDrawAt, LOGO } from '@tests/components/brand/icons/_canvas'

vi.mock('@/app/artists/[id]/(dashboard)/brand/actions', () => ({
  setBrandAssetAction: vi.fn(async () => ({})),
  saveFramingAction: vi.fn(async () => ({})),
  setIconSourceAction: vi.fn(async () => ({})),
  addIconSourceAction: vi.fn(async () => ({ mediaId: 'u9' })),
  setThemeColorAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/app/artists/[id]/(dashboard)/upload-field', () => ({ UploadField: () => null }))

import { IconRows, type IconRowData } from '@/app/artists/[id]/(dashboard)/brand/icons/icon-rows'
import { setThemeColorAction } from '@/app/artists/[id]/(dashboard)/brand/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

const ROW = (over: Partial<IconRowData> = {}): IconRowData => ({
  generatedUrl: 'https://img.example/tab.png',
  source: { id: 'p', url: 'https://img.example/primary.png' },
  framing: DEFAULT_FRAMING,
  ...over,
})

function renderRows(over: { themeColor?: string | null; favicon?: IconRowData; homeIcon?: IconRowData } = {}) {
  return render(
    <IconRows
      artistId="a1"
      favicon={over.favicon ?? ROW()}
      homeIcon={over.homeIcon ?? ROW({ generatedUrl: 'https://img.example/home.png' })}
      logos={[{ id: 'p', label: 'Primary logo', url: 'https://img.example/primary.png' }]}
      themeColor={over.themeColor === undefined ? '#0d0d0d' : over.themeColor}
      colors={[{ name: 'Ink', hex: '#0d0d0d' }]}
    />,
  )
}
const rows = () => [...document.querySelectorAll('[data-ledger-row]')] as HTMLElement[]
const rowNamed = (title: string) => rows().find((r) => r.textContent?.startsWith(title))!

beforeEach(installCanvasFakes)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('IconRows — built-in rows', () => {
  it('CRITICAL: three fixed rows with fixed guide text — not renamable, no notes', () => {
    renderRows()
    expect(rows().map((r) => r.querySelector('.font-medium')?.textContent)).toEqual(['Tab icon', 'Home-screen icon', 'Browser bar'])
    expect(rowNamed('Tab icon').textContent).toContain('Browser tabs and bookmarks.')
    expect(rowNamed('Home-screen icon').textContent).toContain('When a fan saves the site to their phone.')
    expect(rowNamed('Browser bar').textContent).toContain('The phone browser')
    // No title is a textbox (renamable) and no row carries a note field.
    expect(screen.queryAllByRole('textbox', { name: 'Name' })).toHaveLength(0)
    expect(screen.queryAllByRole('textbox', { name: 'Note' })).toHaveLength(0)
    expect(screen.queryByText('Add a note…')).toBeNull()
    expect(document.querySelector('[contenteditable]')).toBeNull()
    // Built-in rows cannot be deleted either.
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('each icon row previews the GENERATED file, and has an Edit pencil', () => {
    renderRows()
    expect(within(rowNamed('Tab icon')).getByRole('img', { name: 'Tab icon' }).getAttribute('src')).toBe('https://img.example/tab.png')
    expect(within(rowNamed('Home-screen icon')).getByRole('img', { name: 'Home-screen icon' }).getAttribute('src')).toBe('https://img.example/home.png')
    expect(within(rowNamed('Tab icon')).getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(within(rowNamed('Home-screen icon')).getByRole('button', { name: 'Edit' })).toBeTruthy()
  })

  it('CRITICAL: the home-screen preview sits in a rounded-square mask; the tab icon is a 64px tile', () => {
    renderRows()
    const home = rowNamed('Home-screen icon').querySelector('[data-icon-shape]') as HTMLElement
    const tab = rowNamed('Tab icon').querySelector('[data-icon-shape]') as HTMLElement
    expect(home.dataset.iconShape).toBe('rounded-square')
    // The mask is real: corners rounded AND the image clipped to them.
    expect(home.className).toMatch(/(^|\s)rounded-\[14px\]/)
    expect(home.className).toMatch(/(^|\s)overflow-hidden/)
    expect(tab.dataset.iconShape).toBe('tab')
    expect(tab.className).toMatch(/(^|\s)h-16/)
  })

  it('CRITICAL: no PNG yet but a source (Skeen\'s home-screen icon: the primary logo) → the row draws the icon LIVE from the source and its framing, never blank', async () => {
    const framing = { zoom: 2.5, offsetY: -0.2 }
    renderRows({ homeIcon: ROW({ generatedUrl: null, source: { id: 'p', url: 'https://img.example/primary.png' }, framing }) })
    const live = within(rowNamed('Home-screen icon')).getByRole('img', { name: 'Home-screen icon' })
    expect(live.tagName).toBe('CANVAS')
    // The same maths the editor and the export use (drawFavicon), at the row canvas's size.
    const size = Number(live.getAttribute('width'))
    await waitFor(() => expect(lastDrawAt(size)).toEqual(Object.values(faviconDrawBox(LOGO, framing, size))))
    expect(canvas.srcs).toContain('https://img.example/primary.png')
    // …inside the same rounded-square mask as a generated one.
    expect(live.closest('[data-icon-shape]')?.getAttribute('data-icon-shape')).toBe('rounded-square')
  })

  it('the tab icon too; and a generated PNG, once there is one, is what the row shows', () => {
    renderRows({ favicon: ROW({ generatedUrl: null }) })
    expect(within(rowNamed('Tab icon')).getByRole('img', { name: 'Tab icon' }).tagName).toBe('CANVAS')
    expect(within(rowNamed('Home-screen icon')).getByRole('img', { name: 'Home-screen icon' }).tagName).toBe('IMG')
  })

  it('no PNG and nothing to frame (no logo at all) → an empty tile, no canvas', () => {
    renderRows({ favicon: ROW({ generatedUrl: null, source: { id: null, url: null } }) })
    expect(within(rowNamed('Tab icon')).queryByRole('img')).toBeNull()
  })

  it('Edit opens the editor for THAT icon', () => {
    renderRows()
    fireEvent.click(within(rowNamed('Home-screen icon')).getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('dialog', { name: 'Home-screen icon' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Tab icon' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByRole('dialog', { name: 'Home-screen icon' })).toBeNull()
  })
})

describe('IconRows — Browser bar', () => {
  it('shows the saved colour as a swatch and hex', () => {
    renderRows()
    expect((screen.getByLabelText('Browser bar hex') as HTMLInputElement).value.toLowerCase()).toBe('#0d0d0d')
    expect(screen.getByRole('button', { name: 'Browser bar palette' })).toBeTruthy()
  })

  it('CRITICAL: a new colour saves as you go — debounced, so quick changes are ONE write of the last', async () => {
    vi.useFakeTimers()
    renderRows()
    const hex = screen.getByLabelText('Browser bar hex')
    fireEvent.change(hex, { target: { value: '#112233' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    // A second colour a moment later (a drag across the shade square is dozens of these).
    await act(async () => vi.advanceTimersByTimeAsync(150))
    fireEvent.change(hex, { target: { value: '#223344' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    expect(vi.mocked(setThemeColorAction)).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(vi.mocked(setThemeColorAction)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(setThemeColorAction)).toHaveBeenCalledWith('a1', '#223344')
  })

  it('the same colour again is not a change', async () => {
    vi.useFakeTimers()
    renderRows()
    const hex = screen.getByLabelText('Browser bar hex')
    fireEvent.change(hex, { target: { value: '#0D0D0D' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(vi.mocked(setThemeColorAction)).not.toHaveBeenCalled()
  })

  it('a refusal is an error toast', async () => {
    vi.useFakeTimers()
    vi.mocked(setThemeColorAction).mockResolvedValueOnce({ error: 'Use a color code like #1a2b3c.' })
    renderRows()
    const hex = screen.getByLabelText('Browser bar hex')
    fireEvent.change(hex, { target: { value: '#445566' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(vi.mocked(toast)).toHaveBeenCalledWith('Use a color code like #1a2b3c.', 'error')
  })

  it('with no colour set, the row offers a + that opens the picker', () => {
    renderRows({ themeColor: null })
    const add = within(rowNamed('Browser bar')).getByRole('button', { name: 'Pick a color' })
    fireEvent.click(add)
    expect(screen.getByRole('dialog', { name: 'Browser bar palette' })).toBeTruthy()
  })
})
