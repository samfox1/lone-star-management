/**
 * ONE PLACE WHERE A DECLARED CATEGORY BECOMES A PANEL'S INPUT.
 *
 * WHY THIS EXISTS. Every category a site can declare — text, images, slots, styles,
 * links, components, budgets — was wired to the editor BY HAND, one at a time, and each
 * time the miss was invisible until somebody clicked:
 *
 *   2026-08-05  text was the only category not reading the bridged manifest; a custom
 *               site's own headings had no control anywhere in the editor.
 *   2026-08-09  images were the only category not reading it; clicking a declared
 *               portrait routed to a panel with nothing in it — and the write path was
 *               broken too, so even the tile that did appear could not save.
 *
 * Both were found by a person clicking, months and days apart, and the second landed in
 * a file whose opening comment claimed the first had been the last one. Wiring by hand
 * is the defect; adding one more hand-wired category would only postpone the next
 * repetition.
 *
 * HOW IT BITES. `CATEGORY_CONSUMERS` is a `Record<ManifestCategory, …>`: adding a member
 * to the union without saying which panel eats it is a COMPILE error, not a silent gap
 * (AGENTS.md rule 4 — derive from the registry, never hand-list). `resolvePanelInputs`
 * is then the only place that maps a manifest onto panel props, so there is exactly one
 * file to change when a category is added, and one test that iterates the registry to
 * prove none of them resolved empty.
 */
import type { PublicSitePayload, SiteContent } from '@/lib/site'
import type { TemplateManifest } from '@/lib/site-editor/manifest'
import type { EditorImageField, EditorTextField } from '@/app/artists/[id]/(dashboard)/editor/inspector-types'

/**
 * Every category of thing a site can DECLARE about itself. Mirrors the optional and
 * required keys of `TemplateManifest` that the editor renders from — `template` is
 * excluded because it names the manifest rather than declaring an editable surface.
 */
export const MANIFEST_CATEGORIES = [
  'fields',
  'slots',
  'styles',
  'links',
  'components',
  'styleOptions',
  'assetBudgets',
] as const

export type ManifestCategory = (typeof MANIFEST_CATEGORIES)[number]

/**
 * Which panel input each declared category feeds. The VALUE is the key on
 * `PanelInputs`, so a category that resolves to nothing cannot be added without either
 * naming a real input or being deliberately marked unused.
 *
 * `fields` feeds two: a manifest field is text or image by its `type`, and the two go to
 * different panels.
 */
export const CATEGORY_CONSUMERS: Record<ManifestCategory, readonly (keyof PanelInputs)[]> = {
  fields: ['textFields', 'imageFields'],
  slots: ['showGallery'],
  styles: ['styleRegions'],
  links: ['linkRegions'],
  components: ['components'],
  styleOptions: ['styleOptions'],
  assetBudgets: ['assetBudgets'],
}

/** Everything the inspector needs that a manifest can decide. */
export type PanelInputs = {
  textFields: EditorTextField[]
  imageFields: EditorImageField[]
  /** The orientation collages exist only if the site declares somewhere to render one. */
  showGallery: boolean
  components: NonNullable<TemplateManifest['components']>
  styleRegions: TemplateManifest['styles']
  styleOptions: TemplateManifest['styleOptions']
  assetBudgets: TemplateManifest['assetBudgets']
  linkRegions: TemplateManifest['links']
}

export type ResolveArgs = {
  /** The artist's external site origin when `site_kind='custom'`, else null. THE
   *  discriminator — never "did a manifest resolve", because a custom artist's
   *  `template` column still names a built-in one, so a local manifest always exists. */
  customSiteUrl: string | null | undefined
  /** What the frame announced. Authoritative for a custom site only. */
  manifest: TemplateManifest | null
  /** The draft the editor holds — where a declared field's current VALUE comes from. */
  draft: PublicSitePayload | null
  siteContent: SiteContent
  /** What page.tsx resolved from the LOCAL manifest, for a built-in template. */
  local: { textFields: EditorTextField[]; imageFields: EditorImageField[] }
  /** Per-category derivations that need more than a lookup (values joined from the
   *  draft). Injected so this module stays free of React and of the editor's internals. */
  derive: {
    textFields: (m: TemplateManifest | null, values: SiteContent) => EditorTextField[]
    imageFields: (m: TemplateManifest | null, draft: PublicSitePayload | null) => EditorImageField[]
  }
}

/**
 * Resolve every panel's inputs from one manifest, in one pass.
 *
 * A BUILT-IN template keeps reading page.tsx's local props for text and images, and
 * declares nothing for the rest. Built-ins DO announce a manifest since the 2026-08-07
 * consolidation — it exists so the frame's apply-field can tell text from images — and
 * it must not become a second editor-side source, which is why every category below is
 * gated on `customSiteUrl` rather than on "is there a manifest".
 */
export function resolvePanelInputs(args: ResolveArgs): PanelInputs {
  const { customSiteUrl, manifest, draft, siteContent, local, derive } = args
  const announced = customSiteUrl ? manifest : null
  return {
    textFields: customSiteUrl ? derive.textFields(manifest, siteContent) : local.textFields,
    imageFields: customSiteUrl ? derive.imageFields(manifest, draft) : local.imageFields,
    // Gated like every sibling. It read the UNGATED manifest until this refactor, so a
    // built-in that announced an image slot would have shown a gallery its template does
    // not render — the same class of bug, arriving from the other direction.
    showGallery: (announced?.slots ?? []).some((sl) => sl.accepts === 'image'),
    components: announced?.components ?? [],
    styleRegions: announced?.styles ?? [],
    styleOptions: announced?.styleOptions,
    assetBudgets: announced?.assetBudgets,
    linkRegions: announced?.links ?? [],
  }
}

/** Whether a resolved input carries anything — the shape-agnostic "did this category
 *  reach a panel" check the coverage test asserts with. */
export function inputIsPopulated(value: PanelInputs[keyof PanelInputs]): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.length > 0
  return Object.keys(value).length > 0
}
