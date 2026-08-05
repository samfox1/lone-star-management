// @vitest-environment jsdom
/**
 * Custom fonts reach the RENDERED site — and only sanitized CSS does.
 *
 * ArtistTemplate is the one place every render mode passes through (public page,
 * preview, edit frame), so the font <style> is injected there. These tests pin the
 * injection itself: emitters are covered in tests/fonts.test.ts, but an emitter nobody
 * calls styles nothing — the exact shape the safeHref review found on this same layer.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ArtistTemplate } from '@/components/artist-template'
import type { SiteData } from '@/lib/site'

vi.mock('@/components/templates/cinematic', () => ({
  CinematicTemplate: () => <div data-testid="cinematic" />,
}))

function site(fonts: SiteData['fonts'], template = 'classic'): SiteData {
  return {
    artist: {
      id: 'a1',
      slug: 'lone-pine',
      name: 'Lone Pine',
      bio: null,
      hero_image_url: null,
      template,
      spotify_artist_id: null,
    },
    tracks: [],
    tour_dates: [],
    merch: [],
    links: [],
    videos: [],
    media: [],
    site_content: {},
    styles: {},
    fonts,
  } as unknown as SiteData
}

const FONT = {
  family: 'archivo-narrow',
  label: 'Archivo Narrow',
  path: 'a1/fonts/x.woff2',
  format: 'woff2',
  role: 'primary' as const,
}

describe('ArtistTemplate font injection', () => {
  it('CRITICAL: published fonts become a <style> with the @font-face and role rules', () => {
    const { container } = render(<ArtistTemplate data={site([FONT])} />)
    const style = container.querySelector('style')
    expect(style?.textContent).toContain('@font-face')
    expect(style?.textContent).toContain(".font-archivo-narrow")
    expect(style?.textContent).toContain("h1,h2,h3,h4,h5,h6{font-family:'archivo-narrow'")
  })

  it('CRITICAL: both templates get the same injection', () => {
    // Injected below the template switch on purpose; a per-template injection is how one
    // mode silently loses its fonts.
    const { container } = render(<ArtistTemplate data={site([FONT], 'cinematic')} />)
    expect(container.querySelector('[data-testid="cinematic"]')).toBeTruthy()
    expect(container.querySelector('style')?.textContent).toContain('@font-face')
  })

  it('no fonts, no <style> — a site that never uploaded any is byte-identical to before', () => {
    const { container } = render(<ArtistTemplate data={site([])} />)
    expect(container.querySelector('style')).toBeNull()
  })

  it('a legacy payload with NO fonts key renders instead of crashing', () => {
    const legacy = site([])
    delete (legacy as Partial<SiteData>).fonts
    const { container } = render(<ArtistTemplate data={legacy} />)
    expect(container.querySelector('style')).toBeNull()
  })

  it('CRITICAL: a hostile family never reaches the emitted stylesheet', () => {
    const { container } = render(
      <ArtistTemplate
        data={site([{ ...FONT, family: "x'; } body { display:none } .z {" }])}
      />,
    )
    const css = container.querySelector('style')?.textContent ?? ''
    expect(css).not.toContain('display:none')
  })
})
