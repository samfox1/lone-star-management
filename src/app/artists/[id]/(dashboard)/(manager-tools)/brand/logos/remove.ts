import type { DerivedIcon, RemoveTarget } from '@/lib/manager-tools/brand/logo-remove'
import { deleteLogoAction, setBrandAssetAction } from '../actions'

/**
 * Remove a logo's file, and every icon generated from it (`derived`, from
 * `iconsFramedFrom`: the tab and home-screen icons whose source is this logo — a null
 * source means the primary). LogoRow's rule (2026-09-13) was the primary's only; since the
 * Brand rebuild an icon can be cut from ANY logo, and an icon cut from a logo that is gone
 * would still be served. An icon framed from another logo is left alone.
 *
 * The icon's SOURCE needs no write here: removing the logo deletes its media row, and the
 * source FK is `on delete set null` (20260924120000), so the icon falls back to the primary
 * logo by itself (pinned in tests/integration/manager-tools/brand). A failed removal stops there and does
 * not go on to the icons.
 */
export async function removeLogo(
  artistId: string,
  target: RemoveTarget,
  derived: readonly DerivedIcon[],
): Promise<{ error?: string }> {
  const res =
    target.kind === 'added' ? await deleteLogoAction(artistId, target.id) : await setBrandAssetAction(artistId, target.purpose, null)
  if (res.error) return res
  for (const icon of derived) {
    const cleared = await setBrandAssetAction(artistId, icon, null)
    if (cleared.error) return cleared
  }
  return {}
}
