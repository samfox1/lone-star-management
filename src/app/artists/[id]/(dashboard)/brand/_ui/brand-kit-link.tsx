import { RowIcon } from './row-icon'

/**
 * The brand-kit download, top right of every Brand tab (BRAND_PAGE_PLAN.md): a zip of
 * what is LIVE on the site. A real link, not a button — the route (`brand/kit`) checks
 * ownership itself and answers with the file, so the browser downloads without leaving.
 *
 * `labelAlign="end"`: it is the rightmost thing on the page, and its chip centred on it
 * stuck out 17px past the right edge (visual check, 2026-09-23).
 */
export function BrandKitLink({ artistId }: { artistId: string }) {
  return <RowIcon href={`/artists/${artistId}/brand/kit`} icon="download" label="Download brand kit" variant="boxed" size="sm" labelAlign="end" />
}
