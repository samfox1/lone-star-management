// @vitest-environment jsdom
/**
 * The manager-tools side panel (Sam, 2026-08-28): every tool in the registry, grouped,
 * the current one marked; shown on tool routes only. Expectations derive from TOOLS.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TOOLS, ToolsShell, toolFor } from '@/app/artists/[id]/(dashboard)/tools-rail'
import { SEO_SECTIONS } from '@/app/artists/[id]/(dashboard)/tools/seo/sections'

let pathname = '/artists/a1/tools'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
afterEach(cleanup)

describe('toolFor', () => {
  it('maps a pathname to its tool, longest segment first; null off the tools', () => {
    expect(toolFor('/artists/a1/tools', 'a1')?.seg).toBe('tools')
    expect(toolFor('/artists/a1/tools/seo', 'a1')?.seg).toBe('tools/seo')
    expect(toolFor('/artists/a1/enquiries/abc', 'a1')?.seg).toBe('enquiries')
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
  it("CRITICAL: on the SEO / GEO tool, a second panel lists EVERY section with the current one marked", () => {
    pathname = '/artists/a1/tools/seo/facts'
    render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)
    const sub = screen.getByRole('navigation', { name: 'SEO / GEO sections' })
    for (const s of SEO_SECTIONS) expect(sub.querySelector(`a[href="/artists/a1/tools/seo/${s.seg}"]`), s.seg).not.toBeNull()
    expect(sub.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/artists/a1/tools/seo/facts')
    // …and the tools panel is COLLAPSED (slid off-left, hover brings it back), still in the DOM.
    const tools = screen.getByRole('navigation', { name: 'Manager tools' })
    expect(tools.parentElement?.getAttribute('data-collapsed')).toBe('true')
    expect(tools.className).toMatch(/hover:translate-x-0/)
  })
  it('on a plain tool the tools panel holds its column (not collapsed)', () => {
    pathname = '/artists/a1/brand'
    render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)
    expect(screen.getByRole('navigation', { name: 'Manager tools' }).parentElement?.getAttribute('data-collapsed')).toBeNull()
  })
  it('no second panel on other tools', () => {
    pathname = '/artists/a1/brand'
    render(<ToolsShell artistId="a1"><p>page</p></ToolsShell>)
    expect(screen.queryByRole('navigation', { name: 'SEO / GEO sections' })).toBeNull()
  })
})
