import { createClient } from '@/lib/supabase/server'
import { requireArtist } from '../../_data'
import { readSubscribers } from './_read'
import { SubscribersLedger } from './subscribers-ledger'

export const metadata = { title: 'Subscribers — Lone Star Management' }

/**
 * SUBSCRIBERS (Sam, 2026-09-24): the emails the site's signup door collected, as a ledger
 * (subscribers-ledger.tsx). Read-only: `subscribe()` is the only writer.
 *
 * `requireArtist` is the non-owner → 404 gate; the read goes through the caller's client, so
 * RLS (owner-read) scopes it too. Every row, past PostgREST's 1000-row cap (`readSubscribers`).
 * A failed read throws to the error boundary rather than rendering "No subscribers yet.".
 */
export default async function SubscribersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireArtist(id)
  const subscribers = await readSubscribers(await createClient(), id)
  if (!subscribers) throw new Error('Could not read subscribers.')
  return <SubscribersLedger artistId={id} subscribers={subscribers} />
}
