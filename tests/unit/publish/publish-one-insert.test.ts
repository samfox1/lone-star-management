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
import { LOGO, PHOTO, PUBLISH_ACTIONS, setWorld, world, type PublishName } from '@tests/helpers/publish-world'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }))
// The password gate signs in on a throwaway client; here it always says yes.
vi.mock('@supabase/supabase-js', async (orig) => (await import('@tests/helpers/publish-world')).passwordMock(orig))
vi.mock('@/lib/supabase/server', async () => (await import('@tests/helpers/publish-world')).serverMock)

let fake = setWorld(world())

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
  fake = setWorld(world())
})

/** `media`: which media rows the action sends. The Brand page owns the logo and the Site /
 *  SEO publish the photo (2026-09-28: the Site publish used to ship Brand's draft logos
 *  and icons too); the whole-site publishes send both. */
type Sends = { kinds: readonly string[]; media: readonly string[] }
const SENDS: Partial<Record<PublishName, Sends>> = {
  publishAction: { kinds: EVERYTHING, media: BOTH },
  publishAllGatedAction: { kinds: EVERYTHING, media: BOTH },
  publishBrandWithPasswordAction: { kinds: BRAND_KINDS, media: [LOGO.id] },
  publishSiteAction: { kinds: ['media', 'site_content', 'artist'], media: [PHOTO.id] },
  publishSiteWithPasswordAction: { kinds: ['media', 'site_content', 'artist'], media: [PHOTO.id] },
  publishMusicAction: { kinds: ['release', 'track'], media: [] },
}
const CASES = (Object.entries(SENDS) as [PublishName, Sends][]).map(([name, sends]) => ({ name, run: PUBLISH_ACTIONS[name].run, ...sends }))

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
