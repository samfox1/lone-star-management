import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { StatusDot } from '@/components/ui/ui'
import { EmptyState, RosterShell, SectionToolbar } from '../../roster-chrome'
import { StatusSelect } from './status-select'

export const metadata = { title: 'Applications — Lone Star Management' }

type Application = {
  id: string
  name: string
  email: string
  artist_name: string | null
  link: string | null
  notes: string | null
  status: string
  created_at: string
}

export default async function ApplicationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Admin-only. RLS also returns nothing to non-admins, but 404 rather than
  // showing an empty inbox to a manager who guessed the URL.
  if (user?.app_metadata?.role !== 'admin') notFound()

  const { data, error } = await supabase
    .from('applications')
    .select('id, name, email, artist_name, link, notes, status, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as Application[]

  return (
    <RosterShell page="Applications" email={user?.email ?? null}>
      <SectionToolbar title="Applications">
        <span className="font-space text-xs text-ink-muted">{rows.length} total</span>
      </SectionToolbar>

      {rows.length === 0 ? (
        <EmptyState
          icon="roster"
          title="No applications yet"
          sub="Submissions from the public /apply form land here for review."
        />
      ) : (
        <div className="space-y-3 px-7 pb-12">
          {rows.map((a) => (
            <div key={a.id} className="rounded-xl border border-hairline p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">
                    {a.name}
                    {a.artist_name && <span className="font-normal text-ink-muted"> · {a.artist_name}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 font-space text-xs">
                    <a href={`mailto:${a.email}`} className="text-accent hover:underline">
                      {a.email}
                    </a>
                    {a.link && (
                      <>
                        <span className="text-ink-faint">·</span>
                        <a
                          href={a.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink-muted hover:underline"
                        >
                          link
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-none items-center gap-2.5">
                  <StatusDot tone={a.status === 'new' ? 'pending' : a.status === 'declined' ? 'live' : 'neutral'} />
                  <StatusSelect id={a.id} current={a.status} />
                </div>
              </div>

              {a.notes && (
                <p className="mt-3 font-space text-xs leading-relaxed text-ink-muted">{a.notes}</p>
              )}
              <div className="mt-3 font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                {a.created_at.slice(0, 10)}
              </div>
            </div>
          ))}
        </div>
      )}
    </RosterShell>
  )
}
