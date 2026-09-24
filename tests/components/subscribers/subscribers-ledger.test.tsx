// @vitest-environment jsdom
// The Subscribers ledger: search, sort, copy, email, download, and the sticky toolbar.
/**
 * SUBSCRIBERS (Sam, 2026-09-24; prototypes/subscribers_ledger_20260924.html). A read-only
 * list of the emails the site's signup door collected, in the Brand ledger's frame: an empty
 * centred column (no label, no count), then a toolbar and the rows.
 *
 * What has to hold, and is pinned here with the clipboard mocked:
 *   - search filters as you type, ignoring case, and marks the matched part in each email
 *     WITHOUT turning an email or a query into HTML; × clears it and gives focus back;
 *   - Newest · Oldest · A–Z reorder the rows;
 *   - "Copy all emails" copies exactly the SHOWN list, in the shown order; a row's Copy
 *     copies that one address; both flash a check for ~1.4s; a refused clipboard falls back
 *     to select + execCommand;
 *   - Email is a mailto: with the address URL-encoded; Download CSV is a real link to the
 *     export route (the full list, never the search);
 *   - the empty and no-match states;
 *   - THE STICKY TOOLBAR (Sam, 2026-09-24): the page scrolls and the toolbar stays. jsdom
 *     does no layout and no scrolling, so the class contract is what is pinned: sticky under
 *     the header, paper behind it, a hairline under it, and no scroll box of its own between
 *     it and the page (an overflow on any ancestor would silently un-stick it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SubscribersLedger, STICKY_TOP } from '@/app/artists/[id]/(dashboard)/subscribers/subscribers-ledger'
import { SUBSCRIBER_SORTS, type Subscriber, type SubscriberSort } from '@/lib/subscribers'

const ROWS: Subscriber[] = [
  { email: 'theo.park@example.com', created_at: '2026-09-19T20:15:00+00:00' },
  { email: 'Ben.Walsh@Example.com', created_at: '2026-07-09T08:00:00+00:00' },
  { email: 'maya.chen@example.com', created_at: '2026-09-22T14:03:11.123456+00:00' },
  { email: 'ava.moreno@example.com', created_at: '2026-08-11T00:00:00+00:00' },
]

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const mount = (subscribers: Subscriber[] = ROWS) => render(<SubscribersLedger artistId="a1" subscribers={subscribers} />)
const list = () => screen.getByRole('list')
const rows = () => within(list()).getAllByRole('listitem')
/** The emails, in the order the rows show them. */
const shownEmails = () => rows().map((r) => r.querySelector('[data-email]')!.textContent)
const search = () => screen.getByRole('searchbox', { name: 'Search emails' })
const type = (value: string) => fireEvent.change(search(), { target: { value } })
const copyAll = () => screen.getByRole('button', { name: /^(Copy all emails|Copied \d+)$/ })

describe('the list', () => {
  it('shows every subscriber, NEWEST first, each with its date', () => {
    mount()
    expect(shownEmails()).toEqual(['maya.chen@example.com', 'theo.park@example.com', 'ava.moreno@example.com', 'Ben.Walsh@Example.com'])
    expect(within(rows()[0]).getByText('Sep 22, 2026')).toBeInTheDocument()
  })

  it('no title, no "Subscribers" label, no count on the page (Sam, 2026-09-24)', () => {
    const { container } = mount()
    expect(container.querySelector('h1, h2, h3')).toBeNull()
    expect(container.textContent).not.toMatch(/subscribers/i)
    // Text node by text node: joined up, a bare "4" beside "Newest" reads "4Newest" and a
    // word-boundary check on the whole page misses it (it did, once).
    const texts: string[] = []
    const walk = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) texts.push((n.textContent ?? '').trim())
    expect(texts.length).toBeGreaterThan(10)
    expect(texts.filter((t) => /^\d[\d,]*$/.test(t) || /\b\d+\s*(emails?|subscribers?|signups?)\b/i.test(t))).toEqual([])
  })

  it('CENTRES the list, so the gap on its left equals the gap on its right (Sam, 2026-09-24)', () => {
    // It first kept Brand's empty 150px column; with the list running to the right edge that
    // left twice the gap on the left. Now the frame is a centred column of a fixed max width,
    // with no spacer. jsdom can't lay out, so the centring contract is what's pinned.
    const { container } = mount()
    const frame = container.querySelector('[data-subscribers-frame]')!
    expect(frame.className).toMatch(/(^|\s)mx-auto(\s|$)/)
    expect(frame.className).toMatch(/(^|\s)max-w-\[\d+px\](\s|$)/)
    expect(frame.className).not.toMatch(/grid-cols-\[150px/)
    // No empty spacer column as a direct child (the hover labels' own zero-size markers,
    // deeper down, are not spacers).
    expect([...frame.children].filter((c) => c.getAttribute('aria-hidden') === 'true' && c.textContent === '')).toEqual([])
    expect(frame.contains(list())).toBe(true)
    // …and centred on what the eye sees: the tools shell puts 32px between the rail and the
    // page (gap-8) on the LEFT only, so the wrapper mirrors it on the right from md up.
    // Measured 2026-09-24: 178/178 at 1440, 98/98 at 1280, 28/28 at 390.
    expect(frame.parentElement!.className).toMatch(/(^|\s)md:pr-8(\s|$)/)
  })
})

describe('search', () => {
  it('filters as you type, ignoring case, and × clears it and hands focus back', () => {
    mount()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    type('WALSH')
    expect(shownEmails()).toEqual(['Ben.Walsh@Example.com'])
    type('example.com')
    expect(shownEmails()).toHaveLength(4)
    type('.chen')
    expect(shownEmails()).toEqual(['maya.chen@example.com'])
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search()).toHaveValue('')
    expect(shownEmails()).toHaveLength(4)
    expect(search()).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  })

  it('marks the matched part of each email, in the email’s own case', () => {
    mount()
    type('walsh')
    const marks = [...list().querySelectorAll('mark')].map((m) => m.textContent)
    expect(marks).toEqual(['Walsh'])
    // The email still reads whole: the mark splits nothing out of it.
    expect(shownEmails()).toEqual(['Ben.Walsh@Example.com'])
  })

  it('CRITICAL: an email or a query full of HTML stays text — nothing is injected', () => {
    // subscribe() allows any non-space, non-@ characters, so this is a storable address.
    const evil = '<img/src=x/onerror=alert(1)>@x.io'
    mount([{ email: evil, created_at: '2026-09-01T00:00:00Z' }, ...ROWS])
    expect(document.querySelector('img')).toBeNull()
    type('<img')
    expect(document.querySelector('img')).toBeNull()
    expect(shownEmails()).toEqual([evil])
    expect([...list().querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['<img'])
  })

  it('no match: one quiet line naming the query, and Copy all has nothing to copy', () => {
    mount()
    type('zzz')
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByText('No emails match “zzz”.')).toBeInTheDocument()
    expect(copyAll()).toBeDisabled()
    // The download is the FULL list, so it stays.
    expect(screen.getByRole('link', { name: 'Download CSV' })).toBeInTheDocument()
  })
})

describe('sort', () => {
  const EXPECTED: Record<SubscriberSort, string[]> = {
    new: ['maya.chen@example.com', 'theo.park@example.com', 'ava.moreno@example.com', 'Ben.Walsh@Example.com'],
    old: ['Ben.Walsh@Example.com', 'ava.moreno@example.com', 'theo.park@example.com', 'maya.chen@example.com'],
    az: ['ava.moreno@example.com', 'Ben.Walsh@Example.com', 'maya.chen@example.com', 'theo.park@example.com'],
  }

  it('the segmented control is Newest · Oldest · A–Z, Newest pressed to start', () => {
    mount()
    const group = screen.getByRole('group', { name: 'Sort' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(SUBSCRIBER_SORTS.map((s) => s.label))
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
  })

  it('each sort reorders the rows, and only the chosen one is pressed', () => {
    mount()
    // Walk them out of order, so "still showing the last one" cannot pass.
    for (const key of ['old', 'az', 'new', 'az', 'old'] as SubscriberSort[]) {
      const label = SUBSCRIBER_SORTS.find((s) => s.key === key)!.label
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(shownEmails(), label).toEqual(EXPECTED[key])
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('sorts the FILTERED list', () => {
    mount()
    type('.')
    fireEvent.click(screen.getByRole('button', { name: 'A–Z' }))
    type('a')
    expect(shownEmails()).toEqual(EXPECTED.az)
  })
})

describe('copy', () => {
  it('CRITICAL: Copy all copies exactly the SHOWN list, in the shown order, "a, b"', async () => {
    mount()
    type('a.') // maya.chen, ava.moreno: two rows, so order matters
    fireEvent.click(screen.getByRole('button', { name: 'A–Z' }))
    await act(async () => {
      fireEvent.click(copyAll())
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('ava.moreno@example.com, maya.chen@example.com')
  })

  it('Copy all flashes a check labelled "Copied N" for ~1.4s, then goes back', async () => {
    vi.useFakeTimers()
    mount()
    await act(async () => {
      fireEvent.click(copyAll())
    })
    expect(writeText).toHaveBeenCalledWith('maya.chen@example.com, theo.park@example.com, ava.moreno@example.com, Ben.Walsh@Example.com')
    const done = screen.getByRole('button', { name: 'Copied 4' })
    expect(done.querySelector('[data-icon="check"]')).not.toBeNull()
    act(() => vi.advanceTimersByTime(1300))
    expect(screen.getByRole('button', { name: 'Copied 4' })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByRole('button', { name: 'Copy all emails' }).querySelector('[data-icon="copy"]')).not.toBeNull()
  })

  it('a row’s Copy copies that one address and flashes only that row', async () => {
    vi.useFakeTimers()
    mount()
    const theo = rows()[1]
    await act(async () => {
      fireEvent.click(within(theo).getByRole('button', { name: 'Copy' }))
    })
    expect(writeText).toHaveBeenCalledWith('theo.park@example.com')
    expect(within(theo).getByRole('button', { name: 'Copied' }).querySelector('[data-icon="check"]')).not.toBeNull()
    // Every other row still says Copy.
    expect(within(rows()[0]).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1500))
    expect(within(rows()[1]).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('a refused clipboard falls back to select + execCommand("copy") on the same text', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'))
    let copied: string | null = null
    const exec = vi.fn((cmd: string) => {
      const ta = document.querySelector('textarea')
      copied = cmd === 'copy' && ta && ta.selectionEnd - ta.selectionStart === ta.value.length ? ta.value : null
      return true
    })
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    mount()
    await act(async () => {
      fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Copy' }))
    })
    expect(exec).toHaveBeenCalledWith('copy')
    expect(copied).toBe('maya.chen@example.com')
    expect(document.querySelector('textarea')).toBeNull()
    expect(within(rows()[0]).getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('with no clipboard API at all, it still copies through the fallback', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const exec = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    mount()
    await act(async () => {
      fireEvent.click(copyAll())
    })
    expect(exec).toHaveBeenCalledWith('copy')
    expect(screen.getByRole('button', { name: 'Copied 4' })).toBeInTheDocument()
  })
})

describe('email and download', () => {
  it('Email is a mailto: link with the address URL-encoded', () => {
    mount([{ email: 'x?cc=boss@evil.io', created_at: '2026-09-01T00:00:00Z' }, ...ROWS])
    const row = rows().find((r) => r.textContent?.includes('x?cc=boss'))!
    expect(within(row).getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:x%3Fcc%3Dboss@evil.io')
    const maya = rows().find((r) => r.textContent?.includes('maya.chen'))!
    expect(within(maya).getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:maya.chen@example.com')
  })

  it('Download CSV is a real link to the export route, the same whatever the search', () => {
    mount()
    const href = '/artists/a1/subscribers/export'
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute('href', href)
    type('maya')
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute('href', href)
  })
})

describe('empty', () => {
  it('no subscribers: one quiet line, and nothing to search, sort, copy or download', () => {
    mount([])
    expect(screen.getByText('No subscribers yet.')).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('the toolbar stays put while the list scrolls (Sam, 2026-09-24)', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({
    email: `fan${String(i).padStart(3, '0')}@example.com`,
    created_at: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(),
  }))
  const cls = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)

  it('CRITICAL: the toolbar is sticky under the dashboard header, on paper, with a hairline under it', () => {
    const { container } = mount(many)
    const bar = container.querySelector('[data-subscribers-toolbar]')!
    expect(bar.contains(search())).toBe(true)
    expect(cls(bar)).toEqual(expect.arrayContaining(['sticky', 'bg-paper', 'border-b', 'border-hairline']))
    // Under the header: 59px on a phone, 71px from md up, plus the notch when there is one.
    expect(STICKY_TOP).toEqual(['top-[calc(59px+env(safe-area-inset-top,0px))]', 'md:top-[calc(71px+env(safe-area-inset-top,0px))]'])
    expect(cls(bar)).toEqual(expect.arrayContaining(STICKY_TOP))
    // Above the rows (their icons are `relative`), below the header (z-30).
    expect(cls(bar)).toContain('z-20')
    expect(bar.compareDocumentPosition(list()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('CRITICAL: the PAGE scrolls: no scroll box between the toolbar and the page', () => {
    const { container } = mount(many)
    expect(rows()).toHaveLength(500)
    const bar = container.querySelector('[data-subscribers-toolbar]')!
    // The walk below is vacuous without a toolbar to walk from (it passed on a stub).
    expect(bar).not.toBeNull()
    const OVERFLOW = /^(?:[a-z0-9-]+:)*overflow-(?:auto|scroll|hidden|clip|y-auto|y-scroll|y-hidden|x-auto|x-scroll|x-hidden)$/
    const scrollers: string[] = []
    for (let el: Element | null = list(); el && el !== container; el = el.parentElement) {
      for (const c of cls(el)) if (OVERFLOW.test(c)) scrollers.push(`${el.tagName} ${c}`)
    }
    for (let el: Element | null = bar; el && el !== container; el = el.parentElement) {
      for (const c of cls(el)) if (OVERFLOW.test(c)) scrollers.push(`${el.tagName} ${c}`)
    }
    expect(scrollers).toEqual([])
    // And no viewport-sized box pretending to be the page.
    expect(cls(list()).some((c) => /^(max-)?h-/.test(c))).toBe(false)
  })
})

describe('touch and keyboard', () => {
  it('row icons are faint until hover with a mouse, but always visible on a touch screen', () => {
    mount()
    for (const el of [within(rows()[0]).getByRole('button', { name: 'Copy' }), within(rows()[0]).getByRole('link', { name: 'Email' })]) {
      expect(el.className).toContain('opacity-40')
      expect(el.className).toContain('pointer-coarse:opacity-100')
    }
  })

  it('every control has a keyboard ring that paints (Tailwind 4: outline-hidden needs outline-solid)', () => {
    mount()
    type('a') // the × exists only while there is a query
    const controls = [...document.body.querySelectorAll('button, a')]
    expect(controls.length).toBeGreaterThan(8)
    for (const el of controls) {
      const c = (el.getAttribute('class') ?? '').split(/\s+/)
      const name = el.getAttribute('aria-label') ?? el.textContent
      expect(c, name ?? '').toEqual(expect.arrayContaining(['focus-visible:outline-solid', 'focus-visible:outline-2']))
    }
  })
})
