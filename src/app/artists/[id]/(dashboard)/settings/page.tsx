import { settingsRows, type Recipient } from '@/lib/settings'
import { createClient } from '@/lib/supabase/server'
import { requireArtist } from '../_data'
import { SettingsView } from './settings-view'

export const metadata = { title: 'Settings — Lone Star Management' }

/**
 * SETTINGS (2026-09-13). Four rows, instant: the booking email, the site's address, the
 * name, the platform address. Was a redirect to the Overview for months — a tool in the
 * rail that led nowhere. See lib/settings.ts for the rows and the view for the layout.
 */
export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const [artist, mail, preview] = await Promise.all([
    requireArtist(id),
    // Managers may READ their mail settings (ams_read); the write goes through its door.
    supabase.from('artist_mail_settings').select('booking_email').eq('artist_id', id).maybeSingle(),
    supabase.rpc('booking_recipient_preview', { p_artist_id: id }),
  ])
  const bookingEmail = ((mail.data?.booking_email as string | null) ?? '').trim()
  const recipient = ((preview.data ?? [])[0] as Recipient) ?? null
  const rows = settingsRows(
    { name: artist.name as string, slug: artist.slug as string, site_kind: artist.site_kind as string | null, custom_site_url: artist.custom_site_url as string | null },
    bookingEmail,
    recipient,
  )
  return <SettingsView artistId={id} rows={rows} />
}
