import { settingsRows } from '@/lib/settings'
import { requireArtist } from '../../_data'
import { SettingsView } from './settings-view'

export const metadata = { title: 'Settings — Lone Star Management' }

/**
 * SETTINGS · GENERAL (2026-09-13). Two rows, read-only: the site's address and the platform
 * address. The name moved to Profile and the booking email to Settings › Email (both
 * 2026-10-02; Sam: "Remove email from General"). Was a redirect to the Overview for months — a
 * tool in the rail that led nowhere. See lib/settings.ts for the rows and the view for the
 * layout (Brand's ledger since Batch 3). No width of its own: ToolsShell sets one for every tool.
 */
export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  const rows = settingsRows({
    name: artist.name as string,
    slug: artist.slug as string,
    site_kind: artist.site_kind as string | null,
    custom_site_url: artist.custom_site_url as string | null,
  })
  return <SettingsView rows={rows} />
}
