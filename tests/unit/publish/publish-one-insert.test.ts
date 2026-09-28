// Every Publish button that sends several kinds sends them in ONE write, so one click is
//   one version in the history.
/**
 * The DB-free half of tests/integration/publish/publish-one-moment.test.ts: that file shows
 * the database turning one insert into one publish moment (and refusing all of it or none);
 * this pins that each multi-kind Publish ACTION really makes one insert, over a fake client.
 * A per-kind loop creeping back into an action (the way the Site and Music publishes were
 * written, one `publishContent` per kind) fails here without a network round trip.
 *
 * Every table holds one row, so every kind has something to send: an action that wrote in
 * several inserts could not hide behind a kind with nothing in it. The kinds each action
 * sends are its spec, except where a registry names them (PUBLISHABLE, BRAND_KINDS).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PUBLISHABLE } from '@/lib/content'
import { BRAND_KINDS } from '@/lib/brand'
import { fakeClient, type Call } from '@tests/unit/manager-tools/brand/_fake-client'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }))
// The password gate signs in on a throwaway client; here it always says yes.
vi.mock('@supabase/supabase-js', async (orig) => ({
  ...(await orig<typeof import('@supabase/supabase-js')>()),
  createClient: () => ({ auth: { signInWithPassword: async () => ({ error: null }) } }),
}))

const A = 'a1'
let fake = fakeClient()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    ...fake.client,
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'm@example.test' } } }) },
  })),
}))

function world() {
  return fakeClient((c: Call) => {
    if (c.op === 'rpc') return { data: [] } // nothing published yet: every row is new
    if (c.table === 'artists' && c.cols === 'id, theme_color') return { data: { id: A, theme_color: '#0a0a0a' } }
    if (c.table === 'artists') return { data: { name: 'Fake' } } // the profile snapshot
    // Media holds one of each side: a logo (the Brand page's) and a gallery photo (the
    // site's), so every action shows which media it sends.
    if (c.table === 'media') return { data: [LOGO, PHOTO], count: 2 }
    // One working row per other table.
    return { data: [{ id: `${c.table}-1`, artist_id: A, purpose: 'logo' }], count: 1 }
  })
}
const LOGO = { id: 'media-logo', artist_id: A, purpose: 'logo' }
const PHOTO = { id: 'media-photo', artist_id: A, purpose: 'gallery_image' }

type Row = { entity_type: string; entity_id: string }
/** Every `revisions` insert the action made, as the rows each one carried. */
function inserts(): Row[][] {
  return fake.calls
    .filter((c) => c.table === 'revisions' && c.op === 'insert')
    .map((c) => (Array.isArray(c.payload) ? c.payload : [c.payload]) as Row[])
}

const sorted = (xs: readonly string[]) => [...xs].sort()
const kindsOf = (rows: Row[]) => sorted([...new Set(rows.map((r) => r.entity_type))])
const mediaOf = (rows: Row[]) => sorted(rows.filter((r) => r.entity_type === 'media').map((r) => r.entity_id))
const EVERYTHING = [...Object.keys(PUBLISHABLE), 'artist']
const BOTH = [LOGO.id, PHOTO.id]

beforeEach(() => {
  fake = world()
})

type Actions = typeof import('@/app/artists/[id]/(dashboard)/actions')
/** `media`: which media rows the action sends. The Brand page owns the logo and the Site /
 *  SEO publish the photo (2026-09-28: the Site publish used to ship Brand's draft logos
 *  and icons too); the whole-site publishes send both. */
const CASES: { name: string; run: (a: Actions) => Promise<unknown>; kinds: readonly string[]; media: readonly string[] }[] = [
  { name: 'publishAction (the dashboard Publish)', run: (a) => a.publishAction(A, 'pw'), kinds: EVERYTHING, media: BOTH },
  { name: "publishAllGatedAction (the editor's Publish)", run: (a) => a.publishAllGatedAction(A, 'pw'), kinds: EVERYTHING, media: BOTH },
  { name: 'publishBrandWithPasswordAction', run: (a) => a.publishBrandWithPasswordAction(A, 'pw'), kinds: BRAND_KINDS, media: [LOGO.id] },
  { name: 'publishSiteAction', run: (a) => a.publishSiteAction(A), kinds: ['media', 'site_content', 'artist'], media: [PHOTO.id] },
  {
    name: 'publishSiteWithPasswordAction (SEO / GEO)',
    run: (a) => a.publishSiteWithPasswordAction(A, 'pw'),
    kinds: ['media', 'site_content', 'artist'],
    media: [PHOTO.id],
  },
  { name: 'publishMusicAction', run: (a) => a.publishMusicAction(A, 'pw'), kinds: ['release', 'track'], media: [] },
]

describe('one click, one insert', () => {
  it.each(CASES)('CRITICAL: $name writes every kind it sends in ONE insert', async ({ run, kinds, media }) => {
    const actions = await import('@/app/artists/[id]/(dashboard)/actions')
    const res = await run(actions)
    if (res !== undefined) expect(res).toEqual({ ok: true })
    const made = inserts()
    expect(made, 'one insert per click: a second is a second version in the history').toHaveLength(1)
    expect(kindsOf(made[0])).toEqual(sorted(kinds))
    expect(mediaOf(made[0]), 'which media this Publish owns').toEqual(sorted(media))
  })
})
