/**
 * The Brand layout's Publish bar: is anything on the Brand page not on the site yet?
 *
 * SERVER-ONLY, and a separate file for exactly that reason. `lib/brand.ts` is imported by
 * client components (the favicon editor draws with it), so it cannot create the
 * cookie-bound client without dragging `next/headers` into the browser bundle. The
 * comparison itself is `brandPending` there, over an injected client, where the tests
 * reach it; this is only the request's client around it. (The repo has no `server-only`
 * package; `@/lib/supabase/server` importing `next/headers` is what keeps this file out of
 * a client graph — Next refuses the import there.)
 *
 * Uncached on purpose — unlike `dashboardDiff`, which is cosmetic and 30s stale — because
 * this bar appears the moment a change lands and must disappear the moment it is
 * published. RLS scopes every read to the caller's own artist.
 */
import { brandPending, type BrandPending } from '@/lib/brand'
import { createClient } from '@/lib/supabase/server'

export type { BrandPending }

export async function loadBrandPending(artistId: string): Promise<BrandPending> {
  const supabase = await createClient()
  try {
    return await brandPending(supabase, artistId)
  } catch {
    // The bar has no error state; failing closed (hidden) is the honest default — the
    // manager can still publish from anywhere else, and nothing is claimed to be live.
    return { dirty: false, message: '', canRevert: false }
  }
}
