'use server'

/**
 * The SEO / GEO page's Test tab: run the tests, apply a fix, read the stored runs.
 *
 * Every action checks, FIRST: a signed-in user, then `callerOwns` (an RLS-scoped read of the
 * artist). RLS and the claim trigger check again underneath, but a row-filtered read or write
 * answers "nothing" rather than "no", so without this a stranger would get an empty page instead
 * of a refusal. Errors come back as one plain sentence; nothing here throws to the client.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { readSeoOverview, type SeoOverview } from '@/lib/seo-tests/overview'
import { loadEngine, runSeoTests } from '@/lib/seo-tests/run'
import { currentRun, historyFor, latestRun, type StoredSeoRun } from '@/lib/seo-tests/store'
import type { SeoRunTrigger, SeoTestHistory, SeoTestId } from '@/lib/seo-tests/types'
import { updateContentAction } from '../../../actions'
import { callerOwns } from '../../../_owns'

type Fail = { ok: false; error: string }

/** Signed in, and a manager of this artist. The client to use, or the one-line refusal. */
async function owned(artistId: string): Promise<{ ok: true; supabase: Awaited<ReturnType<typeof createClient>> } | Fail> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  if (!(await callerOwns(supabase, artistId))) return { ok: false, error: 'Artist not found.' }
  return { ok: true, supabase }
}

/**
 * "Test again". Runs all 24 tests now and stores the run. Refused (plainly) while a run is going
 * or within a minute of the last one: the database decides, so two tabs cannot both start one.
 */
export async function runSeoTestsAction(artistId: string): Promise<{ ok: true; run: StoredSeoRun | null } | (Fail & { retryInS?: number | null })> {
  const gate = await owned(artistId)
  if (!gate.ok) return gate
  const out = await runSeoTests(gate.supabase, artistId, 'manual')
  if (!out.ok) return { ok: false, error: out.error, retryInS: out.retryInS ?? null }
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
 *   • the OFFER: the latest stored run's `apple` test must be offering this fix (it does only
 *     when the artist's site says they're US-based). It only ever narrows what is written.
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

/** The Test tab: the latest run, each test's history dots, and a run in progress. */
export async function readSeoTestsAction(
  artistId: string,
): Promise<{ ok: true; latest: StoredSeoRun | null; history: Record<SeoTestId, SeoTestHistory>; running: { ranAt: string; trigger: SeoRunTrigger } | null } | Fail> {
  const gate = await owned(artistId)
  if (!gate.ok) return gate
  try {
    const [latest, history, running] = await Promise.all([latestRun(gate.supabase, artistId), historyFor(gate.supabase, artistId), currentRun(gate.supabase, artistId)])
    return { ok: true, latest, history, running }
  } catch {
    return { ok: false, error: 'Couldn’t read the test results.' }
  }
}

/** The Overview tab. Parts that cannot be read come back null, never 0 (overview.ts). */
export async function readSeoOverviewAction(artistId: string): Promise<{ ok: true; overview: SeoOverview } | Fail> {
  const gate = await owned(artistId)
  if (!gate.ok) return gate
  try {
    return { ok: true, overview: await readSeoOverview(gate.supabase, artistId) }
  } catch {
    return { ok: false, error: 'Couldn’t read the overview.' }
  }
}
