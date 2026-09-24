import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exportFilename, subscribersCsv } from '@/lib/manager-tools/subscribers/subscribers'
import { requireOwnedArtist } from '../../../_owns'
import { readSubscribers } from '../_read'

/**
 * THE SUBSCRIBERS CSV (Sam, 2026-09-24). The toolbar's "Download CSV" is a plain link here.
 *
 * OWNER-ONLY, by the check the dashboard actions make (`requireOwnedArtist`: signed in, and
 * the artist row is visible through RLS), and FIRST: a caller who fails it gets a 404 before
 * one subscriber row is read, and the 404 does not say whether the artist exists.
 *
 * The FULL list through the caller's own client (never the service role), newest first, never
 * the page's search. `email,subscribed_at`, ISO days in UTC, escaped and CSV-injection guarded
 * (`subscribersCsv`). Built on click, never cached.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const owned = await requireOwnedArtist<{ id: string; slug: string | null }>(supabase, id, 'id, slug')
  if (!owned.ok) return new NextResponse('Not found', { status: 404, headers: NO_STORE })

  const rows = await readSubscribers(supabase, id)
  if (!rows) return NextResponse.json({ error: 'Could not read subscribers.' }, { status: 502, headers: NO_STORE })

  return new NextResponse(subscribersCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      // exportFilename cuts the slug to [a-z0-9-], so the header is always valid.
      'content-disposition': `attachment; filename="${exportFilename(String(owned.artist.slug ?? ''), Date.now())}"`,
      ...NO_STORE,
    },
  })
}

const NO_STORE = { 'cache-control': 'no-store' }
