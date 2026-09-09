'use server'

import { INTEGRATIONS } from './integrations'
import { SHOPIFY_KEY } from './sync-sections'
import { syncShopifyAction } from './merch/actions'
import type { SyncRunResult } from './sync-dialog'

/**
 * RUN THE SOURCES A MANAGER TICKED, and report each one on its own line.
 *
 * The sync dialog hands back a section and the keys chosen; this resolves them against
 * the integrations registry and runs each in turn (Sam, 2026-09-09 — Sync opens a dialog
 * now rather than sending the manager to the integrations page).
 *
 * ITS OWN FILE, not actions.ts: `integrations.ts` imports the pull actions FROM there, so
 * reading the registry inside actions.ts would be a cycle. This sits above both.
 *
 * PER SOURCE, deliberately. `refreshMusicAction` joined every failure into one string, so
 * "Spotify worked, Apple is not linked" arrived as a single red line with no way to tell
 * which half was which — and a manager could not see that the half they cared about had
 * in fact succeeded.
 *
 * Serially, not in parallel: these are rate-limited third-party APIs, and two of the music
 * sources write the same union track rows, where interleaved upserts race each other.
 */
export async function syncSectionAction(
  artistId: string,
  section: string,
  keys: string[],
): Promise<{ results: SyncRunResult[] }> {
  const jobs: { key: string; label: string; run: () => Promise<{ ok: boolean; error?: string; message?: string }> }[] =
    section === 'merch'
      ? keys.includes(SHOPIFY_KEY)
        ? [{ key: SHOPIFY_KEY, label: 'Shopify', run: () => syncShopifyAction(artistId) }]
        : []
      : INTEGRATIONS.filter((i) => i.section === section && keys.includes(i.key)).map((i) => ({
          key: i.key,
          label: i.label,
          run: () => i.pull(artistId),
        }))

  const results: SyncRunResult[] = []
  for (const job of jobs) {
    // A thrown client error is ONE source failing, not the run failing: the sources after
    // it still deserve to run, and the manager still deserves to hear about the ones that
    // worked. Every `pull` catches its own already, so this is the belt.
    try {
      const res = await job.run()
      results.push({ key: job.key, label: job.label, ok: res.ok, message: res.message, error: res.error })
    } catch (e) {
      results.push({ key: job.key, label: job.label, ok: false, error: e instanceof Error ? e.message : 'Pull failed.' })
    }
  }
  return { results }
}
