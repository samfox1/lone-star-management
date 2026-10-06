import { Suspense } from 'react'
import { BIO_MIN_WORDS } from '@/lib/seo-tests/who'
import { SitePendingBar } from '../_ui/site-pending'
import { loadProfile } from './load'
import { PhotoRow } from './photo-row'
import { ProfileView } from './profile-view'

export const metadata = { title: 'Profile — Lone Star Management' }

/**
 * PROFILE (Sam, 2026-10-02, PROFILE_TOOL_PLAN.md): who the artist is, on one page in Brand's
 * ledger, with the rising Publish bar and no tabs. It took the SEO / GEO Facts tab (whose old
 * address, /tools/seo/facts, redirects here) and the name from Settings › General.
 *
 * The id `bio` is where a test's pencil lands and where the old /tools/seo/about route redirects:
 * bio-row.tsx keeps it on the Bio row, and landing on it opens the bio window.
 *
 * The bar is the SEO / GEO tabs' own (_ui/site-pending.tsx): Publish ships the profile, the
 * site's words and the site's photos, which is everything this page writes.
 *
 * SPEED (Sam's call, 2026-10-05: start the independent reads in parallel, and do not change
 * what the page shows).
 * The photo row's two reads need nothing from loadProfile, so they start beside it rather than
 * after it: PhotoRow is called here, which runs its reads now, instead of being left in the tree
 * to start them only once the rest had loaded. They are RLS-scoped like loadProfile's own, and
 * its gate (requireArtist) still 404s a non-owner before anything renders. Nothing streams in
 * later, so the page paints whole, as before. What it still waits on is the outside-bios nudge
 * (load.ts), two reads in a row after the gate.
 */
export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [p, photo] = await Promise.all([loadProfile(id), PhotoRow({ artistId: id })])
  return (
    <>
      <ProfileView
        artistId={id}
        artistName={p.artist.name as string}
        schemaType={p.schemaType}
        genre={p.genre}
        city={p.city}
        facts={p.facts}
        bio={p.bio}
        bioMinWords={BIO_MIN_WORDS}
        bioNudge={p.bioNudge}
        photo={photo}
      />
      {/* Its own boundary, so the pending check never holds up the page above it. */}
      <Suspense fallback={null}>
        <SitePendingBar artistId={id} />
      </Suspense>
    </>
  )
}
