import { readProfileMarks } from '@/lib/manager-tools/profiles/marks'
import { loadSeoBase } from '../load'
import { loadBioPack } from './load'
import { ProfilesTab } from './profiles-tab'

/**
 * PROFILES: the artist's profiles on other services (Sam, 2026-09-30). The Apple Music & Amazon
 * bio email first (profiles-tab.tsx); the rest are still to come.
 *
 * Every read is RLS-scoped and runs after loadSeoBase's ownership gate. The marks are read
 * apart: if that read fails, the row says nothing rather than "not sent" (marks.ts).
 */
export default async function SeoProfilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const base = await loadSeoBase(id)
  const [{ input, photos }, marks] = await Promise.all([loadBioPack(base), readProfileMarks(base.supabase, id).catch(() => null)])
  return <ProfilesTab artistId={id} input={input} photos={photos} sentAt={marks?.allmusic_bio ?? null} marksOk={marks !== null} />
}
