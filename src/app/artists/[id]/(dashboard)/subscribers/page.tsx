import { createClient } from '@/lib/supabase/server'
import { SectionShell } from '../section-shell'
import { requireArtist } from '../_data'

export const metadata = { title: 'Subscribers — Lone Star Management' }

/** "Jul 6, 2026" from a timestamptz string, out of render. */
function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default async function SubscribersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  await requireArtist(id) // non-owner → 404

  // RLS scopes this to the artist's managers + admins (see the subscribers migration).
  const { data } = await supabase
    .from('subscribers')
    .select('email, created_at')
    .eq('artist_id', id)
    .order('created_at', { ascending: false })
  const rows = data ?? []

  return (
    <SectionShell title="Subscribers" artistId={id}>
      <p className="font-space text-xs uppercase tracking-[0.08em] text-ink-muted">
        {rows.length} {rows.length === 1 ? 'email' : 'emails'} collected
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline px-6 py-12 text-center text-sm text-ink-muted">
          No signups yet. Emails from the site&rsquo;s community popup land here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-hairline font-space text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 text-right font-medium">Subscribed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-3">
                    <a href={`mailto:${r.email}`} className="text-ink hover:text-accent">
                      {r.email}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right text-ink-muted">{formatDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionShell>
  )
}
