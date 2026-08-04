import Link from 'next/link'
import { parsePressQuotes } from '@/lib/epk'
import { createClient } from '@/lib/supabase/server'
import { buttonClass } from '@/components/ui/ui'
import { requireArtist } from '../_data'
import { PressKitForm } from './press-kit-form'

/**
 * Press kit (EPK). Most of the page is DERIVED from published content — bio, profile
 * photo, releases, contact link — so there is nothing to edit for those. The two
 * press-only fields (a one-line pitch and review quotes) have no home anywhere else,
 * and they live here.
 *
 * Both are draft until the PROFILE publishes, exactly like the bio: they ride
 * ARTIST_SNAPSHOT, so the public /[slug]/epk page and (once it exists) the PDF always
 * read the same published revision and can never disagree.
 */
export default async function EpkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)

  // Read the press fields directly rather than widening `requireArtist`: that query is
  // cached and runs on EVERY dashboard page, and only this one needs them.
  const supabase = await createClient()
  const { data: press } = await supabase
    .from('artists')
    .select('press_pitch, press_quotes')
    .eq('id', id)
    .single()

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-[19px] font-bold tracking-[-0.01em]">Press kit (EPK)</h1>
      <p className="font-space text-sm leading-relaxed text-ink-muted">
        A shareable press one-pager built from your{' '}
        <strong className="font-bold text-ink">published</strong> bio, profile photo, releases,
        and contact links, plus the two press-only fields below. Publish your profile to make
        changes here go live.
      </p>

      <div className="flex items-center gap-3 rounded-xl border border-hairline px-4 py-3">
        <code className="flex-1 font-space text-sm text-ink-muted">/{artist.slug}/epk</code>
        <Link href={`/${artist.slug}/epk`} className={buttonClass('ghost')}>
          View EPK
        </Link>
      </div>

      <PressKitForm
        artistId={id}
        pitch={(press?.press_pitch as string | null) ?? ''}
        quotes={parsePressQuotes(press?.press_quotes)}
      />
    </div>
  )
}
