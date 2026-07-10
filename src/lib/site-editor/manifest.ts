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
import { TEMPLATE_FIELDS, type SiteContentField } from '@/lib/site-content-schema'

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
  /** Stable id; the DOM marker value and the inspector's handle. */
  key: string
  label: string
  type: FieldValueType
  target: FieldTarget
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

/** One site's full editable surface. `template` is the built-in template name or a
 *  custom site's declared id. */
export type TemplateManifest = {
  template: string
  fields: ManifestField[]
  slots: ManifestSlot[]
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
  },
}

/** The manifest for a template/site id, or undefined if it declares none. */
export function manifestFor(template: string): TemplateManifest | undefined {
  return MANIFESTS[template]
}

/** Look up one field by key within a manifest. */
export function fieldByKey(manifest: TemplateManifest, key: string): ManifestField | undefined {
  return manifest.fields.find((f) => f.key === key)
}

/** Look up one slot by key within a manifest. */
export function slotByKey(manifest: TemplateManifest, key: string): ManifestSlot | undefined {
  return manifest.slots.find((s) => s.key === key)
}
