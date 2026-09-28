/**
 * WHICH MEDIA ROWS ARE THE BRAND PAGE'S — and so which are not.
 *
 * Two Publish buttons split the `media` table between them, and each must send exactly its
 * half: the Brand bar sends the brand purposes (`BRAND_MEDIA_SLICE`), the Site / SEO bar
 * sends everything else (`SITE_MEDIA_SLICE`). Until 2026-09-28 the Site publish sent the
 * whole table, so pressing it shipped the Brand page's draft logos and icons.
 *
 * Its own file, with no imports, so `content.ts` can read it: `brand.ts` imports
 * `content.ts` and reads PUBLISHABLE while it loads, so `content.ts` importing `brand.ts`
 * back would be a cycle that breaks on whichever module loads first. `brand.ts` re-exports
 * everything here, so callers keep importing from `@/lib/brand`.
 *
 * Both slices judge the SNAPSHOT, so a deleted row is judged by its last published copy:
 * a deleted logo is Brand's to tombstone, a deleted photo the site's.
 */

/** EVERY media purpose the Brand page owns (20260924120000). The brand-scoped Publish bar
 *  and the brand revert both derive from this list, so a purpose added here is counted and
 *  reverted in the same edit — and a gallery photo never is. */
export const BRAND_MEDIA_PURPOSES = ['logo_primary', 'logo_secondary', 'logo', 'favicon', 'home_icon', 'icon_source'] as const
export type BrandMediaPurpose = (typeof BRAND_MEDIA_PURPOSES)[number]
export const isBrandMediaPurpose = (p: unknown): p is BrandMediaPurpose => (BRAND_MEDIA_PURPOSES as readonly unknown[]).includes(p)

/** The media the Brand page publishes: its own purposes. The SAME predicate the bar
 *  (`brandPending`) and Revert use — what the bar counts is what Publish sends. */
export const BRAND_MEDIA_SLICE = { keep: (snap: Record<string, unknown>) => isBrandMediaPurpose(snap.purpose) }

/** The media the Site / SEO Publish sends, and its bar counts: every row that is not the
 *  Brand page's. The exact complement of BRAND_MEDIA_SLICE, so no row is left to neither. */
export const SITE_MEDIA_SLICE = { keep: (snap: Record<string, unknown>) => !isBrandMediaPurpose(snap.purpose) }
