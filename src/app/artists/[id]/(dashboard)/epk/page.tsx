import Link from 'next/link'
import { requireArtist } from '../_data'

/**
 * EPK is GENERATED from published content (bio, photo, releases, contact), so
 * there's nothing to edit here — just the shareable link. Keep your profile,
 * media, releases, and links published and the press kit stays current.
 */
export default async function EpkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Press kit (EPK)</h1>
      <p className="text-sm text-zinc-500">
        A shareable press one-pager, generated from your <strong>published</strong> bio, profile photo,
        releases, and contact links. Nothing to edit — keep those sections published and it stays current.
      </p>
      <div className="flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <code className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">/{artist.slug}/epk</code>
        <Link
          href={`/${artist.slug}/epk`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          View EPK
        </Link>
      </div>
    </div>
  )
}
