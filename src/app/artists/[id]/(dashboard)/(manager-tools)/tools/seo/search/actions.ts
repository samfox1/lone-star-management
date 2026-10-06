'use server'

import { createClient } from '@/lib/supabase/server'
import { isSearchPeriodKey } from '@/lib/manager-tools/seo/search-stats'
import type { SearchStatsAnswer } from '@/lib/manager-tools/seo/search-stats-ask'
import { callerOwns } from '../../../../_owns'
import { loadSearchStats } from './load'

/**
 * The seen / clicked chart's OTHER period, asked for only when it is clicked (the review,
 * 2026-10-06: the page used to wait on every period, and a refused one, never cached, made every
 * open wait on it). A public door, so: an offered period only, and the caller must own the artist
 * (RLS-scoped read) BEFORE the loader reads the registrations with the service client and asks
 * the engines. The loader's own six-hour cache still applies.
 */
export async function searchPeriodAction(artistId: string, key: string): Promise<{ answer: SearchStatsAnswer } | { error: string }> {
  if (!isSearchPeriodKey(key)) return { error: 'Unknown period.' }
  const supabase = await createClient()
  if (!(await callerOwns(supabase, artistId))) return { error: 'Artist not found.' }
  return { answer: await loadSearchStats(artistId, key) }
}
