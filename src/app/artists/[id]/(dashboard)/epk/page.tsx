import Link from 'next/link'
import { buttonClass } from '@/components/ui/ui'
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
      <h1 className="text-[19px] font-bold tracking-[-0.01em]">Press kit (EPK)</h1>
      <p className="font-space text-sm leading-relaxed text-ink-muted">
        A shareable press one-pager, generated from your{' '}
        <strong className="font-bold text-ink">published</strong> bio, profile photo, releases, and
        contact links. Nothing to edit — keep those sections published and it stays current.
      </p>
      <div className="flex items-center gap-3 rounded-xl border border-hairline px-4 py-3">
        <code className="flex-1 font-space text-sm text-ink-muted">/{artist.slug}/epk</code>
        <Link href={`/${artist.slug}/epk`} className={buttonClass('ghost')}>
          View EPK
        </Link>
      </div>
    </div>
  )
}
