import type { ReactNode } from 'react'
import Link from 'next/link'
import { logout } from '@/app/auth-actions'
import { createClient } from '@/lib/supabase/server'
import { KLabel, buttonClass } from '@/components/ui/ui'
import { RosterShell, SectionToolbar } from '../roster-chrome'
import { ownedArtists } from '../roster-data'

export const metadata = { title: 'Account — Lone Star Management' }

export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const artists = await ownedArtists(supabase)
  const isAdmin = user?.app_metadata?.role === 'admin'

  return (
    <RosterShell page="Account" email={user?.email ?? null}>
      <SectionToolbar title="Account" />
      <div className="max-w-2xl px-7 pb-12">
        <KLabel>Account</KLabel>
        <div className="mt-3 overflow-hidden rounded-xl border border-hairline">
          <Row
            label="Profile"
            value={user?.email ?? 'Signed in'}
            action={
              <form action={logout}>
                <button type="submit" className={buttonClass('ghost')}>
                  Sign out
                </button>
              </form>
            }
          />
          <Row
            label="Workspace"
            value={`Lone Star Management · ${artists.length} ${artists.length === 1 ? 'artist' : 'artists'}`}
          />
          {isAdmin && <Row label="Role" value="Admin — every artist on the platform" />}
          {isAdmin && (
            <Row
              label="Applications"
              value="Review public sign-up requests"
              action={
                <Link href="/admin/applications" className={buttonClass('ghost')}>
                  Open
                </Link>
              }
            />
          )}
        </div>

        <div className="mt-5 rounded-xl border border-dashed border-hairline p-4 font-space text-xs leading-relaxed text-ink-muted">
          Data sources connect <b className="font-bold text-ink">per artist</b> — open an artist and
          use <b className="font-bold text-ink">Manager tools → Integrations</b> to connect Spotify,
          YouTube, Bandsintown, Ticketmaster, and Shopify.
        </div>
      </div>
    </RosterShell>
  )
}

function Row({ label, value, action }: { label: string; value: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-t border-hairline px-4 py-3.5 first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="truncate font-space text-xs text-ink-muted">{value}</div>
      </div>
      {action && <div className="ml-auto flex-none">{action}</div>}
    </div>
  )
}
