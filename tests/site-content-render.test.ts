/**
 * SITE EDITOR — render contract (no DB). A site_content override renders; a
 * stored HTML payload renders ESCAPED (text fields are React-escaped, §9); and a
 * template reads only its own keys (no cross-template bleed).
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtistSite } from '@/components/artist-site'
import type { SiteData } from '@/lib/site'

function makeData(site_content: Record<string, string>): SiteData {
  return {
    artist: { id: 'a', slug: 'a', name: 'A', bio: null, hero_image_url: null, template: 'classic', spotify_artist_id: null },
    tracks: [
      { id: 't', title: 'Song', cover_url: null, stream_url: null, provider_url: null, has_audio: false, sort_order: 0 },
    ],
    tour_dates: [],
    merch: [],
    links: [],
    media: [],
    site_content,
  }
}

const render = (sc: Record<string, string>) =>
  renderToStaticMarkup(createElement(ArtistSite, { data: makeData(sc) }))

describe('site_content render contract', () => {
  it('renders a text override, the template default otherwise', () => {
    expect(render({})).toContain('Tracks') // default heading
    expect(render({ tracks_heading: 'SONGS' })).toContain('SONGS') // override
  })

  it('CRITICAL: a stored HTML payload renders escaped, not as live markup', () => {
    const html = render({ tracks_heading: '<img src=x onerror=alert(1)>' })
    expect(html).not.toContain('<img src=x onerror')
    expect(html).toContain('&lt;img')
  })

  it('a template reads only its own keys (no cross-template bleed)', () => {
    // hero_tagline is a cinematic-only key; the classic template must ignore it.
    expect(render({ hero_tagline: 'CINEMATIC ONLY' })).not.toContain('CINEMATIC ONLY')
  })
})
