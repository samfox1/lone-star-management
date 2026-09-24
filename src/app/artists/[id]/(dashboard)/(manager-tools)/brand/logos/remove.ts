import { deleteLogoAction, setBrandAssetAction } from '../actions'

/** The generated icons, each cut from one logo (or an image uploaded just for it). */
export type DerivedIcon = 'favicon' | 'home_icon'

export type BuiltInPurpose = 'logo_primary' | 'logo_secondary'

/** A logo that has a file to remove. A built-in is cleared (its slot stays, empty); an
 *  added logo IS its file (BRAND_PAGE_PLAN: a row is saved when it gets its thing), so
 *  removing the file deletes the row. */
export type RemoveTarget = { kind: 'builtin'; purpose: BuiltInPurpose } | { kind: 'added'; id: string }

const ICON_NAMES: Record<DerivedIcon, string> = { favicon: 'tab icon', home_icon: 'home-screen icon' }

/** Each generated icon: does its PNG exist, and what is it framed from (null = the primary
 *  logo, lib/brand.ts IconSettings). What the Logos page reads to know what a removal takes. */
export type IconUse = Record<DerivedIcon, { exists: boolean; sourceMediaId: string | null }>

export const NO_ICONS: IconUse = {
  favicon: { exists: false, sourceMediaId: null },
  home_icon: { exists: false, sourceMediaId: null },
}

/**
 * Which generated icons are cut from the logo `logoId` right now: the icon exists, and its
 * source is that logo — a null source MEANS the primary (lib/brand.ts, IconSettings). An
 * icon framed from another logo, or one that was never generated, is not included.
 */
export function iconsFramedFrom(icons: IconUse, logoId: string | null, primaryId: string | null): DerivedIcon[] {
  if (logoId === null) return []
  return (Object.keys(ICON_NAMES) as DerivedIcon[]).filter((icon) => {
    const { exists, sourceMediaId } = icons[icon]
    return exists && (sourceMediaId ?? primaryId) === logoId
  })
}

/** The question Remove asks. For ANY logo an icon is cut from, it names the icons that go
 *  with it — there is no undo, and "the tab icon disappeared too" must not be a surprise. */
export function removeQuestion(target: RemoveTarget, title: string, derived: readonly DerivedIcon[]): string {
  const base = target.kind === 'added' ? `Remove “${title}”?` : `Remove the ${title.toLowerCase()}?`
  if (derived.length === 0) return base
  if (derived.length > 1) return `${base} The tab and home-screen icons are made from it and go too.`
  return `${base} The ${ICON_NAMES[derived[0]]} is made from it and goes too.`
}

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
