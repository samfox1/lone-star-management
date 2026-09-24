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
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) } }),
}))
vi.mock('@/app/artists/[id]/(dashboard)/upload-field', () => ({ UploadField: () => null }))

import { IconRows, type IconRowData } from '@/app/artists/[id]/(dashboard)/brand/icons/icon-rows'
import { BrowserBarColor } from '@/app/artists/[id]/(dashboard)/brand/icons/browser-bar'
import { saveFramingAction, setBrandAssetAction, setThemeColorAction } from '@/app/artists/[id]/(dashboard)/brand/actions'
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

  // Review 2 (2026-09-24): the row knows whether a PNG exists (`generatedUrl`); the editor
  // must be told, or an icon never generated counts as "already saved" and can never be
  // made at the framing the manager sees.
  it('CRITICAL: an icon with NO PNG yet: Edit → Save makes it (the row tells the editor nothing is saved)', async () => {
    renderRows({ homeIcon: ROW({ generatedUrl: null }) })
    fireEvent.click(within(rowNamed('Home-screen icon')).getByRole('button', { name: 'Edit' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(vi.mocked(setBrandAssetAction)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(setBrandAssetAction).mock.calls[0][1]).toBe('home_icon')
    expect(vi.mocked(saveFramingAction)).toHaveBeenCalledWith('a1', DEFAULT_FRAMING, 'home_icon')
  })

  it('…and with a PNG, Edit → Save writes nothing', async () => {
    renderRows()
    fireEvent.click(within(rowNamed('Home-screen icon')).getByRole('button', { name: 'Edit' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await act(async () => new Promise((r) => setTimeout(r, 50)))
    expect(vi.mocked(saveFramingAction)).not.toHaveBeenCalled()
    expect(vi.mocked(setBrandAssetAction)).not.toHaveBeenCalled()
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

  // Review 2 (2026-09-24): each save revalidates the page, and the refresh carrying an
  // EARLIER save could land while a newer pick was still on its way — the row re-seeded
  // from it and snapped back mid-pick.
  describe('a refresh never paints over a newer pick', () => {
    const hexNow = () => (screen.getByLabelText('Browser bar hex') as HTMLInputElement).value.toLowerCase()
    const pickHex = (value: string) => {
      const hex = screen.getByLabelText('Browser bar hex')
      fireEvent.change(hex, { target: { value } })
      fireEvent.keyDown(hex, { key: 'Enter' })
    }
    const bar = (value: string | null) => <BrowserBarColor artistId="a1" value={value} colors={[]} />

    it('CRITICAL: an earlier save\'s refresh landing mid-pick does not snap the row back', async () => {
      vi.useFakeTimers()
      const { rerender } = render(bar('#0d0d0d'))
      pickHex('#111111')
      await act(async () => vi.advanceTimersByTimeAsync(600)) // A saves
      expect(vi.mocked(setThemeColorAction)).toHaveBeenCalledWith('a1', '#111111')
      pickHex('#222222') // B, its debounce still running…
      rerender(bar('#111111')) // …and A's refresh lands
      expect(hexNow(), 'snapped back to the earlier save').toBe('#222222')
      await act(async () => vi.advanceTimersByTimeAsync(600)) // B saves
      rerender(bar('#222222')) // B's refresh
      expect(hexNow()).toBe('#222222')
    })

    it('with no pick waiting, a new value from the server IS shown (another tab changed it)', () => {
      const { rerender } = render(bar('#0d0d0d'))
      rerender(bar('#abcdef'))
      expect(hexNow()).toBe('#abcdef')
    })

    it('once its own refresh has landed, the row follows the server again', async () => {
      vi.useFakeTimers()
      const { rerender } = render(bar('#0d0d0d'))
      pickHex('#111111')
      await act(async () => vi.advanceTimersByTimeAsync(600))
      rerender(bar('#111111')) // the pick's own echo: caught up
      rerender(bar('#333333')) // then someone else's change
      expect(hexNow()).toBe('#333333')
    })

    it('a refused pick puts the saved colour back — and does not freeze the row', async () => {
      vi.useFakeTimers()
      vi.mocked(setThemeColorAction).mockResolvedValueOnce({ error: 'Use a color code like #1a2b3c.' })
      const { rerender } = render(bar('#0d0d0d'))
      pickHex('#445566')
      await act(async () => vi.advanceTimersByTimeAsync(600))
      expect(vi.mocked(toast)).toHaveBeenCalledWith('Use a color code like #1a2b3c.', 'error')
      expect(hexNow()).toBe('#0d0d0d')
      rerender(bar('#777777'))
      expect(hexNow()).toBe('#777777')
    })
  })

  it('with no colour set, the row offers a + that opens the picker', () => {
    renderRows({ themeColor: null })
    const add = within(rowNamed('Browser bar')).getByRole('button', { name: 'Pick a color' })
    fireEvent.click(add)
    expect(screen.getByRole('dialog', { name: 'Browser bar palette' })).toBeTruthy()
  })
})
