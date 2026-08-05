/**
 * Shared assertions + fixture bookkeeping for the RLS / isolation suites.
 *
 * WHY THE ASSERTIONS EXIST. `expect(error).not.toBeNull()` passes for ANY error
 * PostgREST hands back, including errors that have nothing to do with security. A
 * renamed RPC parameter returns PGRST202 ("Could not find the function ..."); a
 * mistyped column returns 42703; a duplicate key returns 23505. Each of those keeps
 * the test green while the door it claims to guard stands wide open, because the call
 * never reached the door at all. The only code that means "Postgres refused you" is
 * 42501, so that is what these pin.
 *
 * WHY THE ID SNAPSHOTS EXIST. This suite runs against the LIVE hosted project. A
 * teardown of the shape `delete().eq('artist_id', artistA)` destroys rows the test
 * never created — other people's state, and (worse for us) the very fixtures that make
 * a later denial assertion non-vacuous. Snapshot before, delete the difference after.
 */
import { expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Structural: PostgrestError, but also anything else carrying { code, message }. */
type PgError = { code?: string; message?: string } | null

/** Postgres SQLSTATE for "insufficient privilege" — RLS denial or a missing GRANT. */
const INSUFFICIENT_PRIVILEGE = '42501'

/**
 * The call was refused by Postgres authorization, not by some unrelated failure.
 *
 * Prevents: a policy being dropped while the test stays green because the request now
 * fails for a different reason (renamed function, changed column, constraint violation).
 */
export function expectRlsDenied(error: PgError, what = 'the write'): void {
  expect(error, `${what} should have been denied, but PostgREST returned no error`).not.toBeNull()
  expect(
    error?.code,
    `${what} failed with [${error?.code}] "${error?.message}" — that is not an authorization denial`,
  ).toBe(INSUFFICIENT_PRIVILEGE)
}

/**
 * The named FUNCTION is not executable by this caller.
 *
 * Prevents: PostgREST's PGRST202 ("Could not find the function public.x in the schema
 * cache") masquerading as a closed door. That is what you get after renaming a
 * parameter — the signature no longer resolves, `error` is non-null, and a test that
 * only checks non-null keeps passing even if EXECUTE was later granted to anon.
 */
export function expectExecuteDenied(error: PgError, fnName: string): void {
  expectRlsDenied(error, `rpc ${fnName}`)
  expect(error?.message ?? '').toContain(`permission denied for function ${fnName}`)
}

/**
 * The caller reached the table and RLS turned the row away — i.e. the role DOES hold
 * the INSERT/UPDATE grant, and the only thing refusing it is the deliberate ABSENCE of
 * a policy.
 *
 * Postgres words the two cases differently: a missing GRANT is "permission denied for
 * table x"; a missing POLICY is "new row violates row-level security policy for table
 * x". Several tables here (enquiries, subscribers, contact_attempts, analytics_events)
 * are protected ONLY by the second — stock Supabase hands anon and authenticated a
 * blanket write grant on every public table, and nobody revoked it. Pinning the exact
 * wording is what turns "we deliberately never wrote that policy" into a test that
 * fails the day someone adds one.
 */
export function expectDeniedByMissingPolicy(error: PgError, what: string): void {
  expectRlsDenied(error, what)
  expect(
    error?.message ?? '',
    `${what} was refused, but by a missing GRANT rather than a missing POLICY`,
  ).toMatch(/violates row-level security policy/)
}

type RowId = string | number

/**
 * Ids currently in `table` matching `match`. Take this BEFORE the test writes anything,
 * then pass it to `idsAddedSince` in afterAll so teardown removes only new rows.
 */
export async function snapshotIds(
  client: SupabaseClient,
  table: string,
  match: Record<string, unknown>,
): Promise<Set<RowId>> {
  const { data, error } = await client.from(table).select('id').match(match)
  if (error) throw new Error(`snapshotIds(${table}): ${error.message}`)
  return new Set((data ?? []).map((r) => (r as { id: RowId }).id))
}

/** Ids that appeared since `before` was taken — exactly what this test run created. */
export async function idsAddedSince(
  client: SupabaseClient,
  table: string,
  match: Record<string, unknown>,
  before: Set<RowId>,
): Promise<RowId[]> {
  const now = await snapshotIds(client, table, match)
  return [...now].filter((id) => !before.has(id))
}

/**
 * Delete only the rows this test added to `table` under `match`. Safe to call in an
 * afterAll that may run after a failed beforeAll (a missing snapshot means "delete
 * nothing", never "delete everything").
 */
export async function deleteAddedSince(
  client: SupabaseClient,
  table: string,
  match: Record<string, unknown>,
  before: Set<RowId> | undefined,
): Promise<void> {
  if (!before) return
  const added = await idsAddedSince(client, table, match, before)
  if (added.length) await client.from(table).delete().in('id', added)
}
