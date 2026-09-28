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
    // One working row per table; a logo, so the Brand page's media slice keeps it too.
    return { data: [{ id: `${c.table}-1`, artist_id: A, purpose: 'logo' }], count: 1 }
  })
}

/** Every `revisions` insert the action made, as the entity types each one carried. */
function inserts(): string[][] {
  return fake.calls
    .filter((c) => c.table === 'revisions' && c.op === 'insert')
    .map((c) => (Array.isArray(c.payload) ? c.payload : [c.payload]).map((r) => (r as { entity_type: string }).entity_type))
}

const sorted = (xs: readonly string[]) => [...xs].sort()
const EVERYTHING = [...Object.keys(PUBLISHABLE), 'artist']

beforeEach(() => {
  fake = world()
})

type Actions = typeof import('@/app/artists/[id]/(dashboard)/actions')
const CASES: { name: string; run: (a: Actions) => Promise<unknown>; kinds: readonly string[] }[] = [
  { name: 'publishAction (the dashboard Publish)', run: (a) => a.publishAction(A), kinds: EVERYTHING },
  { name: "publishAllGatedAction (the editor's Publish)", run: (a) => a.publishAllGatedAction(A, 'pw'), kinds: EVERYTHING },
  { name: 'publishBrandWithPasswordAction', run: (a) => a.publishBrandWithPasswordAction(A, 'pw'), kinds: BRAND_KINDS },
  { name: 'publishSiteAction', run: (a) => a.publishSiteAction(A), kinds: ['media', 'site_content', 'artist'] },
  { name: 'publishSiteWithPasswordAction (SEO / GEO)', run: (a) => a.publishSiteWithPasswordAction(A, 'pw'), kinds: ['media', 'site_content', 'artist'] },
  { name: 'publishMusicAction', run: (a) => a.publishMusicAction(A, 'pw'), kinds: ['release', 'track'] },
]

describe('one click, one insert', () => {
  it.each(CASES)('CRITICAL: $name writes every kind it sends in ONE insert', async ({ run, kinds }) => {
    const actions = await import('@/app/artists/[id]/(dashboard)/actions')
    const res = await run(actions)
    if (res !== undefined) expect(res).toEqual({ ok: true })
    const made = inserts()
    expect(made, 'one insert per click: a second is a second version in the history').toHaveLength(1)
    expect(sorted(made[0])).toEqual(sorted(kinds))
  })
})
