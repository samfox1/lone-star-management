// @vitest-environment jsdom
/**
 * The Overview: the Site row, one row per tool the rail lists, and the Publish bar only while
 * something waits.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/overview-view.tsx,
 *           tools/overview-riser.tsx
 * Feature:  Manager tools · Overview (prototypes/overview_20261002.html, Sam 2026-10-05)
 * Tier:     LIGHT (AGENTS.md "Test depth"): the page is new. One test per row type, the
 *           toolsFor fix, and the bar.
 * Covers:   • Site row: address, N unpublished / Live, ↗ and pencil; the preview eye only for a
 *             template site
 *           • tool rows follow toolsFor (derived): a custom site has no "Site & profile"; the
 *             counts and Profile's dot
 *           • the bar is down while nothing waits, up when something does, and its Publish
 *             hands the password to publishAction
 * Not here: the words (tests/unit/manager-tools/overview/); publishAction's gate
 *           (tests/unit/publish/password-gate.test.ts); looks (screenshots).
 * Fixtures: a clean diff from PUBLISHABLE's keys. Mocked: publishAction, the pathname (no router:
 *           publishAction's own revalidation re-renders the page, so the bar never refreshes it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PUBLISHABLE, type UnpublishedDiff } from '@/lib/content'
import { OverviewView } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/overview-view'
import { toolsFor } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_shell/tools-registry'
import { publishAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({ publishAction: vi.fn(async () => ({ ok: true })) }))
vi.mock('next/navigation', () => ({ usePathname: () => '/artists/a1/tools' }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const s = (n = 0) => ({ added: 0, edited: n, deleted: 0, dirty: n > 0 })
function diff(dirty: Partial<Record<string, number>> = {}): UnpublishedDiff {
  const out = Object.fromEntries(['profile', ...Object.keys(PUBLISHABLE)].map((k) => [k, s(dirty[k])])) as Record<string, unknown>
  out.media = { ...s(), site: s(), brand: s() }
  return out as unknown as UnpublishedDiff
}

const COUNTS = { connected: 2, subscribers: 11, unread: 3 }
const view = (over: Partial<Parameters<typeof OverviewView>[0]> = {}) =>
  render(<OverviewView artistId="a1" customSite address="skeenmusic.com" viewHref="/skeen" counts={COUNTS} diff={diff()} {...over} />)
const bar = () => document.querySelector('[data-publish-riser]') as HTMLElement
const toolRows = () => within(screen.getByRole('region', { name: 'Tools' })).getAllByRole('link')

describe('the Overview', () => {
  it('Site row: the address, Live, ↗ to the site and the pencil to the editor; no preview for a custom site', () => {
    view()
    const site = screen.getByRole('region', { name: 'Site' })
    expect(within(site).getByText('skeenmusic.com')).toBeTruthy()
    expect(within(site).getByText('Live')).toBeTruthy()
    expect(within(site).getByRole('link', { name: 'View site' }).getAttribute('href')).toBe('/skeen')
    expect(within(site).getByRole('link', { name: 'Edit site' }).getAttribute('href')).toBe('/artists/a1/editor')
    expect(within(site).queryByRole('link', { name: 'Preview' })).toBeNull()
    cleanup()
    view({ customSite: false, diff: diff({ link: 1, site_content: 1 }) })
    expect(screen.getByText('2 unpublished')).toBeTruthy() // two route segments: connections, site
    expect(screen.getByRole('link', { name: 'Preview' }).getAttribute('href')).toBe('/artists/a1/preview')
  })

  it('tool rows follow toolsFor: a custom site has no "Site & profile" row; counts and Profile’s dot show', () => {
    view({ diff: diff({ site_content: 1 }) })
    const expected = toolsFor(true).filter((t) => t.seg !== 'tools')
    expect(toolRows().map((a) => a.getAttribute('href'))).toEqual(expected.map((t) => `/artists/a1/${t.seg}`))
    expect(screen.queryByText('Site & profile')).toBeNull()
    expect(screen.getByRole('link', { name: 'Profile, unpublished changes' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Connections, 2 connected' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Subscribers, 11' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Enquiries, 3 unread' })).toBeTruthy()
    cleanup()
    view({ customSite: false })
    expect(toolRows().some((a) => a.getAttribute('href') === '/artists/a1/site')).toBe(true)
  })

  it('the Publish bar is gone while nothing waits, rises when something does, and publishes with the password', async () => {
    view()
    expect(bar().className).toMatch(/(^|\s)invisible(\s|$)/)
    expect(bar().hasAttribute('inert')).toBe(true)
    cleanup()
    view({ diff: diff({ link: 1 }) })
    expect(bar().className).not.toMatch(/(^|\s)invisible(\s|$)/)
    expect(within(bar()).getByText(/1 link changed/)).toBeTruthy()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Publish' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Your password'), { target: { value: 'hunter2' } })
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' })))
    await waitFor(() => expect(publishAction).toHaveBeenCalledWith('a1', 'hunter2'))
    expect(publishAction).toHaveBeenCalledTimes(1)
  })
})
