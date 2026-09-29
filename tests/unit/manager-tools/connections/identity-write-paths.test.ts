// Every door that writes a link's url also stores whether it is an identity profile (links.identity_url).
/**
 * IDENTITY LINKS, the write half (AI_VISIBILITY_AUDIT.md 1.2). The public door publishes a
 * link that is NOT a site button only when `links.identity_url` equals its published url,
 * and that column is written only by TypeScript, from `identityUrlOf` (lib/connections).
 * So every door that writes a link's url has to store the verdict, or a new connection
 * never reaches `sameAs` — and a changed url has to be RE-judged, or an old verdict would
 * sit beside a url nobody checked.
 *
 * The doors, all driven for real down to `createContent` / `updateContent`:
 *   connectOneAction   → addContentAction → createContent   (Connections' Connect)
 *   addContentAction                      → createContent   (the editor's picker)
 *   updateContentAction                   → updateContent   (Connections' edit window, the editor's link rows)
 *
 * The database is an in-memory `links` table, and every assertion reads ROW STATE from it,
 * never a call's return value (AGENTS.md rule 3). The bridge's verdict is a stand-in here
 * (two known urls): what is and is not an identity is the bridge's rule, pinned against the
 * real one in identity-verdict.test.ts. This file pins that the verdict is STORED, on every
 * door, and that nothing the browser posts can set it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createContent, updateContent } from '@/lib/content'

const { IDENTITY } = vi.hoisted(() => ({
  IDENTITY: new Set(['https://open.spotify.com/artist/26K', 'https://instagram.com/skeenmusic']),
}))

vi.mock('@samfox1/site-bridge/seo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@samfox1/site-bridge/seo')>()),
  isIdentityProfileUrl: (url: string) => IDENTITY.has(url),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/integrations', () => ({ INTEGRATIONS: [] }))
vi.mock('@/app/artists/[id]/(dashboard)/merch/actions', () => ({
  connectShopifyAction: vi.fn(), disconnectShopifyAction: vi.fn(), probeShopifyAction: vi.fn(), syncShopifyAction: vi.fn(),
}))
vi.mock('@/app/artists/[id]/(dashboard)/sync-section-action', () => ({ syncSectionAction: vi.fn(async () => ({ results: [] })) }))

/* ── An in-memory `links` table behind a PostgREST-shaped client ──────────────────── */

type Row = Record<string, unknown> & { id: string }
let rows: Row[] = []
/** false = the table as it is BEFORE the migration: no `identity_url` column. */
let migrated = true
let nextId = 1
/** Every UPDATE that set identity_url, so a no-op re-judge can be seen writing nothing. */
let identityWrites = 0

function client() {
  return {
    from(table: string) {
      if (table !== 'links') throw new Error(`unexpected table ${table}`)
      let op: 'select' | 'insert' | 'update' = 'select'
      let payload: Record<string, unknown> = {}
      const filters: [string, unknown][] = []
      const run = (): Row[] => {
        const match = (r: Row) => filters.every(([c, v]) => r[c] === v)
        if (op === 'insert') {
          if (!migrated && 'identity_url' in payload) throw new Error('column "identity_url" does not exist')
          const r: Row = { id: `l${nextId++}`, role: null, on_site: true, sort_order: 0, ...(migrated ? { identity_url: null } : {}), ...payload }
          rows.push(r)
          return [{ ...r }]
        }
        if (op === 'update') {
          if (!migrated && 'identity_url' in payload) throw new Error('column "identity_url" does not exist')
          if ('identity_url' in payload) identityWrites++
          const hit = rows.filter(match)
          for (const r of hit) Object.assign(r, payload)
          return hit.map((r) => ({ ...r }))
        }
        return rows.filter(match).map((r) => ({ ...r }))
      }
      const answer = (one: boolean) => {
        const data = run()
        return { data: one ? (data[0] ?? null) : data, error: null }
      }
      const q = {
        select: () => q,
        insert: (p: Record<string, unknown>) => ((op = 'insert'), (payload = p), q),
        update: (p: Record<string, unknown>) => ((op = 'update'), (payload = p), q),
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        order: () => q,
        single: async () => answer(true),
        maybeSingle: async () => answer(true),
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve().then(() => answer(false)).then(ok, bad),
      }
      return q
    },
  }
}
const sb = client()
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => sb }))

const dashboard = () => import('@/app/artists/[id]/(dashboard)/actions')
const connections = () => import('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions')

const SPOTIFY = 'https://open.spotify.com/artist/26K'
const PLAYLIST = 'https://open.spotify.com/playlist/0'
const form = (entries: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}
const stored = (label: string) => rows.find((r) => r.label === label)

beforeEach(() => {
  rows = []
  migrated = true
  nextId = 1
  identityWrites = 0
})

describe('connectOneAction — a new connection is judged as it is saved', () => {
  it('CRITICAL: an identity profile lands OFF the site and vouched for (so it can reach sameAs)', async () => {
    const { connectOneAction } = await connections()
    expect(await connectOneAction('a1', 'spotify', { url: SPOTIFY, sync: false })).toEqual({ ok: true })
    expect(stored('Spotify')).toMatchObject({ url: SPOTIFY, on_site: false, identity_url: SPOTIFY })
  })

  it('CRITICAL: a payment handle lands off the site and NOT vouched for', async () => {
    const { connectOneAction } = await connections()
    expect(await connectOneAction('a1', 'paypal', { handle: 'skeenmusic' })).toEqual({ ok: true })
    expect(stored('PayPal')).toMatchObject({ url: 'https://paypal.me/skeenmusic', on_site: false, identity_url: null })
  })

  it('a handle platform is judged on the link built from the handle', async () => {
    const { connectOneAction } = await connections()
    await connectOneAction('a1', 'instagram', { handle: 'skeenmusic' })
    expect(stored('Instagram')).toMatchObject({ url: 'https://instagram.com/skeenmusic', identity_url: 'https://instagram.com/skeenmusic' })
  })
})

describe('addContentAction — the editor’s picker and every other add', () => {
  it('CRITICAL: stores the verdict for the url it saved', async () => {
    const { addContentAction } = await dashboard()
    expect((await addContentAction('link', 'a1', form({ label: 'Spotify', url: SPOTIFY }))).error).toBeUndefined()
    expect((await addContentAction('link', 'a1', form({ label: 'PayPal', url: 'https://paypal.me/skeenmusic' }))).error).toBeUndefined()
    expect(stored('Spotify')?.identity_url).toBe(SPOTIFY)
    expect(stored('PayPal')?.identity_url).toBeNull()
  })

  it('CRITICAL: a posted `identity_url` is ignored — the browser can never vouch for a link', async () => {
    const { addContentAction } = await dashboard()
    const res = await addContentAction('link', 'a1', form({ label: 'PayPal', url: 'https://paypal.me/skeenmusic', identity_url: 'https://paypal.me/skeenmusic' }))
    expect(res.error).toBeUndefined()
    expect(stored('PayPal')?.identity_url).toBeNull()
  })
})

describe('updateContentAction — a changed url is judged again', () => {
  it('CRITICAL: an identity profile edited to a playlist loses its verdict', async () => {
    rows = [{ id: 'l1', artist_id: 'a1', label: 'Spotify', url: SPOTIFY, role: null, on_site: false, identity_url: SPOTIFY }]
    const { updateContentAction } = await dashboard()
    expect((await updateContentAction('link', 'l1', 'a1', form({ url: PLAYLIST }))).error).toBeUndefined()
    expect(stored('Spotify')).toMatchObject({ url: PLAYLIST, identity_url: null })
  })

  it('CRITICAL: a playlist edited to the artist page gains one', async () => {
    rows = [{ id: 'l1', artist_id: 'a1', label: 'Spotify', url: PLAYLIST, role: null, on_site: false, identity_url: null }]
    const { updateContentAction } = await dashboard()
    await updateContentAction('link', 'l1', 'a1', form({ url: SPOTIFY }))
    expect(stored('Spotify')).toMatchObject({ url: SPOTIFY, identity_url: SPOTIFY })
  })

  it('CRITICAL: a posted `identity_url` is ignored on an edit too, even with no url in it', async () => {
    rows = [{ id: 'l1', artist_id: 'a1', label: 'PayPal', url: 'https://paypal.me/skeenmusic', role: null, on_site: false, identity_url: null }]
    const { updateContentAction } = await dashboard()
    await updateContentAction('link', 'l1', 'a1', form({ sort_order: '3', identity_url: 'https://paypal.me/skeenmusic' }))
    expect(stored('PayPal')).toMatchObject({ sort_order: 3, identity_url: null })
  })

  it('a reorder re-judges to the same verdict and writes nothing more', async () => {
    rows = [{ id: 'l1', artist_id: 'a1', label: 'Spotify', url: SPOTIFY, role: null, on_site: false, identity_url: SPOTIFY }]
    const { updateContentAction } = await dashboard()
    await updateContentAction('link', 'l1', 'a1', form({ sort_order: '2' }))
    expect(stored('Spotify')).toMatchObject({ sort_order: 2, identity_url: SPOTIFY })
    expect(identityWrites).toBe(0)
  })
})

describe('createContent / updateContent — the layer every door ends in', () => {
  it('CRITICAL: a role-bound row is never vouched for, whatever its url', async () => {
    rows = [{ id: 'l1', artist_id: 'a1', label: 'Spotify', url: PLAYLIST, role: 'usb', on_site: true, identity_url: null }]
    await updateContent(sb as never, 'link', 'l1', { url: SPOTIFY })
    expect(stored('Spotify')).toMatchObject({ url: SPOTIFY, identity_url: null })
  })

  it('before the migration (no identity_url column) links still save, and nothing is vouched for', async () => {
    migrated = false
    const created = await createContent(sb as never, 'link', 'a1', { label: 'Spotify', url: SPOTIFY })
    expect(created).not.toHaveProperty('identity_url')
    await updateContent(sb as never, 'link', created.id, { url: PLAYLIST })
    expect(stored('Spotify')).toMatchObject({ url: PLAYLIST })
    expect(stored('Spotify')).not.toHaveProperty('identity_url')
    expect(identityWrites).toBe(0)
  })
})
