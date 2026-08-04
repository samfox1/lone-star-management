import { fileSize, toPlayable, type AttachmentRow, type PlayableAttachment } from '@/lib/enquiry-attachments'
import { createClient } from '@/lib/supabase/server'
import { safeHref } from '@/lib/url'
import { Icon } from '@/components/ui/icons'
import { SectionShell } from '../section-shell'
import { requireArtist } from '../_data'
import { markEnquiryReadAction } from '../actions'
import { ActionButton } from '../action-button'

export const metadata = { title: 'Enquiries — Lone Star Management' }

/** "Jul 6, 2026 · 2:14 PM" — enquiries need the time; subscribers don't. */
function formatWhen(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(
    'en-US',
    { hour: 'numeric', minute: '2-digit' },
  )}`
}

const PURPOSE_LABEL: Record<string, string> = {
  booking: 'Booking',
  demo: 'Demo',
  other: 'Contact',
}

/** Where the manager can change the address that resolved, in plain language. */
const SOURCE_LABEL: Record<string, string> = {
  mail_settings: 'set by Lone Star admin',
  link: 'from your booking link',
  site_content: 'from your site text',
  default: 'the Lone Star fallback — set a booking address to route these yourself',
}

type Enquiry = {
  id: string
  purpose: string
  name: string
  email: string
  message: string
  to_email: string
  recipient_source: string
  status: string
  send_error: string | null
  sent_at: string | null
  read_at: string | null
  created_at: string
  demo_url: string | null
}

export default async function EnquiriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  await requireArtist(id) // non-owner → 404

  // RLS scopes this to the artist's managers + admins (see 20260722120000). No view:
  // the cross-artist rollup views exist for /book, and there is no cross-artist
  // enquiries surface yet.
  const { data } = await supabase
    .from('enquiries')
    .select(
      'id, purpose, name, email, message, to_email, recipient_source, status, send_error, sent_at, read_at, created_at, demo_url',
    )
    .eq('artist_id', id)
    .order('created_at', { ascending: false })
  const rows = (data ?? []) as Enquiry[]
  const unread = rows.filter((r) => !r.read_at).length

  // Attachments for every enquiry on the page in ONE read (RLS-scoped), then signed in
  // parallel. Signing is per-object and cannot be batched, but the rows can — and a demo
  // enquiry rarely has more than one file.
  const { data: attachmentRows } = await supabase
    .from('enquiry_attachments')
    .select('id, enquiry_id, storage_path, filename, mime_type, bytes, created_at')
    .in('enquiry_id', rows.length ? rows.map((r) => r.id) : ['00000000-0000-0000-0000-000000000000'])
  const playable = await toPlayable(supabase, (attachmentRows ?? []) as AttachmentRow[])
  const byEnquiry = new Map<string, PlayableAttachment[]>()
  for (const [i, a] of playable.entries()) {
    const key = ((attachmentRows ?? [])[i] as AttachmentRow).enquiry_id
    byEnquiry.set(key, [...(byEnquiry.get(key) ?? []), a])
  }

  // The live resolved recipient, which may differ from any single row's frozen
  // to_email if the address has since changed. SECURITY DEFINER with an internal owner
  // guard — the only path by which a resolved address reaches a client.
  const { data: preview } = await supabase.rpc('booking_recipient_preview', { p_artist_id: id })
  const current = (preview ?? [])[0] as { to_email: string; recipient_source: string } | undefined

  return (
    <SectionShell title="Enquiries" artistId={id}>
      <div className="space-y-1">
        <p className="font-space text-xs uppercase tracking-[0.08em] text-ink-muted">
          {rows.length} {rows.length === 1 ? 'enquiry' : 'enquiries'}
          {unread > 0 && ` · ${unread} unread`}
        </p>
        {current ? (
          <p className="text-sm text-ink-muted">
            New enquiries go to{' '}
            <span className="font-medium text-ink">{current.to_email}</span>{' '}
            <span className="text-ink-faint">
              ({SOURCE_LABEL[current.recipient_source] ?? current.recipient_source})
            </span>
            . Changes take effect immediately — no publish needed.
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-ink-muted">
            <Icon name="alert" size={15} />
            No booking address is set, so enquiries cannot be delivered. Add one in Site text
            or as a booking link.
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline px-6 py-12 text-center text-sm text-ink-muted">
          No enquiries yet. Messages from the site&rsquo;s contact form land here.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-hairline p-5 transition-colors hover:border-ink-faint"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-space text-[11px] uppercase tracking-[0.08em] text-ink-muted">
                  {PURPOSE_LABEL[r.purpose] ?? r.purpose}
                </span>
                <span className={r.read_at ? 'font-medium' : 'font-bold'}>{r.name}</span>
                <a
                  href={`mailto:${r.email}?subject=${encodeURIComponent(`Re: your enquiry`)}`}
                  className="text-sm text-ink-muted hover:text-accent"
                >
                  {r.email}
                </a>
                <span className="ml-auto font-space text-[11px] text-ink-faint">
                  {formatWhen(r.created_at)}
                </span>
              </div>

              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{r.message}</p>

              {/* Visitor-supplied and https-only (validated at the door AND by a CHECK),
                  but still through safeHref at render — the rule in lib/url.ts is that
                  render-time sanitisation is the must-have guard, because a row can
                  predate a validator. noopener/noreferrer because the manager clicks it. */}
              {r.demo_url && safeHref(r.demo_url) && (
                <p className="mt-3 font-space text-sm">
                  <span className="text-ink-faint">Demo: </span>
                  <a
                    href={safeHref(r.demo_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline underline-offset-2"
                  >
                    {r.demo_url}
                  </a>
                </p>
              )}

              {(byEnquiry.get(r.id) ?? []).length > 0 && (
                <ul className="mt-3 space-y-2">
                  {(byEnquiry.get(r.id) ?? []).map((a) => (
                    <li key={a.id} className="rounded-lg border border-hairline px-3 py-2">
                      <div className="flex items-baseline gap-2">
                        <span className="font-space text-xs font-medium">{a.filename}</span>
                        {fileSize(a.bytes) && (
                          <span className="font-space text-[11px] text-ink-faint">{fileSize(a.bytes)}</span>
                        )}
                      </div>
                      {a.expired ? (
                        // The normal end state, not an error: files go after 90 days and
                        // the message is kept. Saying so beats a dead player.
                        <p className="mt-1 font-space text-[11px] text-ink-faint">
                          Attachment expired — audio is deleted after 90 days.
                        </p>
                      ) : (
                        <>
                          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                          <audio controls preload="none" src={a.url ?? undefined} className="mt-1.5 w-full" />
                          <a
                            href={a.url ?? undefined}
                            download={a.filename}
                            className="mt-1 inline-block font-space text-[11px] text-ink-muted underline underline-offset-2"
                          >
                            Download
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-space text-[11px] text-ink-faint">
                {/* Delivery is reported honestly. An enquiry that failed to send is
                    still HERE, which is the reason this table exists — the manager can
                    act on it even when the email never arrived. */}
                {r.status === 'sent' && (
                  <span className="flex items-center gap-1">
                    <Icon name="check" size={13} /> Emailed to {r.to_email}
                  </span>
                )}
                {r.status === 'queued' && <span>Not emailed yet</span>}
                {r.status === 'failed' && (
                  <span className="flex items-center gap-1 text-ink-muted">
                    <Icon name="alert" size={13} /> Email to {r.to_email} failed
                    {r.send_error ? ` — ${r.send_error}` : ''}. Reply directly instead.
                  </span>
                )}
                {!r.read_at && (
                  <ActionButton
                    action={markEnquiryReadAction.bind(null, id, r.id)}
                    savedMessage="Marked as read"
                    busyLabel="Marking…"
                    className="ml-auto underline underline-offset-2 hover:text-ink"
                  >
                    Mark read
                  </ActionButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  )
}
