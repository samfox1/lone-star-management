// @vitest-environment jsdom
// The manager-tools side panel: every tool in the registry, grouped, current one marked.
/**
 * The manager-tools side panel (Sam, 2026-08-28): every tool in the registry, grouped,
 * the current one marked; shown on tool routes only. Expectations derive from TOOLS.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TOOLS, ToolsShell, tabFor, toolFor, toolsFor } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_shell/tools-rail'
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

describe('every tool and sub-tab leads somewhere', () => {
  // Every manager tool's route lives in the `(manager-tools)` route group (2026-09-24). A
  // route group is not in the URL, so `/artists/[id]/brand` resolves from
  // (dashboard)/(manager-tools)/brand/page.tsx; these read that folder.
  const tools = join(process.cwd(), 'src/app/artists/[id]/(dashboard)/(manager-tools)')

  it('CRITICAL: each tab in TOOLS has a page.tsx in the (manager-tools) group', () => {
    // A tab whose route has no page is a 404 in the second panel, and nothing else would
    // say so: the link renders, the test for the panel passes. Derived from TOOLS, so a
    // tab added to the registry without its page goes red here.
    const tabs = TOOLS.flatMap((t) => t.tabs ?? [])
    expect(tabs.length).toBeGreaterThan(0)
    for (const tab of tabs) expect(existsSync(join(tools, tab.seg, 'page.tsx')), tab.seg).toBe(true)
  })

  it('CRITICAL: each tool in TOOLS has its page.tsx in the (manager-tools) group', () => {
    // The rail's own links, and the folder rule: a tool added to the registry with its
    // route anywhere but the group is misfiled (or missing) and goes red here.
    expect(TOOLS.length).toBeGreaterThan(0)
    for (const t of TOOLS) expect(existsSync(join(tools, t.seg, 'page.tsx')), t.seg).toBe(true)
  })
})

describe('the second panel is as wide as its LONGEST label (Sam, 2026-09-23)', () => {
  // "Tab icon" must not wrap or truncate: the panel widens and the page moves over. jsdom
  // does no layout, so the mechanism is what is pinned: no fixed width anywhere, labels
  // that cannot wrap or clip, and an in-flow sizer carrying EVERY label, because the
  // visible panel is `fixed` and a fixed box pushes nothing.
  for (const tool of tabbed) {
    it(`CRITICAL: ${tool.label} — no label wraps or truncates, and the page is pushed by all of them`, () => {
      pathname = `/artists/a1/${tool.seg}`
      render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)
      const panel = screen.getByRole('navigation', { name: tool.label })

      // The panel sizes to its content, never a number.
      expect(panel.style.width, 'fixed width on the panel').toBe('')
      expect(panel.className).toMatch(/(^|\s)w-max(\s|$)/)
      expect(panel.className).toMatch(/min-w-\[96px\]/)

      for (const tab of tool.tabs!) {
        const link = panel.querySelector(`a[href="/artists/a1/${tab.seg}"]`)!
        const label = [...link.querySelectorAll('span')].find((el) => el.textContent === tab.label)
        expect(label, tab.seg).toBeTruthy()
        expect(label!.className, tab.seg).toMatch(/whitespace-nowrap/)
        expect(label!.className, tab.seg).not.toMatch(/(^|\s)truncate(\s|$)|max-w-/)
      }

      // The in-flow slot beside it: no fixed width, and a hidden copy of every label is
      // what gives it its width — so the page's left edge moves with the longest one.
      const slot = panel.parentElement!
      expect(slot.style.width, 'fixed width on the slot').toBe('')
      const sizer = slot.querySelector('[aria-hidden="true"]')
      expect(sizer, 'sizer').not.toBeNull()
      expect(sizer!.className).toMatch(/(^|\s)invisible(\s|$)/)
      expect(sizer!.className).toMatch(/(^|\s)w-max(\s|$)/)
      const sized = [...sizer!.querySelectorAll('span')].map((el) => el.textContent)
      for (const tab of tool.tabs!) expect(sized, tab.label).toContain(tab.label)
      for (const el of sizer!.querySelectorAll('span')) expect(el.className).toMatch(/whitespace-nowrap/)
      cleanup()
    })
  }
})

describe('a tool\'s tabs on a phone (visual check, 2026-09-23)', () => {
  // Below md both panels are hidden — the rail and the second panel are desktop furniture —
  // so Brand's Colors / Fonts / Tab icon (and Settings' Email) could not be reached at all
  // on a phone. The fallback is a row of the same links above the page, phone-only. It
  // WRAPS rather than scrolls, so it can never push the page sideways at 390px. jsdom does
  // no layout or media queries: the mechanism (md:hidden, flex-wrap, nowrap labels) is
  // what is pinned, and the result was checked in the browser at 390.
  it('CRITICAL: every tab of every tabbed tool is a link in a phone-only row above the page', () => {
    for (const tool of tabbed) {
      for (const tab of tool.tabs!) {
        pathname = `/artists/a1/${tab.seg}`
        render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)
        const strip = screen.getByRole('navigation', { name: `${tool.label} tabs` })
        const cls = strip.className.split(/\s+/)
        expect(cls, tab.seg).toContain('md:hidden')
        expect(cls, tab.seg).toContain('flex-wrap')

        for (const t of tool.tabs!) {
          const link = strip.querySelector(`a[href="/artists/a1/${t.seg}"]`)
          expect(link, `${tab.seg} → ${t.seg}`).not.toBeNull()
          expect(link!.textContent).toBe(t.label)
          expect(link!.className).toMatch(/whitespace-nowrap/)
        }
        const current = [...strip.querySelectorAll('a[aria-current="page"]')]
        expect(current.map((a) => a.getAttribute('href'))).toEqual([`/artists/a1/${tab.seg}`])

        // Above the page, in the page's own column.
        const page = screen.getByText('page')
        expect(strip.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING, tab.seg).toBeTruthy()
        expect(strip.parentElement, tab.seg).toBe(page.parentElement)

        // The desktop panels stay desktop-only, or a phone would get both.
        for (const nav of [screen.getByRole('navigation', { name: 'Manager tools' }), screen.getByRole('navigation', { name: tool.label })]) {
          const slot = nav.parentElement!.className.split(/\s+/)
          expect(slot, tab.seg).toContain('hidden')
          expect(slot, tab.seg).toContain('md:block')
        }
        cleanup()
      }
    }
  })

  it('a tool WITHOUT tabs has no phone row', () => {
    for (const tool of plain) {
      pathname = `/artists/a1/${tool.seg}`
      render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)
      expect(screen.queryAllByRole('navigation').map((n) => n.getAttribute('aria-label'))).toEqual(['Manager tools'])
      cleanup()
    }
  })
})

describe('the page starts 32px right of the second panel (visual check, 2026-09-23)', () => {
  // The panels are `fixed` at x=0; their in-flow slots sat inside <main>'s px-7, so each
  // slot started 28px right of its panel, and the shell's gap-8 ran twice (rail→panel,
  // panel→page). The page began ~92px past the panel's edge; the mock has ~32. Now the two
  // slots share ONE group pulled back over main's padding (so each slot lies exactly under
  // its panel) with no gap inside it, and a single gap-8 to the page. jsdom does no layout:
  // the mechanism is pinned, and main's padding is READ from layout.tsx so the pull cannot
  // drift from it.
  const dash = join(process.cwd(), 'src/app/artists/[id]/(dashboard)')
  const mainPad = /<main className="[^"]*\bpx-(\d+)\b/.exec(readFileSync(join(dash, 'layout.tsx'), 'utf8'))?.[1]

  it('self-check: <main> in the dashboard layout has a px-N the pull can match', () => {
    expect(mainPad).toMatch(/^\d+$/)
  })

  it('CRITICAL: tabbed — rail and panel slots share one group pulled back over main\'s padding, then ONE gap-8', () => {
    for (const tool of tabbed) {
      pathname = `/artists/a1/${tool.seg}`
      render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)
      const railSlot = screen.getByRole('navigation', { name: 'Manager tools' }).parentElement!
      const panelSlot = screen.getByRole('navigation', { name: tool.label }).parentElement!
      const side = railSlot.parentElement!
      expect(panelSlot.parentElement, tool.seg).toBe(side)

      const sideCls = side.className.split(/\s+/)
      expect(sideCls, tool.seg).toContain(`md:-ml-${mainPad}`)
      expect(sideCls.filter((c) => /(^|:)gap-/.test(c)), tool.seg).toEqual([])

      const shell = side.parentElement!
      expect(shell.className.split(/\s+/), tool.seg).toContain('gap-8')
      expect(screen.getByText('page').parentElement!.parentElement, tool.seg).toBe(shell)
      cleanup()
    }
  })

  it('a tool WITHOUT tabs keeps its spacing: no pull, the same gap-8', () => {
    const tool = plain[0]
    pathname = `/artists/a1/${tool.seg}`
    const { container } = render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)
    const railSlot = screen.getByRole('navigation', { name: 'Manager tools' }).parentElement!
    const shell = railSlot.parentElement!
    expect(shell.className.split(/\s+/)).toContain('gap-8')
    expect(container.innerHTML).not.toMatch(/-ml-/)
  })
})
