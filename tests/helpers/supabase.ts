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
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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

/** Sign in as a seeded user and return a client carrying their JWT. */
export async function signInAs(email: string): Promise<SupabaseClient> {
  const client = bareClient(anonKey!)
  const { error } = await client.auth.signInWithPassword({
    email,
    password: SEED_PASSWORD,
  })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
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
