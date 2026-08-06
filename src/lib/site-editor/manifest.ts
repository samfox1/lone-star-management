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
import type { SiteStyleOptions } from '@/lib/site-editor/style-controls'
import type { AssetBudgets } from '@/lib/site-editor/asset-budget'

/** How an editable field's value is rendered (v1). `richtext` is a v2 seed — the
 *  type is here so the field model doesn't need a rewrite when it lands. */
export type FieldValueType = 'text' | 'email' | 'image' | 'richtext'

/** Where a field's value is read from / written to. */
export type FieldTarget =
  /** A per-key `site_content` row (the bulk of editable text). */
  | { store: 'site_content'; key: string }
  /** A column on the artist profile row. */
  | { store: 'artist'; column: 'name' | 'bio' | 'hero_image_url' }
  /** A `media` row addressed by purpose (hero video / profile photo). */
  | { store: 'media'; purpose: 'hero_video' | 'profile_photo' }

/** A single editable atom — one `data-lse-field="<key>"` region on the page. */
export type ManifestField = {
  /** What the SITE renders when this field has no stored row. Custom sites keep their
   *  fallbacks in code, so their manifest is the only way we can learn them — the Text
   *  panel would otherwise list a page full of words as "Empty". Optional: built-in
   *  templates resolve their defaults from TEMPLATE_FIELDS instead. */
  defaultValue?: string
  /** Stable id; the DOM marker value and the inspector's handle. */
  key: string
  label: string
  type: FieldValueType
  target: FieldTarget
  /**
   * The style region that dresses THIS field's element, so the Text panel can offer
   * Font / Size / Boldness beside the input instead of sending the manager to a second
   * panel to style the sentence they just typed.
   *
   * Optional, and normally unnecessary: a field whose key matches a declared style
   * region pairs automatically. Declare it only when the two differ — e.g. several
   * fields share one styled block, or the region is named for the element rather than
   * the copy. Naming a region that does not exist yields NO controls rather than a
   * broken one (see `styleRegionForField`).
   */
  styleKey?: string
}

/** The library asset types a slot can hold. Mirrors the content entities. */
export type LibraryAsset = 'track' | 'video' | 'image' | 'merch' | 'tour_date' | 'link'

/** A section that holds a reorderable list of library items — one
 *  `data-lse-slot="<key>"` region, with `data-lse-item="<asset>:<id>"` per item. */
export type ManifestSlot = {
  /** Stable id; the DOM marker value. */
  key: string
  label: string
  /** The single library type this slot accepts. */
  accepts: LibraryAsset
}

/** A re-styleable region — one `data-lse-style="<key>"` element whose CSS class
 *  string is editable. `base` is the region's default classes (what the inspector
 *  seeds the field with; a stored override REPLACES it — SITE_STYLING_PLAN.md D-B). */
export type ManifestStyleRegion = {
  key: string
  label: string
  base?: string
  /** Optional outline heading this region sits under in the inspector ("Hero"). When a
   *  site declares none, the editor infers groups from shared key prefixes — see
   *  `groupStyleRegions`. Declaring it wins, so a site can name its own outline. */
  group?: string
}

/**
 * A repeated multi-image COMPONENT the site renders a fixed number of (skeen's polaroid
 * wall: 5 cards, each holding a photo and a handwriting PNG).
 *
 * The site owns the count — it is a fact about the layout, not something the manager
 * adds to (Sam, 2026-07-21) — and owns the slot names. A media row is bound to one slot
 * by `media.site_role`, whose value is `<key>_<n>_<slot.key>` (e.g. `polaroid_3_photo`),
 * matching the field keys skeen already declares.
 */
export type ManifestComponent = {
  /** Component type id, e.g. 'polaroid'. Lowercase/underscore — it becomes a site_role. */
  key: string
  /** Singular label for one instance, e.g. 'Polaroid'. The manager may rename each. */
  label: string
  /** How many the site renders. Fixed by the site; the editor shows exactly this many. */
  count: number
  /** The image slots every instance has, in display order. */
  slots: ComponentSlot[]
}

/** One image drop target inside a component instance. */
export type ComponentSlot = {
  /** Slot id, e.g. 'photo' | 'caption'. Lowercase/underscore. */
  key: string
  label: string
  /** Shown under the slot — what belongs there. */
  hint?: string
  /**
   * The slot wants a transparent PNG (skeen's handwriting strip). Advisory ONLY: a JPG
   * still uploads, with a warning (Sam, 2026-07-21), because a wrong-format image is
   * visible and fixable while a blocked upload is a dead end mid-task.
   */
  prefersPng?: boolean
}

/** The site_role a media row carries when placed in `component` instance `n`, slot `slot`. */
export function componentSlotRole(component: string, n: number, slot: string): string {
  return `${component}_${n}_${slot}`
}

/** A link-powered element — one `data-lse-link="<key>"` <a> whose href is editable by
 *  KEY (not by guessing from its label). The editor maps a URL to it and the site binds
 *  the link to the element by this key (`links.role`). `description` explains what the
 *  link powers ("Disco-ball playlist link"), shown in the inspector. */
export type ManifestLinkRegion = {
  key: string
  label: string
  description?: string
}

/** One site's full editable surface. `template` is the built-in template name or a
 *  custom site's declared id. */
export type TemplateManifest = {
  template: string
  fields: ManifestField[]
  slots: ManifestSlot[]
  styles: ManifestStyleRegion[]
  /** Declared link-powered elements, bound to a `links` row by key (`role`). A custom
   *  site sends its own on `ready`; the built-in templates declare none yet. */
  links: ManifestLinkRegion[]
  /** Repeated multi-image components (the polaroid wall). Optional — a site that
   *  declares none simply has no component section in the editor. */
  components?: ManifestComponent[]
  /** The site's design palette (its own colour + font classes) for the no-code Style
   *  panel's dropdowns. Optional — the universal controls (size/weight/align/case) work
   *  without it; colour + font controls only appear when the site declares them. */
  styleOptions?: SiteStyleOptions
  /** Per-kind / per-slot upload budgets (BRIEF-asset-compression.md, skeen repo). The
   *  editor's upload gate reads these; absent (older manifests, every built-in
   *  template) means no gate — accept-anything, the pre-budget behaviour. */
  assetBudgets?: AssetBudgets
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
