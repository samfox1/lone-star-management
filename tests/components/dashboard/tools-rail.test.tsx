// @vitest-environment jsdom
// The manager-tools side panel: every tool in the registry, grouped, current one marked.
/**
 * The manager-tools side panel (Sam, 2026-08-28): every tool in the registry, grouped,
 * the current one marked; shown on tool routes only. Expectations derive from TOOLS.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TOOLS, ToolsShell, tabFor, toolFor, toolsFor } from '@/app/artists/[id]/(dashboard)/tools-rail'
import { Icon } from '@/components/ui/icons'

let pathname = '/artists/a1/tools'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
afterEach(cleanup)

describe('toolFor', () => {
  it('maps a pathname to its tool, longest segment first; null off the tools', () => {
    expect(toolFor('/artists/a1/tools', 'a1')?.seg).toBe('tools')
    expect(toolFor('/artists/a1/tools/seo', 'a1')?.seg).toBe('tools/seo')
    expect(toolFor('/artists/a1/enquiries/abc', 'a1')?.seg).toBe('enquiries')
    // A sub-tab route is still ITS TOOL's route: the rail marks Settings, the panel marks the tab.
    expect(toolFor('/artists/a1/settings/email', 'a1')?.seg).toBe('settings')
    expect(toolFor('/artists/a1/music', 'a1')).toBeNull()
    expect(toolFor('/artists/other/tools', 'a1')).toBeNull()
  })
})

describe('ToolsShell', () => {
  it('CRITICAL: on a tool route, lists EVERY tool with the current one marked', () => {
    pathname = '/artists/a1/tools/seo'
    render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)
    const nav = screen.getByRole('navigation', { name: 'Manager tools' })
    for (const t of TOOLS) expect(nav.querySelector(`a[href="/artists/a1/${t.seg}"]`), t.seg).not.toBeNull()
    expect(nav.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/artists/a1/tools/seo')
    expect(screen.getByText('page')).toBeTruthy()
  })
  it('off the tools, the page renders alone', () => {
    pathname = '/artists/a1/music'
    render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)
    expect(screen.queryByRole('navigation', { name: 'Manager tools' })).toBeNull()
    expect(screen.getByText('page')).toBeTruthy()
  })
})

/** The registry decides which tools have sub-tabs; the tests derive from it, never list. */
const tabbed = TOOLS.filter((t) => t.tabs?.length)
const plain = TOOLS.filter((t) => !t.tabs?.length)

describe('tabFor', () => {
  it("maps a path to the tool's tab, longest first, and the tool's own route to the first tab", () => {
    for (const tool of tabbed) {
      expect(tabFor(tool, `/artists/a1/${tool.seg}`, 'a1')?.seg).toBe(tool.tabs![0].seg)
      for (const tab of tool.tabs!) expect(tabFor(tool, `/artists/a1/${tab.seg}/deeper`, 'a1')?.seg).toBe(tab.seg)
    }
    for (const tool of plain) expect(tabFor(tool, `/artists/a1/${tool.seg}`, 'a1')).toBeNull()
  })
})

describe('ToolsShell — a tool with sub-tabs (Sam, 2026-09-22)', () => {
  it('CRITICAL: collapses the rail to icons and opens a second panel listing EVERY tab, current one marked', () => {
    for (const tool of tabbed) {
      const last = tool.tabs![tool.tabs!.length - 1]
      pathname = `/artists/a1/${last.seg}`
      render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)

      const rail = screen.getByRole('navigation', { name: 'Manager tools' })
      expect(rail.getAttribute('data-collapsed')).toBe('true')
      // The rail still marks the TOOL, so Settings lights up while a sub-tab is open.
      expect(rail.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(`/artists/a1/${tool.seg}`)

      const panel = screen.getByRole('navigation', { name: tool.label })
      for (const tab of tool.tabs!) expect(panel.querySelector(`a[href="/artists/a1/${tab.seg}"]`), tab.seg).not.toBeNull()
      expect(panel.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(`/artists/a1/${last.seg}`)

      // The current tab is BOLD as well as accented, and it is the only one.
      for (const tab of tool.tabs!) {
        const link = panel.querySelector(`a[href="/artists/a1/${tab.seg}"]`)!
        expect(link.className.includes('font-bold'), `${tab.seg} bold?`).toBe(tab.seg === last.seg)
      }
      // Bold BLACK, not accent (Sam, 2026-09-23): the rail beside it already lights the
      // tool in accent; a second blue would say "two things are selected".
      const current = panel.querySelector('a[aria-current="page"]')!
      expect(current.className).toMatch(/(^|\s)text-ink(\s|$)/)
      expect(current.className).not.toMatch(/text-accent/)

      // It starts where the RAIL's first icon does, not centred on its own short column.
      // With two tabs against nine tools, centring it left the panel floating halfway down
      // an empty rail (Sam, 2026-09-22). jsdom does no layout, so the mechanism is what is
      // pinned: an offset that reads 50vh, and NO self-centring transform.
      const column = panel.querySelector('div')
      expect(column?.className, tool.seg).not.toMatch(/-translate-y-1\/2/)
      expect(column?.getAttribute('style') ?? '', tool.seg).toContain('50vh')
      cleanup()
    }
  })

  it('a tool WITHOUT sub-tabs keeps the full rail and no second panel', () => {
    const tool = plain[0]
    pathname = `/artists/a1/${tool.seg}`
    render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)

    expect(screen.getByRole('navigation', { name: 'Manager tools' }).getAttribute('data-collapsed')).toBe('false')
    for (const t of tabbed) expect(screen.queryByRole('navigation', { name: t.label })).toBeNull()
  })

  it('CRITICAL: the collapsed rail keeps every label IN THE FLOW, faded not removed', () => {
    // Sam, 2026-09-22: the icons must not move when the labels appear. jsdom does no
    // layout, so what can be pinned is the mechanism — `opacity-0`, which reserves the
    // label's height, and never `hidden`, which drops it from the flow and lets this
    // vertically-centred stack slide. The rail is also ONE width now: an icon cannot be
    // centred in both 56px and 84px, so the width change went rather than the centring.
    const tool = tabbed[0]
    pathname = `/artists/a1/${tool.seg}`
    render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)

    const rail = screen.getByRole('navigation', { name: 'Manager tools' })

    // Thin, and it widens on hover — both halves of what Sam asked for.
    expect(rail.className).toMatch(/w-\[52px\]/)
    expect(rail.className).toMatch(/hover:w-\[84px\]/)

    // The column carries NO width of its own, so it stretches to the nav and the icons
    // re-centre as it widens. Sam asked for that explicitly ("it should horizontally
    // center"); an earlier build pinned this column to hold the icons still and left them
    // off-centre in the widened rail instead.
    expect(rail.querySelector('div')?.className).not.toMatch(/w-\[\d+px\]|w-full/)

    for (const t of TOOLS) {
      const label = [...rail.querySelectorAll('span')].find((el) => el.textContent === (t.short ?? t.label))
      expect(label, t.seg).toBeTruthy()
      // Faded, never removed: `hidden` shortens every row, and this stack is centred on
      // 50vh, so the icons would slide UP AND DOWN on hover. That is the one movement
      // Sam does not want.
      expect(label!.className, t.seg).toContain('opacity-0')
      expect(label!.className, t.seg).not.toMatch(/(^|\s)hidden(\s|$)/)
    }
  })
})

describe('the second panel lines up with the rail (review 2026-09-23)', () => {
  it('CRITICAL: every rail row is pinned to the height the panel offset is computed from', () => {
    // The offset assumed 52px rows, but the rows were sized by their content: the 10px
    // label took Tailwind's default 1.5 line-height (15px), each row came to ~55px, and
    // the panel sat ~13px above the rail's first icon. jsdom does no layout, so the pin
    // is the mechanism: each row carries an explicit height, and the panel's offset is
    // exactly what that height and the row count give.
    const tool = TOOLS.find((t) => t.tabs?.length)!
    pathname = `/artists/a1/${tool.seg}`
    render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)

    const rows = [...screen.getByRole('navigation', { name: 'Manager tools' }).querySelectorAll('a')]
    expect(rows).toHaveLength(TOOLS.length)
    const heights = new Set(rows.map((a) => a.style.height))
    expect(heights.size).toBe(1)
    const h = parseFloat([...heights][0])
    expect(h).toBeGreaterThan(0)

    // The label's line box is fixed too, so its content cannot outgrow the row.
    for (const a of rows) expect(a.querySelector('span')!.className).toMatch(/leading-\[\d+px\]/)

    const gap = 4 // gap-1 on the column
    const top = (TOOLS.length * h + (TOOLS.length - 1) * gap) / 2
    const column = screen.getByRole('navigation', { name: tool.label }).querySelector('div')!
    expect(column.style.marginTop).toBe(`calc(50vh - ${top}px)`)
  })
})

describe('every tool icon draws something', () => {
  it('CRITICAL: each TOOLS icon has a glyph in the icon set', () => {
    // A name missing from PATHS renders an EMPTY <svg> with no error: a rail of blank
    // squares, and nothing red. Derived from TOOLS so a renamed icon cannot slip past.
    for (const t of TOOLS) {
      const { container, unmount } = render(<Icon name={t.icon} />)
      expect(container.querySelector('svg')!.children.length, t.icon).toBeGreaterThan(0)
      unmount()
    }
  })
})

describe('the Site tool leaves the rail once the artist has a custom site (Sam, 2026-09-23)', () => {
  // The Site page is the template era: a template picker, the template's text fields and
  // a media panel. A bridge-connected site ignores all three and the editor owns the rest,
  // so for those artists it is three dead controls and a second Publish button. It stays
  // for a template-hosted artist (FTBK) until that site has a real URL.
  const tool = TOOLS.find((t) => t.tabs?.length)!

  it('CRITICAL: hidden for a custom-site artist, and the second panel offset shrinks with it', () => {
    pathname = `/artists/a1/${tool.seg}`
    render(<ToolsShell artistId="a1" customSite><p>page</p></ToolsShell>)
    const rail = screen.getByRole('navigation', { name: 'Manager tools' })
    expect(rail.querySelector('a[href="/artists/a1/site"]')).toBeNull()
    const rows = [...rail.querySelectorAll('a')]
    expect(rows).toHaveLength(toolsFor(true).length)
    expect(toolsFor(true).length).toBe(TOOLS.length - 1)
    // Derived from the VISIBLE rows, or the panel would float 28px above the first icon.
    const h = parseFloat(rows[0].style.height)
    const top = (rows.length * h + (rows.length - 1) * 4) / 2
    expect(screen.getByRole('navigation', { name: tool.label }).querySelector('div')!.style.marginTop).toBe(`calc(50vh - ${top}px)`)
  })

  it('kept for a template-hosted artist', () => {
    pathname = `/artists/a1/${tool.seg}`
    render(<ToolsShell artistId="a1" customSite={false}><p>page</p></ToolsShell>)
    expect(screen.getByRole('navigation', { name: 'Manager tools' }).querySelector('a[href="/artists/a1/site"]')).not.toBeNull()
    expect(toolsFor(false)).toEqual(TOOLS)
  })
})
