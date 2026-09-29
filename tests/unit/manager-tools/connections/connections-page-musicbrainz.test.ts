// The Connections page hands the Connect window a pre-filled "Create the MusicBrainz page" link — only while there is none.
/**
 * AI_VISIBILITY_AUDIT.md 4.1. Light (AGENTS.md "Test depth"): the builder itself is pinned in
 * musicbrainz-seed.test.ts; this pins the seam — the page builds the link from the artist's
 * own facts and links, and stops offering it once MusicBrainz is connected.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

const state = vi.hoisted(() => ({
  links: [] as Record<string, unknown>[],
  facts: { location: 'Chicago', schema_type: 'Person' } as Record<string, unknown> | null,
}))

vi.mock('@/app/artists/[id]/(dashboard)/_data', () => ({
  requireArtist: vi.fn(async () => ({ id: 'a1', name: 'Skeen', slug: 'skeen', site_kind: 'custom', custom_site_url: 'https://skeenmusic.com' })),
  getShopifyDomain: vi.fn(async () => null),
  dashboardDiff: vi.fn(async () => ({ link: { dirty: false } })),
}))
vi.mock('@/lib/content', async (importOriginal) => ({ ...(await importOriginal<object>()), listContent: vi.fn(async () => state.links) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      const query: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'not']) query[m] = () => query
      query.single = async () => ({ data: table === 'artists' ? state.facts : null, error: null })
      query.then = (resolve: (v: unknown) => unknown) => resolve({ count: 0, error: null })
      return query
    },
  }),
}))

import ConnectionsPage from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/page'
import { ConnectionList } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connection-list'

async function createPages() {
  const el = (await ConnectionsPage({ params: Promise.resolve({ id: 'a1' }), searchParams: Promise.resolve({}) })) as ReactElement<{ children: unknown }>
  const kids = ([] as unknown[]).concat(el.props.children).filter(Boolean) as ReactElement<Record<string, unknown>>[]
  return kids.find((k) => k.type === ConnectionList)!.props.createPages as Partial<Record<string, string>>
}

beforeEach(() => {
  state.links = [{ id: 'l-ig', label: 'Instagram', url: 'https://instagram.com/skeenmusic', on_site: false, role: null }]
  state.facts = { location: 'Chicago', schema_type: 'Person' }
})

describe('the Connections page and MusicBrainz', () => {
  it('CRITICAL: with no MusicBrainz connection, offers its editor filled from the artist’s own name, facts, site and links', async () => {
    const q = new URL((await createPages()).musicbrainz!).searchParams
    expect(q.get('edit-artist.name')).toBe('Skeen')
    expect(q.get('edit-artist.type_id')).toBe('1')
    expect(q.get('edit-artist.area.name')).toBe('Chicago')
    expect(q.get('edit-artist.url.0.text')).toBe('https://skeenmusic.com')
    expect(q.get('edit-artist.url.1.text')).toBe('https://instagram.com/skeenmusic')
  })

  it('CRITICAL: once MusicBrainz is connected, nothing is offered', async () => {
    state.links.push({ id: 'l-mb', label: 'MusicBrainz', url: 'https://musicbrainz.org/artist/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d', on_site: false, role: null })
    expect((await createPages()).musicbrainz).toBeUndefined()
  })
})
