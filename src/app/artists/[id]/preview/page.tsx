import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArtistTemplate } from '@/components/artist-template'
import { createClient } from '@/lib/supabase/server'
import { getWorkingSite } from '@/lib/site'

// Manager-only preview: the real public template rendered against WORKING rows,
// so unpublished edits are visible before publishing. Protected by the proxy
// (under /artists) and RLS-scoped — getWorkingSite returns null for a tenant
// the caller can't access, which 404s.
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const site = await getWorkingSite(supabase, id)
  if (!site) notFound()

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
        <span>
          <strong>Preview</strong> — working draft, including unpublished edits.
        </span>
        <Link href={`/artists/${id}`} className="font-medium underline">
          ← Back to editing
        </Link>
      </div>
      <ArtistTemplate data={site} />
    </div>
  )
}
