/**
 * Test helpers for talking to the real Supabase project as different actors.
 *
 * Tenant isolation is enforced in Postgres (RLS), so it can only be verified
 * against a real database — never a mock. These helpers build clients that
 * carry a real signed JWT for each seeded user, so RLS sees the true
 * `auth.uid()` and `app_metadata.role`.
 *
 * Reads credentials from the env (loaded by vitest.setup.ts from
 * .env.test / .env.local).
 */
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { testStateDir } from '@tests/helpers/db-lock'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Missing Supabase env. Need NEXT_PUBLIC_SUPABASE_URL, ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
}

/** Shared password for all seeded users (see scripts/seed.ts). */
export const SEED_PASSWORD = 'lonestar-dev-password'

export const SEED = {
  admin: 'admin@lonestar.test',
  managerA: 'manager-a@lonestar.test',
  managerB: 'manager-b@lonestar.test',
  artistASlug: 'lone-pine',
  artistBSlug: 'gulf-static',
} as const

/** Each new client gets its own isolated, non-persisted auth state. */
function bareClient(key: string): SupabaseClient {
  return createClient(url!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Unauthenticated client — the anon role. Represents a public/logged-out caller. */
export function anonClient(): SupabaseClient {
  return bareClient(anonKey!)
}

/**
 * Service-role client. Bypasses RLS — used ONLY in tests to set up and tear
 * down fixtures, never to assert isolation. Mirrors the seed script's role.
 */
export function serviceClient(): SupabaseClient {
  return bareClient(serviceKey!)
}

/**
 * One signed-in client per seeded user, per test FILE — and one SESSION per seeded user
 * for the whole machine, reused across files and vitest processes until it nears expiry.
 *
 * WHY THE SESSION IS SHARED. GoTrue rate-limits its token endpoint PER IP, and that one
 * budget is spent by every sign-in from this machine: each vitest process, and the dev
 * server's auto-login (`src/lib/supabase/middleware.ts`), which logged 14 "Request rate
 * limit reached" of its own on 2026-09-28. Signing in once per file cost ~125 sign-ins a
 * run — close enough to the limit that a second run, or a burst from the dev server,
 * tipped it over, and every file whose beforeAll signed in failed as a whole:
 *
 *   Error: sign-in failed for manager-b@lonestar.test: Request rate limit reached
 *
 * (seven files at once in a two-run reproduction; ten in the full suite that morning,
 * each green alone). A 429 lasts longer than any retry a 20s hook can afford, so the fix
 * is to stop spending the budget: the session is written to the per-database state dir
 * (`testStateDir`, OS temp, mode 0600) and the next file ADOPTS it with `setSession`,
 * which checks the token against GoTrue's /user endpoint rather than minting a new one.
 * A full run now signs in at most once per user per ~45 minutes.
 *
 * Inside a file the Map still turns "sign in as A" into a lookup. Safe because nothing in
 * `tests/` mutates auth state on a returned client — no `signOut`, no `updateUser`, no
 * `refreshSession` (re-checked 2026-09-28) — and a shared session makes that rule matter
 * more: a `signOut()` (global scope by default) would revoke the session for every file
 * on the machine until the next fresh sign-in. A suite that needs a session it can
 * destroy must build its own client and sign in itself.
 */
const signedIn = new Map<string, Promise<SupabaseClient>>()

/** Sign in as a seeded user and return a client carrying their JWT. */
export function signInAs(email: string): Promise<SupabaseClient> {
  const cached = signedIn.get(email)
  if (cached) return cached
  const pending = adoptSavedSession(email).then((c) => c ?? doSignIn(email))
  signedIn.set(email, pending)
  // A failed sign-in must not be cached as a permanent failure for the file.
  pending.catch(() => signedIn.delete(email))
  return pending
}

/**
 * A saved session is only adopted while it has this long left. Well past the longest file
 * (~45s) and auth-js's own 90s refresh margin, so a client never tries to REFRESH a shared
 * token mid-file — refresh tokens rotate, and two processes refreshing one would revoke it.
 */
const MIN_REMAINING_S = 15 * 60

type SavedSession = { email: string; access_token: string; refresh_token: string; expires_at: number }

const sessionFile = (email: string) =>
  join(testStateDir(), `session-${createHash('sha256').update(email).digest('hex').slice(0, 16)}.json`)

async function adoptSavedSession(email: string): Promise<SupabaseClient | null> {
  let saved: SavedSession
  try {
    saved = JSON.parse(readFileSync(sessionFile(email), 'utf8')) as SavedSession
  } catch {
    return null
  }
  if (saved.email !== email || !saved.access_token || !saved.refresh_token) return null
  if (!(saved.expires_at - Date.now() / 1000 > MIN_REMAINING_S)) return null
  const client = bareClient(anonKey!)
  const { data, error } = await client.auth.setSession({
    access_token: saved.access_token,
    refresh_token: saved.refresh_token,
  })
  // Revoked, expired early, or GoTrue unreachable: fall back to a real sign-in.
  if (error || data.user?.email !== email) return null
  return client
}

function saveSession(email: string, session: Session | null): void {
  if (!session?.expires_at) return
  const saved: SavedSession = {
    email,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  }
  try {
    const file = sessionFile(email)
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, JSON.stringify(saved), { mode: 0o600 })
    renameSync(tmp, file) // atomic: a reader sees the old session or the new one, never half
  } catch {
    // The cache only saves sign-ins; a read-only temp dir must not fail the suite.
  }
}

async function doSignIn(email: string): Promise<SupabaseClient> {
  // The per-IP limit is shared (see above), so a fresh sign-in can still land in someone
  // else's burst: "Request rate limit reached" is a 429, not a credential problem. Three
  // tries with a widening pause; anything else throws immediately, so a genuinely wrong
  // password still fails fast.
  let last = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = bareClient(anonKey!)
    const { data, error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD })
    if (!error) {
      saveSession(email, data.session)
      return client
    }
    last = error.message
    if (!/rate limit/i.test(last)) break
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
  }
  throw new Error(`sign-in failed for ${email}: ${last}`)
}

/** Look up a seeded artist's id by slug (via service role, bypassing RLS). */
export async function artistIdBySlug(slug: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from('artists')
    .select('id')
    .eq('slug', slug)
    .single()
  if (error || !data) throw new Error(`no seeded artist for slug ${slug}`)
  return data.id
}

/**
 * Publish a snapshot into `revisions` via the service role (bypasses RLS).
 * The public read path (get_public_site) returns the LATEST revision per
 * entity, so publishing = inserting a row here. Returns the new revision id so
 * tests can clean up by stable identity.
 *
 * entity_type is the SINGULAR form from the CHECK constraint:
 *   'artist' | 'track' | 'tour_date' | 'merch' | 'link'
 */
export async function publishRevision(args: {
  artistId: string
  entityType: 'artist' | 'track' | 'tour_date' | 'merch' | 'link'
  entityId?: string | null
  data: Record<string, unknown>
}): Promise<string> {
  const { data, error } = await serviceClient()
    .from('revisions')
    .insert({
      artist_id: args.artistId,
      entity_type: args.entityType,
      entity_id: args.entityId ?? null,
      data: args.data,
    })
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(`publishRevision failed: ${error?.message ?? 'no row'}`)
  }
  return data.id
}
