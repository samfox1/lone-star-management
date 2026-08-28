// @vitest-environment jsdom
/**
 * The manager-tools side panel (Sam, 2026-08-28): every tool in the registry, grouped,
 * the current one marked; shown on tool routes only. Expectations derive from TOOLS.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TOOLS, ToolsShell, toolFor } from '@/app/artists/[id]/(dashboard)/tools-rail'

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
})
