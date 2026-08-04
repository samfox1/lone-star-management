import { createClient } from '@/lib/supabase/server'
import type { InboxRow } from '@/lib/enquiry-inbox'
import { EnquiryTable } from './[id]/(dashboard)/enquiries/enquiry-table'
import { EmptyState, RosterShell, SectionToolbar } from '../roster-chrome'
import { ownedArtists } from '../roster-data'

export const metadata = { title: 'Enquiries — Lone Star Management' }

/** Enough to hold a busy roster's recent mail without asking the browser to render a
 *  thousand rows nobody scrolls to. Older enquiries stay reachable on the artist's own
 *  page, which is scoped and therefore shorter. */
const MAX_ROWS = 200

/**
 * The roster-wide enquiries inbox.
 *
 * One inbox for every artist a manager has, because that is what an inbox IS — one list of
 * mail from many senders, with the sender labelled. The artist page renders the SAME
 * component scoped to one artist; the only difference is whether the artist label is
 * shown. Two screens that behave identically, from one piece of code.
 *
 * This replaced a table of per-artist counts. The table answered "who has a pile waiting"
 * but you could not read anything from it — every message was still two clicks away, and
 * it looked nothing like the page it linked to.
 *
 * RLS does the scoping: `enquiries` is is_admin() OR is_manager_of(artist_id), so this
 * unfiltered read returns exactly the caller's roster and nothing else.
 */
export default async function EnquiriesInboxPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const artists = await ownedArtists(supabase)
  const nameById = new Map(artists.map((a) => [a.id, a.name]))

  const { data } = await supabase
    .from('enquiries')
    .select('id, artist_id, purpose, name, email, message, read_at, created_at, demo_url')
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)
  const enquiries = (data ?? []) as (Omit<InboxRow, 'attachmentCount' | 'artistId' | 'artistName'> & {
    artist_id: string
  })[]

  // Counts only. Signing happens when a message is opened, so the page costs one extra
  // query rather than a round trip per attachment for URLs that mostly expire unread.
  const { data: attachmentRows } = await supabase
    .from('enquiry_attachments')
    .select('enquiry_id')
    .in('enquiry_id', enquiries.length ? enquiries.map((r) => r.id) : ['00000000-0000-0000-0000-000000000000'])
  const counts = new Map<string, number>()
  for (const a of attachmentRows ?? []) {
    const key = a.enquiry_id as string
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const rows: InboxRow[] = enquiries.map((r) => ({
    ...r,
    attachmentCount: counts.get(r.id) ?? 0,
    artistId: r.artist_id,
    // An artist RLS hides would be a bug, not a normal state — but rendering "Unknown"
    // beats dropping the message, which would hide mail somebody sent.
    artistName: nameById.get(r.artist_id) ?? 'Unknown artist',
  }))

  return (
    <RosterShell active="enquiries" page="Enquiries" email={user?.email ?? null}>
      <SectionToolbar title="Enquiries" />
      {artists.length === 0 ? (
        <EmptyState
          icon="note"
          title="No artists yet"
          sub="Request your first artist — booking and demo enquiries from their site collect here, across your whole roster."
        />
      ) : (
        <div className="px-7 pb-12">
          <EnquiryTable rows={rows} showArtist />
        </div>
      )}
    </RosterShell>
  )
}
