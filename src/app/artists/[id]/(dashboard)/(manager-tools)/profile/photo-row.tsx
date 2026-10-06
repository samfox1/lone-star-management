import { createClient } from '@/lib/supabase/server'
import { PROFILE_PHOTO } from '@/lib/profile-photo'
import { mediaThumbUrl } from '@/lib/storage-url'
import { cx } from '@/lib/cx'
import { END_SLOT, LedgerRow } from '../_ui/ledger'
import { ProfilePhotoControl, type LibraryPhoto } from './photo-picker'

/**
 * The Profile page's photo row (PROFILE_TOOL_PLAN.md): the round tile and its Images picker
 * (photo-picker.tsx). A server component, so the page renders it as a slot and it reads its own
 * rows: the profile photo now, and the artist's Images exactly as the Images page lists them
 * (purpose gallery_image, newest first). Both reads start alongside the page's own owner check
 * (for speed, 2026-10-05), so they do not wait for it: they are RLS-scoped to the caller's
 * artists, so a non-owner reads nothing, and the page still 404s them.
 *
 * Two profile rows can exist from before the slot held one; the site shows the first by sort
 * order, so this does too.
 */
export async function PhotoRow({ artistId }: { artistId: string }) {
  const supabase = await createClient()
  const [now, library] = await Promise.all([
    supabase.from('media').select('storage_path').eq('artist_id', artistId).eq('purpose', PROFILE_PHOTO).order('sort_order').limit(1),
    supabase.from('media').select('id, storage_path').eq('artist_id', artistId).eq('purpose', 'gallery_image').order('created_at', { ascending: false }),
  ])
  const path = ((now.data ?? [])[0] as { storage_path?: string } | undefined)?.storage_path ?? null
  const photos: LibraryPhoto[] = ((library.data ?? []) as { id: string; storage_path: string }[]).map((m) => ({
    id: m.id,
    path: m.storage_path,
    thumb: mediaThumbUrl(m.storage_path, { size: 400 }),
  }))
  return (
    <LedgerRow title="Profile photo" guide="Site, press kit and outside profiles.">
      <ProfilePhotoControl artistId={artistId} current={path ? { path, thumb: mediaThumbUrl(path, { size: 160 }) } : null} photos={photos} />
      {/* The end column every Profile row keeps, so the tile lines up with the controls below. */}
      <span aria-hidden="true" className={cx(END_SLOT, 'flex')} />
    </LedgerRow>
  )
}
