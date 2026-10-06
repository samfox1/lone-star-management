'use server'

/**
 * The SEO / GEO page's Test tab: run the tests, apply a fix, read the stored runs.
 *
 * Every action checks, FIRST: a signed-in user, then `callerOwns` (an RLS-scoped read of the
 * artist). Reads then go through the manager's own session (RLS: their artists only).
 *
 * WRITING A RUN: a manager's session cannot write `seo_test_runs` at all (select only; the two
 * write functions are service-role only). `runSeoTestsAction` therefore hands the run the
 * service-role client, AFTER the checks above, with the signed-in manager's id, which the
 * database checks again (a manager of this artist, or an admin) and counts for the per-person
 * limits. The results it stores are computed here on the server; nothing from the request is.
 *
 * Errors come back as one plain sentence; nothing here throws to the client.
 */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { loadEngine, runSeoTests } from '@/lib/seo-tests/run'
import { latestRun, readTestTab, type SeoTestTab, type StoredSeoRun } from '@/lib/seo-tests/store'
import { updateContentAction } from '../../../actions'
import { callerOwns } from '../../../_owns'

type Fail = { ok: false; error: string }

/** Signed in, and a manager of this artist. The client to use and who they are, or the one-line refusal. */
async function owned(artistId: string): Promise<{ ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string } | Fail> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  if (!(await callerOwns(supabase, artistId))) return { ok: false, error: 'Artist not found.' }
  return { ok: true, supabase, userId: user.id }
}

/** Why "Test again" did not run, for the page to act on without reading the sentence:
 *  `busy` a run is going, `cooldown` tested inside the last minute (`retryInS` = seconds left),
 *  `limit` this manager started too many runs lately (`retryInS` = seconds left), `denied` not
 *  this artist's manager, `coalesced` (publish runs only; never from "Test again"), `error`
 *  anything else. */
export type SeoRunRefusal = 'busy' | 'cooldown' | 'limit' | 'coalesced' | 'denied' | 'error'

/**
 * "Test again". Runs every test now and stores the run. Refused (plainly) while a run is going
 * or within a minute of the last one: the database decides, so two tabs cannot both start one.
 */
export async function runSeoTestsAction(
  artistId: string,
): Promise<{ ok: true; run: StoredSeoRun | null } | (Fail & { reason?: SeoRunRefusal; retryInS?: number | null })> {
  const gate = await owned(artistId)
  if (!gate.ok) return gate
  const out = await runSeoTests(gate.supabase, artistId, 'manual', { writer: createAdminClient(), userId: gate.userId })
  if (!out.ok) return { ok: false, reason: out.reason, error: out.error, retryInS: out.retryInS ?? null }
  revalidatePath(`/artists/${artistId}`, 'layout')
  let run: StoredSeoRun | null = null
  try {
    run = await latestRun(gate.supabase, artistId)
  } catch {
    run = null // stored; the page's next read shows it
  }
  return { ok: true, run }
}

export type SeoFix = 'apple-storefront'

/**
 * A fix Tapir can make itself, as a DRAFT the manager then publishes.
 *
 * `apple-storefront`: an Apple Music link tied to another country's store is moved to the US
 * store (`appleStorefrontFix`), through `updateContentAction` — the SAME door the Connections
 * edit window saves a link through, so the link rules (lib/connections `checkedLinkUrl`) judge
 * the new address exactly as they would a manager's paste. Only the artist's own `links` rows
 * are read and changed.
 *
 * Two checks, because /us/ is right only for a US-based artist:
 *   • the OFFER: the latest stored run's `apple` test must be offering this fix (facts.ts offers
 *     it only when the artist is US-based: the country Tapir published first, else the one the
 *     site's fact card states). It only ever narrows what is written.
 *   • the LINK: what is written is recomputed from each link AS IT IS NOW, never taken from a
 *     stored result (the manager may have edited it since the run).
 */
export async function applySeoFixAction(artistId: string, fix: SeoFix): Promise<{ ok: true; changed: number } | Fail> {
  const gate = await owned(artistId)
  if (!gate.ok) return gate
  if (fix !== 'apple-storefront') return { ok: false, error: 'Unknown fix.' }
  let offered = false
  try {
    const latest = await latestRun(gate.supabase, artistId)
    const apple = latest?.results.find((r) => r.id === 'apple')
    offered = apple?.status === 'fail' && apple.action?.kind === 'fix' && apple.action.fix === 'apple-storefront'
  } catch {
    return { ok: false, error: 'Couldn’t read the test results.' }
  }
  if (!offered) return { ok: false, error: 'Test again first: this fix is only for a link the test flagged.' }
  const { data, error } = await gate.supabase.from('links').select('id, url').eq('artist_id', artistId)
  if (error) return { ok: false, error: 'Couldn’t read your links.' }
  let fixOf: (url: string) => string | null
  try {
    fixOf = (await loadEngine()).appleStorefrontFix
  } catch {
    return { ok: false, error: 'That fix isn’t available yet.' }
  }
  let changed = 0
  for (const row of (data ?? []) as { id: string; url: string | null }[]) {
    if (typeof row.url !== 'string') continue
    const next = fixOf(row.url)
    if (!next || next === row.url) continue
    const fd = new FormData()
    fd.set('url', next)
    const res = await updateContentAction('link', row.id, artistId, fd)
    if (res?.error) return { ok: false, error: res.error }
    changed++
  }
  if (changed === 0) return { ok: false, error: 'No Apple Music link needs this fix.' }
  return { ok: true, changed }
}

/**
 * The Test tab's read, `store.readTestTab`, behind the ownership gate: `error` (couldn't read,
 * with the sentence) or `ready` (the latest run and a run in progress; `latest: null` = never
 * tested). The tab polls it while another run is going (test-tab.tsx), so waiting costs two
 * small reads a tick instead of a whole page render.
 */
export async function readSeoTestsAction(
  artistId: string,
): Promise<({ ok: true } & Exclude<SeoTestTab, { state: 'error' }>) | (Fail & { state?: 'error' })> {
  const gate = await owned(artistId)
  if (!gate.ok) return gate
  const tab = await readTestTab(gate.supabase, artistId)
  if (tab.state === 'error') return { ok: false, state: 'error', error: 'Couldn’t read the test results.' }
  return { ok: true, ...tab }
}
