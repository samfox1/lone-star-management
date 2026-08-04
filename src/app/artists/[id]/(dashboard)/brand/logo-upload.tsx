'use client'

import { BRAND_FOLDER } from '@/lib/brand'
import { acceptFor, IMAGE_UPLOAD_RULES } from '@/lib/upload'
import { buttonClass } from '@/components/ui/ui'
import { FileDropField } from '../file-drop-field'
import { toast } from '../toast'
import { useStorageUpload } from '../use-storage-upload'
import { setBrandAssetAction } from './actions'

/**
 * One logo slot. Single occupancy is enforced server-side (`setBrandAsset` vacates the
 * purpose before inserting), so uploading again simply replaces — there is no "delete
 * first" step for the manager to get wrong.
 *
 * PNG is the format to reach for, and the hint says so. SVG is the obvious choice for a
 * logo and is deliberately NOT accepted: the `media` bucket is public, and an SVG can
 * carry script, so serving one from the Supabase origin would be a stored-XSS hole.
 */
export function LogoUpload({
  artistId,
  purpose,
  label,
  hint,
  currentUrl,
}: {
  artistId: string
  purpose: 'logo_primary' | 'logo_secondary'
  label: string
  hint: string
  currentUrl: string | null
}) {
  const { busy, error, upload } = useStorageUpload({
    bucket: 'media',
    artistId,
    category: BRAND_FOLDER,
    noun: 'logo',
    rules: IMAGE_UPLOAD_RULES,
    successMessage: `${label} uploaded`,
    writeRow: async (path) => (await setBrandAssetAction(artistId, purpose, path)).error ?? null,
  })

  async function clear() {
    // The error was previously discarded, so a Remove blocked by RLS or a dropped
    // connection looked exactly like a successful one — no toast, no error, and the
    // thumbnail silently reappearing on the next revalidate with nothing to explain it.
    const res = await setBrandAssetAction(artistId, purpose, null)
    if (res.error) {
      toast(res.error, 'error')
      return
    }
    // The favicon is DERIVED from the primary logo, so removing the logo has to remove
    // it too. Otherwise the site keeps serving a tab icon generated from a logo the
    // artist no longer has, while this page says there is no icon to configure — the
    // UI and the live site disagree, and nothing in the UI can clear it.
    if (purpose === 'logo_primary') {
      const icon = await setBrandAssetAction(artistId, 'favicon', null)
      if (icon.error) {
        toast(icon.error, 'error')
        return
      }
    }
    toast(`${label} removed`)
  }

  return (
    <div className="space-y-2">
      {currentUrl && (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentUrl}
            alt={label}
            // A logo is usually transparent, so it needs a background it can be seen
            // against — a checkerboard says "this is transparent" rather than implying
            // the logo has a white box baked in.
            className="h-16 w-32 rounded-lg border border-hairline bg-[repeating-conic-gradient(#00000010_0_25%,transparent_0_50%)] bg-[length:12px_12px] object-contain p-1"
          />
          <button type="button" onClick={clear} className={buttonClass('ghost')}>
            Remove
          </button>
        </div>
      )}
      {/* The explicit allowlist, never image/* — the wildcard admits SVG in the picker
          even though validateUpload refuses it, and the picker must not advertise what
          the validator rejects. */}
      <FileDropField
        accept={acceptFor(IMAGE_UPLOAD_RULES)}
        label={currentUrl ? `Replace ${label.toLowerCase()}` : label}
        hint={hint}
        busy={busy}
        error={error}
        onFile={upload}
      />
    </div>
  )
}
