// @vitest-environment jsdom
// The assets rail is rendered by the LAYOUT from the pathname, so it stays put while a tab
//   switch streams in behind the page's loading state.
/**
 * Mirrors tools-rail.test.tsx. The rail used to be rendered by each assets page, which
 * meant a loading.tsx would have blanked it on every switch (2026-09-10). Now the layout
 * decides from the URL, the same way ToolsShell does for the tools pages.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AssetsShell, assetKindFor } from '@/app/artists/[id]/(dashboard)/assets-rail'

let pathname = '/artists/a1/music'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

describe('assetKindFor', () => {
  it('maps the three assets segments, and /images to the photos key', () => {
    expect(assetKindFor('/artists/a1/music', 'a1')).toBe('music')
    expect(assetKindFor('/artists/a1/images', 'a1')).toBe('photos')
    expect(assetKindFor('/artists/a1/videos', 'a1')).toBe('videos')
  })
  it('is null everywhere else, including another artist and the tools pages', () => {
    expect(assetKindFor('/artists/a1/tools/integrations', 'a1')).toBeNull()
    expect(assetKindFor('/artists/a1', 'a1')).toBeNull()
    expect(assetKindFor('/artists/OTHER/music', 'a1')).toBeNull()
  })
  it('ignores a trailing slash and a query string', () => {
    expect(assetKindFor('/artists/a1/videos/', 'a1')).toBe('videos')
    expect(assetKindFor('/artists/a1/music?x=1', 'a1')).toBe('music')
  })
})

describe('AssetsShell', () => {
  it('CRITICAL: on an assets route it wraps the page with the rail, current tab marked', () => {
    pathname = '/artists/a1/images'
    render(<AssetsShell artistId="a1"><p>page</p></AssetsShell>)
    expect(screen.getByText('page')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Images/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Music/ })).not.toHaveAttribute('aria-current')
  })
  it('CRITICAL: elsewhere it is the page alone — no rail', () => {
    pathname = '/artists/a1/tools/integrations'
    render(<AssetsShell artistId="a1"><p>page</p></AssetsShell>)
    expect(screen.getByText('page')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Music/ })).toBeNull()
  })
})
