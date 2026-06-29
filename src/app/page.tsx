import { logout } from '@/app/auth-actions'
import { createClient } from '@/lib/supabase/server'
import { AppShell, Wordmark } from '@/components/ui/app-shell'
import { Button } from '@/components/ui/ui'
import { RosterView } from './roster-view'

export const metadata = { title: 'Your artists — Lone Star Management' }

export default async function Home() {
  const supabase = await createClient()

  // The proxy guarantees a session here, but read the user for the header.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // RLS scopes this to only the artists this manager manages (admins see all).
  const { data: artists, error } = await supabase
    .from('artists')
    .select('id, name, slug')
    .order('name')

  // A failed read must never look like an empty result on the security gate.
  if (error) throw error

  // Pending build requests show as "Site in progress" cards. Tolerate only the
  // "table not migrated yet" case (42P01) by degrading to none; a real DB/RLS
  // failure must surface, not silently render as "no pending".
  const { data: requests, error: requestsError } = await supabase
    .from('artist_requests')
    .select('id, name, handle')
    .in('status', ['requested', 'in_build'])
    .order('created_at', { ascending: false })
  if (requestsError && requestsError.code !== '42P01') throw requestsError

  const isAdmin = user?.app_metadata?.role === 'admin'

  const tools = (
    <>
      <span className="hidden font-space text-xs text-ink-muted sm:inline">{user?.email}</span>
      <form action={logout}>
        <Button variant="ghost" type="submit">
          Sign out
        </Button>
      </form>
    </>
  )

  return (
    <AppShell brand={<Wordmark page="Roster" />} items={[]} tools={tools}>
      <RosterView
        artists={artists ?? []}
        pending={requests ?? []}
        subtitle={isAdmin ? 'Admin — every artist on the platform.' : 'The artists you manage.'}
      />
    </AppShell>
  )
}
