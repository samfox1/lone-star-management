import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { ContentSection } from '../content-sections'
import { SectionShell } from '../section-shell'

export default async function LinksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const rows = await listContent(supabase, 'link', id)

  return (
    <SectionShell title="Links" publishType="link" artistId={id}>
      <ContentSection type="link" artistId={id} rows={rows} />
    </SectionShell>
  )
}
