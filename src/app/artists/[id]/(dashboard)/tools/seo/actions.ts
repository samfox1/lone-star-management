'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { mediaUrl } from '@/lib/storage-url'
import { callerOwns } from '../../_owns'

/** Where a generated card lives, under the artist's own folder in the PUBLIC media
 *  bucket — social crawlers are anonymous, so this has to be fetchable without a session. */
const OG_FOLDER = 'og'

/**
 * Store a generated social card and point `og_image` at it.
 *
 * The card arrives as PNG bytes the browser rendered from `drawOgCard`, not as a URL:
 * the whole feature is that the transparency is FLATTENED and the aspect is fixed before
 * anything leaves us, and a URL to the raw logo would reintroduce both problems.
 *
 * A FIXED path per artist, overwritten with upsert. Cards are regenerated whenever the
 * manager changes their mind, and a uuid per save would leave every previous card in the
 * bucket forever with nothing pointing at it — `og_image` holds one URL, so the old
 * objects would be unreachable and uncollectable.
 *
 * The stored value stays a plain absolute https URL under the `og_image` site_content
 * key. A consuming site reads that key, runs it through its own URL guard, and emits it
 * as og:image / twitter:image — unchanged by any of this.
 */
export async function saveOgCardAction(
  artistId: string,
  formData: FormData,
): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient()
  // RLS scopes the writes, but a row-filtered write returns no error — so a non-owner
  // would get a silent success. Gate explicitly, like every other action here.
  if (!(await callerOwns(supabase, artistId))) return { error: 'Artist not found.' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'No image to save.' }
  // The browser renders 1200x630 PNG; anything much larger is not a card this produced.
  if (file.size > 5 * 1024 * 1024) return { error: 'That image is too large.' }

  const path = `${artistId}/${OG_FOLDER}/social-card.png`
  const { error: upErr } = await supabase.storage.from('media').upload(path, file, {
    contentType: 'image/png',
    upsert: true, // one card per artist; replacing must not orphan the last one
  })
  if (upErr) return { error: upErr.message }

  const url = mediaUrl(path)
  // Cache-bust: the path is fixed, so a crawler (and our own preview) would otherwise
  // keep serving the previous card from cache after a change nobody can see.
  const versioned = `${url}?v=${Date.now()}`

  const { error } = await supabase
    .from('site_content')
    .upsert({ artist_id: artistId, key: 'og_image', value: versioned }, { onConflict: 'artist_id,key' })
  if (error) return { error: error.message }

  revalidatePath(`/artists/${artistId}`, 'layout')
  return { url: versioned }
}
