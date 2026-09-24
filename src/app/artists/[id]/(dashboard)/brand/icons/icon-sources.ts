/**
 * Where an icon is framed from (BRAND_PAGE_PLAN.md, Tab icon tab). Pure over the page's
 * reads so the server page and the editor agree on one answer.
 *
 * `artists.<target>_source_media_id` is NULL for "the primary logo" — the old, implicit
 * behaviour — or names one of this artist's logos, or an image uploaded just for that icon
 * (`icon_source`). The FK is `on delete set null`, so a deleted source already reads as the
 * primary logo; an id that matches nothing here (a stale read) is treated the same way.
 */
import type { BrandLogos } from '@/lib/brand'

/** One entry in the editor's "Select a logo…" menu. */
export type IconLogoOption = { id: string; label: string; path: string }

/** The logos an icon can be framed from: Primary, Secondary, then the added ones by title.
 *  A built-in with no file is not listed — there is nothing to frame. */
export function iconLogoOptions(logos: BrandLogos): IconLogoOption[] {
  const out: IconLogoOption[] = []
  if (logos.primary) out.push({ id: logos.primary.id, label: 'Primary logo', path: logos.primary.storagePath })
  if (logos.secondary) out.push({ id: logos.secondary.id, label: 'Secondary logo', path: logos.secondary.storagePath })
  for (const l of logos.added) out.push({ id: l.id, label: l.label || 'Logo', path: l.storagePath })
  return out
}

/** The source an icon is drawn from: a logo, an uploaded image, or nothing to frame. */
export type IconSource = { id: string | null; path: string | null; kind: 'logo' | 'upload' | 'none' }

export function resolveIconSource(
  sourceMediaId: string | null,
  logos: BrandLogos,
  uploads: readonly { id: string; storagePath: string }[],
): IconSource {
  if (sourceMediaId) {
    const asLogo = iconLogoOptions(logos).find((o) => o.id === sourceMediaId)
    if (asLogo) return { id: asLogo.id, path: asLogo.path, kind: 'logo' }
    const asUpload = uploads.find((u) => u.id === sourceMediaId)
    if (asUpload) return { id: asUpload.id, path: asUpload.storagePath, kind: 'upload' }
  }
  const primary = logos.primary
  return primary ? { id: primary.id, path: primary.storagePath, kind: 'logo' } : { id: null, path: null, kind: 'none' }
}
