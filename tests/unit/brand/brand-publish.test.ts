// The Brand page's Publish sends logos, icons and fonts to the site — and leaves every other
//   photo's draft where it is.
/**
 * `publishBrandWithPasswordAction`, end to end over a fake client (no database).
 *
 * The Brand bar is brand-scoped (`brandPending`), so its Publish has to be too. It used to
 * run `publishContent('media')` whole: a manager publishing a new logo also pushed a
 * half-finished gallery (a photo ticked on the Images page, a hero swapped in the editor)
 * to the live site from a page that never showed it. This pins the slice from both sides:
 *
 *   • a brand draft IS published, and a deleted brand row IS tombstoned;
 *   • a gallery draft is NOT published, and a deleted gallery photo is NOT tombstoned —
 *     the second is the sharper edge: a tombstone takes a live photo OFF the site.
 *
 * The fonts half (`artist_font`) publishes whole, as before. `publishAll` and the
 * editor's publish are untouched; tests/unit/publish/publish-order.test.ts still pins them
 * against PUBLISHABLE.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publicSnapshot, type ContentRow } from '@/lib/content'
import { fakeClient, type Call } from '@tests/unit/brand/_fake-client'

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

const media = (id: string, purpose: string, extra: Record<string, unknown> = {}): ContentRow => ({
  id,
  artist_id: A,
  purpose,
  storage_path: `${A}/x/${id}.png`,
  sort_order: 1,
  created_at: '2026-09-01T00:00:00+00:00',
  on_site: true,
  orientation: null,
  site_role: null,
  label: purpose === 'logo' ? `Logo ${id}` : null,
  collection: null,
  alt: null,
  kind: 'photo',
  ...extra,
})
const pub = (row: ContentRow) => ({ entity_type: 'media', entity_id: row.id, data: publicSnapshot('media', row) })

/** The live draft and the published log: one of each case, brand and not. */
const logoDraft = media('logo-new', 'logo') // added since the publish
const galleryDraft = media('photo-new', 'gallery_image') // added since the publish
const heroEdited = media('hero-1', 'hero_video') // published, then edited
const logoGone = media('logo-gone', 'logo_secondary') // published, then deleted
const photoGone = media('photo-gone', 'gallery_image') // published, then deleted
const font = { id: 'f1', artist_id: A, label: 'Mori', family: 'mori', storage_path: `${A}/fonts/f1.woff2`, format: 'woff2', created_at: 'x', slots: ['primary'] }

function world() {
  return fakeClient((c: Call) => {
    if (c.op === 'rpc') return { data: [pub({ ...heroEdited, sort_order: 0 }), pub(logoGone), pub(photoGone)] }
    if (c.op === 'select' && c.table === 'media') {
      const rows = [logoDraft, galleryDraft, heroEdited]
      return { data: rows, count: rows.length }
    }
    if (c.op === 'select' && c.table === 'artist_fonts_with_slots') return { data: [font], count: 1 }
    return { data: [] }
  })
}

/** Every revision the publish wrote, as [entity_type, entity_id, tombstone?]. */
function written(): [string, string, boolean][] {
  return fake.calls
    .filter((c) => c.table === 'revisions' && c.op === 'insert')
    .flatMap((c) => c.payload as { entity_type: string; entity_id: string; data: Record<string, unknown> }[])
    .map((r) => [r.entity_type, r.entity_id, r.data._deleted === true])
}

beforeEach(() => {
  fake = world()
})

describe('the Brand publish is brand-scoped', () => {
  it('CRITICAL: a logo draft IS published; a gallery draft is NOT', async () => {
    const { publishBrandWithPasswordAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishBrandWithPasswordAction(A, 'pw')).toEqual({ ok: true })
    const ids = written().map(([, id]) => id)
    expect(ids).toContain('logo-new')
    expect(ids).not.toContain('photo-new')
    expect(ids).not.toContain('hero-1') // an edited hero is a draft too, and not this page's
  })

  it('CRITICAL: a deleted brand row IS tombstoned; a deleted gallery photo is NOT (it stays live)', async () => {
    const { publishBrandWithPasswordAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    await publishBrandWithPasswordAction(A, 'pw')
    expect(written()).toContainEqual(['media', 'logo-gone', true])
    expect(written().find(([, id]) => id === 'photo-gone')).toBeUndefined()
  })

  it('the fonts still publish whole', async () => {
    const { publishBrandWithPasswordAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    await publishBrandWithPasswordAction(A, 'pw')
    expect(written()).toContainEqual(['artist_font', 'f1', false])
  })

  it('no storage sweep runs on this path (nothing is removed from any bucket)', async () => {
    const { publishBrandWithPasswordAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    await publishBrandWithPasswordAction(A, 'pw')
    expect(fake.removed).toEqual([])
  })
})

describe('publishContent without a slice is exactly what it was', () => {
  it('the whole media table publishes: every draft, every tombstone', async () => {
    const { publishContent } = await import('@/lib/content')
    await publishContent(fake.client, 'media', A, 'u1')
    const got = written()
    for (const id of ['logo-new', 'photo-new', 'hero-1']) expect(got).toContainEqual(['media', id, false])
    for (const id of ['logo-gone', 'photo-gone']) expect(got).toContainEqual(['media', id, true])
  })
})
