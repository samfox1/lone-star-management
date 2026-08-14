/**
 * The EDITABLE-REGIONS RULEBOOK (SITE_EDITOR_PLAN.md, phase 0).
 *
 * The visual editor is a CONTENT UPDATER, not a website builder: the only editable
 * things are a fixed set — declared text, images, and library slots (tracks /
 * videos / photos / merch / tour). Each site (a built-in template OR a custom
 * site) declares its editable regions here via a MANIFEST; the one editor reads
 * the manifest + the matching DOM markers (see ./markers) and never has to know a
 * site's layout. A custom site becomes editable the moment it ships a manifest +
 * marks its regions + includes the bridge (./bridge).
 *
 * This grows out of `site-content-schema.ts` (TEMPLATE_FIELDS): those per-template
 * text fields become manifest FIELDS with a `site_content` target; the manifest
 * adds image/profile fields and the library SLOTS on top. No React here, so server
 * actions and tests can import it.
 */
import { TEMPLATE_FIELDS, fieldValue, type SiteContentField } from '@/lib/site-content-schema'
import type { SiteContent } from '@/lib/site'

// The manifest SCHEMA moved to @samfox1/site-bridge (SITE_BRIDGE_PLAN.md phase 1):
// a connected site imports the same shape it announces instead of mirroring it. This
// module keeps what is LONE-STAR's — the built-in template MANIFESTS and the role/key
// helpers — and re-exports the schema from its historical home.
export type {
  FieldValueType,
  FieldTarget,
  ManifestField,
  LibraryAsset,
  ManifestSlot,
  ManifestStyleRegion,
  ManifestLinkRegion,
  ManifestComponent,
  ManifestVideoSlot,
  ComponentSlot,
  TemplateManifest,
} from '@samfox1/site-bridge/manifest'
import type { ManifestField, ManifestStyleRegion, TemplateManifest } from '@samfox1/site-bridge/manifest'
import { PACKAGE_VERSION } from '@samfox1/site-bridge/manifest'
export { PACKAGE_VERSION } from '@samfox1/site-bridge/manifest'

/**
 * Is the connected site OLDER than the editor's bridge? A site stamps the version it was
 * built against into its manifest (`bridgeVersion`); when it lags, a newly added control
 * can emit a token the site's bundled applier can't lift yet — so the editor flags
 * "republish to apply" rather than letting the manager drag a slider that does nothing.
 *
 * Dotted numeric compare; a missing or malformed version reads as NOT outdated (never a
 * false alarm — an older site that predates the field simply isn't flagged).
 */
export function bridgeOutdated(siteVersion: string | undefined, editorVersion = PACKAGE_VERSION): boolean {
  // Only a well-formed dotted-numeric version can be behind; anything else (absent, empty,
  // garbage) is NOT flagged — a false alarm is worse than a missed one here.
  if (!siteVersion || !/^\d+(\.\d+)*$/.test(siteVersion)) return false
  const a = siteVersion.split('.').map((n) => Number(n) || 0)
  const b = editorVersion.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d < 0
  }
  return false
}

/** The site_role a media row carries when placed in `component` instance `n`, slot `slot`. */
export function componentSlotRole(component: string, n: number, slot: string): string {
  return `${component}_${n}_${slot}`
}


/** Lift the per-template site-text schema into manifest fields (site_content targets). */
function fromSiteText(fields: SiteContentField[]): ManifestField[] {
  return fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    target: { store: 'site_content', key: f.key },
  }))
}

/** Profile fields common to every template (name / bio / hero image). */
const PROFILE_FIELDS: ManifestField[] = [
  { key: 'artist_name', label: 'Artist name', type: 'text', target: { store: 'artist', column: 'name' } },
  { key: 'artist_bio', label: 'Bio', type: 'text', target: { store: 'artist', column: 'bio' } },
  { key: 'hero_image', label: 'Hero image', type: 'image', target: { store: 'artist', column: 'hero_image_url' } },
]

/**
 * Per-template manifests. The classic template is specified in full (phase 0
 * target); the cinematic entries are a first cut derived from its site-text schema
 * and known sections — the exact slot/field set is confirmed when its DOM is
 * instrumented (phase 5). Custom sites register their own manifest at runtime.
 */
export const MANIFESTS: Record<string, TemplateManifest> = {
  classic: {
    template: 'classic',
    fields: [...PROFILE_FIELDS, ...fromSiteText(TEMPLATE_FIELDS.classic)],
    slots: [
      { key: 'tracks', label: 'Tracks', accepts: 'track' },
      { key: 'videos', label: 'Videos', accepts: 'video' },
      { key: 'tour_dates', label: 'Tour dates', accepts: 'tour_date' },
      { key: 'merch', label: 'Merch', accepts: 'merch' },
      { key: 'links', label: 'Links', accepts: 'link' },
    ],
    // Built-in template DOM isn't style-tagged yet; custom sites declare their own.
    styles: [],
    // Built-in templates declare no link-powered elements yet (custom sites do).
    links: [],
  },
  cinematic: {
    template: 'cinematic',
    fields: [
      ...PROFILE_FIELDS,
      { key: 'hero_video', label: 'Hero video', type: 'image', target: { store: 'media', purpose: 'hero_video' } },
      { key: 'profile_photo', label: 'Profile photo', type: 'image', target: { store: 'media', purpose: 'profile_photo' } },
      ...fromSiteText(TEMPLATE_FIELDS.cinematic),
    ],
    slots: [
      { key: 'shows', label: 'Shows', accepts: 'tour_date' },
      { key: 'work', label: 'Work', accepts: 'track' },
      { key: 'videos', label: 'Videos', accepts: 'video' },
    ],
    styles: [],
    links: [],
  },
}

/** The manifest for a template/site id, or undefined if it declares none. */
export function manifestFor(template: string): TemplateManifest | undefined {
  return MANIFESTS[template]
}

/**
 * The style region that dresses a text field's element, or null if it has none.
 *
 * Lets the Text panel show Font/Size/Boldness beside the input, instead of making a
 * manager type a sentence in one panel and then find the right region in another.
 *
 * An explicit `styleKey` wins; otherwise a region whose key MATCHES the field's pairs
 * automatically, which is the ordinary case because sites name both after the thing on
 * screen. Both paths verify the region actually EXISTS: offering controls that write to
 * a key nothing renders is worse than offering none, because the manager changes the
 * font, sees nothing happen, and gets no error to explain it.
 */
export function styleRegionForField(
  field: ManifestField,
  regions: ManifestStyleRegion[] | undefined,
): ManifestStyleRegion | null {
  const key = field.styleKey ?? field.key
  return (regions ?? []).find((r) => r.key === key) ?? null
}

/** Look up one field by key within a manifest. */
export function fieldByKey(manifest: TemplateManifest, key: string): ManifestField | undefined {
  return manifest.fields.find((f) => f.key === key)
}

/** The draft artist state a field value may read from. */
export type FieldValueContext = {
  template: string
  siteContent: SiteContent
  artist: { name: string; bio: string | null; hero_image_url: string | null }
}

/** A field's current draft value, for populating the inspector control. Media
 *  fields (image/video) resolve elsewhere (the media store) — '' here. */
export function fieldCurrentValue(field: ManifestField, ctx: FieldValueContext): string {
  if (field.target.store === 'site_content') return fieldValue(ctx.siteContent, ctx.template, field.target.key)
  if (field.target.store === 'artist') return ctx.artist[field.target.column] ?? ''
  return ''
}


/**
 * Group style regions into the inspector's outline. A site can declare `group` per
 * region and that always wins. Otherwise groups are INFERRED from the key prefix
 * before the first `_`, but only where two or more regions share it — so skeen's
 * four `hero_*` regions become "Hero" while the one-off `*_section` keys don't each
 * become their own heading. Leftovers collect under `fallback`.
 *
 * Returns `[heading, regions][]` in first-appearance order, preserving manifest order
 * within each group. When nothing groups (every region is a singleton and none declare
 * one), returns a single entry with an EMPTY heading — the panel then renders a plain
 * list rather than inventing structure that isn't there.
 */
export function groupByPrefix<T extends { key: string; group?: string }>(
  regions: T[],
  fallback = 'Sections',
): [string, T[]][] {
  const prefixCount = new Map<string, number>()
  for (const r of regions) {
    if (r.group) continue
    const p = r.key.split('_')[0]
    if (!p) continue // a leading `_` yields an empty prefix — never a heading
    prefixCount.set(p, (prefixCount.get(p) ?? 0) + 1)
  }

  const declared = regions.some((r) => r.group)
  const inferred = [...prefixCount.values()].some((n) => n >= 2)
  // Nothing to group by: one unlabelled run, in manifest order.
  if (!declared && !inferred) return regions.length ? [['', regions]] : []

  const out = new Map<string, T[]>()
  for (const r of regions) {
    const prefix = r.key.split('_')[0]
    const heading =
      r.group ??
      (prefix && (prefixCount.get(prefix) ?? 0) >= 2 ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : fallback)
    const bucket = out.get(heading)
    if (bucket) bucket.push(r)
    else out.set(heading, [r])
  }
  return [...out.entries()]
}

/** The style panel's grouping, by its original name. Same function — the Text panel now
 *  groups the same way, so the two panels can never disagree about a site's outline. */
export const groupStyleRegions = groupByPrefix

/**
 * A child row's label under a group HEADING, with the heading word removed — so a
 * "Hero" section reads "Name" / "Tagline", not "Hero name" / "Hero tagline", and a
 * "Footer" group over a "Footer" region shows the heading once, not twice (Sam,
 * 2026-08-12: "I have a lot of double headers"). Strips only a whole leading word
 * (case-insensitive); returns '' when the label IS the heading, which the panels read
 * as "the heading already names this row".
 */
export function sectionRowLabel(heading: string, label: string): string {
  if (!heading) return label
  const h = heading.toLowerCase()
  const l = label.toLowerCase()
  if (l === h) return ''
  if (l.startsWith(h + ' ')) {
    const rest = label.slice(heading.length).trimStart()
    return rest.charAt(0).toUpperCase() + rest.slice(1)
  }
  return label
}

/**
 * What the Style panel SHOWS. Two modes, never mixed (Sam, 2026-08-12 — one edit
 * path per thing): a click in the preview FOCUSES that one region's controls; browsing
 * the tab lists only site-wide regions (`scope: 'site'`), the styles that belong to no
 * clickable element. A selection naming no region (a stale key from an older manifest)
 * falls back to browsing rather than an empty panel.
 */
export function visibleStyleRegions(
  regions: ManifestStyleRegion[],
  selected: string | null,
): ManifestStyleRegion[] {
  const focused = selected ? regions.filter((r) => r.key === selected) : []
  // Site-wide surfaces (page/bars) AND icon groups (the socials row) list in the browse
  // view — they belong to no single clickable element, so the Style tab is where they live.
  return focused.length
    ? focused
    : regions.filter((r) => r.scope === 'site' || r.scope === 'chrome' || r.scope === 'icons')
}
