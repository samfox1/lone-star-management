/**
 * The world a publish action runs in, without a database: a password gate that says yes (or
 * no), a signed-in manager, a PostgREST fake holding one row per table, and ONE list of every
 * publish entry point actions.ts exports.
 *
 * Code:     support file (not a test): feeds src/app/artists/[id]/(dashboard)/actions.ts
 *           (publishGated and every `publish…Action`) in tests/unit/publish/indexnow-publish.test.ts,
 *           tests/unit/publish/publish-one-insert.test.ts, tests/unit/seo-tests/runs/publish-hook.test.ts
 *           and tests/unit/manager-tools/brand/brand-publish.test.ts (its mocks only)
 * Feature:  Publish: what one click writes, and what it schedules afterwards
 * Tier:     STRICT (AGENTS.md "Test depth"): the suites built on it guard Publish, the one path
 *           whose failure loses a manager's work.
 * What it provides:
 *           • PUBLISH_ACTIONS: every `publish…Action` the module exports, keyed by the module's own
 *             TYPE (rule 4), so a new publish action is a compile error here until it says how it
 *             is called, whether it is password-gated, whether it pings, and whether it ships site text
 *           • publishCases(pick): those entries as `it.each` rows
 *           • gate / WRONG_PASSWORD / passwordMock: the password check, for vi.mock('@supabase/supabase-js')
 *           • world(opts) / setWorld / serverMock: the fake behind vi.mock('@/lib/supabase/server')
 *           • isKeyWrite: a write of the IndexNow key row
 * Not here: `after`, the schedulers and the network: each suite mocks what it is about.
 * Fixtures: artist a1, manager u1; nothing published yet (every rpc answers []); one working row
 *           per table, and two media rows (a Brand logo and a gallery photo).
 */
import { INDEXNOW_CONTENT_KEY } from '@samfox1/site-bridge/indexnow'
import { fakeClient, filterValue, type Call, type Reply } from '@tests/helpers/fake-client'

export const A = 'a1'
export type Actions = typeof import('@/app/artists/[id]/(dashboard)/actions')
export type PublishName = Extract<keyof Actions, `publish${string}Action`>
type Entry = {
  run: (a: Actions) => Promise<unknown>
  /** Behind the manager's password (publishGated). */
  gated: boolean
  /** Schedules the IndexNow ping, the sitemap resend and the SEO / GEO run after it succeeds. */
  pings: boolean
  /** Ships site text, so it writes the IndexNow key into the draft first. */
  shipsSiteText: boolean
}

/** Every publish entry point, and how each is called (password 'pw', artist A). */
export const PUBLISH_ACTIONS: Record<PublishName, Entry> = {
  publishAction: { run: (a) => a.publishAction(A, 'pw'), gated: true, pings: true, shipsSiteText: true },
  publishAllGatedAction: { run: (a) => a.publishAllGatedAction(A, 'pw'), gated: true, pings: true, shipsSiteText: true },
  publishSiteWithPasswordAction: { run: (a) => a.publishSiteWithPasswordAction(A, 'pw'), gated: true, pings: true, shipsSiteText: true },
  publishMusicAction: { run: (a) => a.publishMusicAction(A, 'pw'), gated: true, pings: true, shipsSiteText: false },
  publishEntityAction: { run: (a) => a.publishEntityAction('tour_date', A, 'pw'), gated: true, pings: true, shipsSiteText: false },
  publishBrandWithPasswordAction: { run: (a) => a.publishBrandWithPasswordAction(A, 'pw'), gated: true, pings: false, shipsSiteText: false },
  publishSiteAction: { run: (a) => a.publishSiteAction(A), gated: false, pings: false, shipsSiteText: false },
  publishSectionAction: { run: (a) => a.publishSectionAction('tour_date', A), gated: false, pings: false, shipsSiteText: false },
}

/** The entries `pick` keeps, as `it.each` rows named after the action. */
export const publishCases = (pick: (e: Entry & { name: PublishName }) => boolean) =>
  (Object.entries(PUBLISH_ACTIONS) as [PublishName, Entry][]).map(([name, e]) => ({ name, ...e })).filter(pick)

/** What the password check answers: null is the right password. A test sets `gate.error`. */
export const gate = { error: null as null | { message: string; code?: string; status?: number } }
export const WRONG_PASSWORD = { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' }

/** vi.mock('@supabase/supabase-js', async (orig) => (await import(…)).passwordMock(orig)): the
 *  throwaway client the password gate signs in on. */
export async function passwordMock(orig: () => Promise<typeof import('@supabase/supabase-js')>) {
  return { ...(await orig()), createClient: () => ({ auth: { signInWithPassword: async () => ({ error: gate.error }) } }) }
}

/** A write of the IndexNow key row (any write op, so a delete or insert would count too). */
export function isKeyWrite(c: Call): boolean {
  return c.table === 'site_content' && c.op !== 'select' && (c.payload as { key?: string } | undefined)?.key === INDEXNOW_CONTENT_KEY
}

export const LOGO = { id: 'media-logo', artist_id: A, purpose: 'logo' }
export const PHOTO = { id: 'media-photo', artist_id: A, purpose: 'gallery_image' }

export type World = {
  /** The artist's site as the IndexNow key logic reads it. Default: a template site, never pinged. */
  site?: { site_kind: string; custom_site_url: string | null }
  /** The draft's IndexNow key. */
  key?: string | null
  /** Refuse the key write. */
  upsertError?: boolean
  /** Refuse the one revisions insert: the publish fails. */
  insertError?: boolean
}

export function world({ site = { site_kind: 'template', custom_site_url: null }, key = null, upsertError = false, insertError = false }: World = {}) {
  return fakeClient((c: Call): Reply => {
    if (c.op === 'rpc') return { data: [] } // nothing published yet: every row is new
    if (c.table === 'artists' && c.cols === 'site_kind, custom_site_url') return { data: site }
    if (c.table === 'artists' && c.cols === 'id, theme_color') return { data: { id: A, theme_color: '#0a0a0a' } }
    if (c.table === 'artists') return { data: { name: 'Fake' } } // the profile snapshot
    if (isKeyWrite(c)) return upsertError ? { error: { message: 'denied' } } : { data: null }
    if (c.table === 'site_content' && c.op === 'select' && filterValue(c, 'key') === INDEXNOW_CONTENT_KEY) return { data: key ? { value: key } : null }
    if (c.table === 'revisions' && c.op === 'insert') return insertError ? { error: { message: 'insert refused' } } : { data: null }
    // Media holds one of each side, so every action shows which media it sends.
    if (c.table === 'media') return { data: [LOGO, PHOTO], count: 2 }
    return { data: [{ id: `${c.table}-1`, artist_id: A, purpose: 'logo' }], count: 1 }
  })
}

let current = world()
/** The fake the server client wraps from now on. */
export function setWorld(f: ReturnType<typeof fakeClient>) {
  current = f
  return f
}

/** vi.mock('@/lib/supabase/server', async () => (await import(…)).serverMock): the current
 *  world, signed in as manager u1. */
export const serverMock = {
  createClient: async () => ({ ...current.client, auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'm@example.test' } } }) } }),
}
