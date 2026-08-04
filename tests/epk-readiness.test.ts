/**
 * The EPK download gate.
 *
 * Sam's call (2026-08-04): all four of bio, a photo, a contact email, and at least one
 * release must be present before the PDF can be generated. A half-empty press kit sent to
 * a promoter is worse than none, and the manager has no way to know what a promoter
 * expects — so the gate is a checklist, not a warning.
 *
 * It reads PUBLISHED data, deliberately. The PDF is built from published content (also
 * Sam's call, so the file and the public link can never disagree), so a checklist reading
 * working rows would light the button up while the PDF came out empty. Nothing published
 * at all means nothing is met.
 *
 * "A photo" and "a contact email" are satisfied by more than one source, because the
 * manager has more than one place to put them and the gate is about whether the press kit
 * WORKS, not about which field was used.
 */
import { describe, expect, it } from 'vitest'
import { epkReadiness } from '@/lib/epk'
import type { SiteData } from '@/lib/site'

function site(over: Partial<SiteData> = {}, artist: Partial<SiteData['artist']> = {}): SiteData {
  return {
    artist: {
      id: 'a1',
      slug: 'lone-pine',
      name: 'Lone Pine',
      bio: 'Dusty alt-country out of West Texas.',
      hero_image_url: null,
      template: 'classic',
      spotify_artist_id: null,
      ...artist,
    },
    tracks: [],
    tour_dates: [],
    merch: [],
    links: [{ id: 'l1', label: 'Booking', url: 'mailto:book@example.com', sort_order: 0 }] as never,
    videos: [],
    media: [{ purpose: 'profile_photo', url: 'https://img.example/p.jpg' }] as never,
    site_content: {},
    styles: {},
    ...over,
  }
}

const ready = (over?: Partial<SiteData>, artist?: Partial<SiteData['artist']>, releaseCount = 1) =>
  epkReadiness({ site: site(over, artist), releaseCount })

const keysMissing = (r: ReturnType<typeof epkReadiness>) =>
  r.requirements.filter((q) => !q.met).map((q) => q.key)

describe('epkReadiness — the four must-haves', () => {
  it('is ready when all four are present', () => {
    const r = ready()
    expect(r.ready).toBe(true)
    expect(keysMissing(r)).toEqual([])
  })

  it('always reports all four, met or not — it is a checklist, not an error list', () => {
    // The manager needs to see what is still outstanding, not just that something is.
    expect(ready().requirements.map((q) => q.key)).toEqual(['bio', 'photo', 'contact', 'release'])
    expect(epkReadiness({ site: null, releaseCount: 0 }).requirements).toHaveLength(4)
  })

  it('CRITICAL: nothing is met when nothing is published', () => {
    // getPublishedSite returns null until the profile is published. The PDF would be
    // empty, so the button must not be offered.
    const r = epkReadiness({ site: null, releaseCount: 5 })
    expect(r.ready).toBe(false)
    expect(keysMissing(r)).toEqual(['bio', 'photo', 'contact', 'release'])
  })

  it('needs a bio', () => {
    expect(keysMissing(ready({}, { bio: null }))).toEqual(['bio'])
    expect(keysMissing(ready({}, { bio: '   ' }))).toEqual(['bio'])
  })

  it('needs at least one release — a new artist with nothing out cannot generate one', () => {
    // Sam accepted this consequence explicitly when choosing the gate.
    expect(keysMissing(ready({}, {}, 0))).toEqual(['release'])
  })
})

describe('epkReadiness — a photo, from either source', () => {
  it('accepts a published profile photo', () => {
    expect(keysMissing(ready())).toEqual([])
  })

  it('accepts the hero image when there is no profile photo', () => {
    // The public EPK page already falls back this way, so the gate must agree with what
    // the page will actually render.
    expect(keysMissing(ready({ media: [] }, { hero_image_url: 'https://img.example/h.jpg' }))).toEqual([])
  })

  it('reports the photo missing when there is neither', () => {
    expect(keysMissing(ready({ media: [] }, { hero_image_url: null }))).toEqual(['photo'])
  })

  it('CRITICAL: a gallery image is not a press photo', () => {
    // Only a profile photo or the hero counts — the EPK header renders one of those two,
    // so a full gallery with no portrait still cannot fill it.
    const gallery = [{ purpose: 'gallery_image', url: 'https://img.example/g.jpg' }] as never
    expect(keysMissing(ready({ media: gallery }, { hero_image_url: null }))).toEqual(['photo'])
  })
})

describe('epkReadiness — a contact email, from either source', () => {
  it('accepts a mailto link', () => {
    expect(keysMissing(ready())).toEqual([])
  })

  it('accepts a booking email in site content when there is no mailto link', () => {
    expect(
      keysMissing(ready({ links: [], site_content: { booking_email: 'book@example.com' } })),
    ).toEqual([])
  })

  it('reports contact missing when there is neither', () => {
    expect(keysMissing(ready({ links: [] }))).toEqual(['contact'])
  })

  it('CRITICAL: a social link is not a contact email', () => {
    const socials = [{ id: 'l1', label: 'Instagram', url: 'https://instagram.com/x', sort_order: 0 }] as never
    expect(keysMissing(ready({ links: socials }))).toEqual(['contact'])
  })

  it('CRITICAL: a junk booking_email does not satisfy the gate', () => {
    // A promoter clicking a dead address is the failure this gate exists to prevent.
    expect(keysMissing(ready({ links: [], site_content: { booking_email: 'not-an-email' } }))).toEqual([
      'contact',
    ])
  })

  it('ignores a tel: link — a press kit needs an address to write to', () => {
    const tel = [{ id: 'l1', label: 'Phone', url: 'tel:+15125551234', sort_order: 0 }] as never
    expect(keysMissing(ready({ links: tel }))).toEqual(['contact'])
  })
})

describe('epkReadiness — every requirement explains itself', () => {
  it('carries a human label and a fix hint for each', () => {
    // The checklist is the only place the manager learns WHY the button is off.
    for (const q of epkReadiness({ site: null, releaseCount: 0 }).requirements) {
      expect(q.label.length).toBeGreaterThan(0)
      expect(q.hint.length).toBeGreaterThan(0)
    }
  })
})
