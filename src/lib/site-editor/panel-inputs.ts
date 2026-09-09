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
import type { ManifestPage, TemplateManifest } from '@/lib/site-editor/manifest'
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
  'videoSlots',
  'styleOptions',
  'assetBudgets',
  'itemStyling',
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
  slots: ['imageCollections'],
  itemStyling: ['itemStyling'],
  styles: ['styleRegions'],
  links: ['linkRegions'],
  components: ['components'],
  videoSlots: ['videoSlots'],
  styleOptions: ['styleOptions'],
  assetBudgets: ['assetBudgets'],
}

/**
 * Does this category belong to a PAGE, or to the SITE? (SITE_PAGES_PLAN.md D5.)
 *
 * P1 taught the editor to merge one announce per page into a single manifest, which is
 * right as a store and wrong as a panel: standing on About, the Style panel listed every
 * one of Home's forty regions and clicking one highlighted nothing, because the element
 * is not in the frame.
 *
 * A `Record<ManifestCategory, boolean>` for the same reason `CATEGORY_CONSUMERS` is one:
 * a category added to the union without DECIDING is a compile error, not a category that
 * quietly stops filtering. The three `false`s are facts about the site rather than the
 * page — filtering the font list per page would empty the picker the moment a manager
 * stepped off Home, which reads as the editor breaking.
 *
 * NOTE — D5 as written exempted `styles` too, on the reading that style regions are
 * site-wide bands. skeen's registry disagrees, and shipped first: its About regions carry
 * `page: "about"` under the comment "a region declared on /about must say so, or the
 * editor files it under Home" (lib/styles.ts, 2026-09-04). The site's declaration wins
 * (`editor-shows-what-site-sets`), so `styles` filters. Sam confirmed, 2026-09-09.
 */
export const CATEGORY_IS_PAGE_SCOPED: Record<ManifestCategory, boolean> = {
  fields: true,
  slots: true,
  styles: true,
  links: true,
  components: true,
  videoSlots: true,
  // Site-wide: the palette, the upload budgets and the styling lock are declared once and
  // mean the same thing on every page.
  styleOptions: false,
  assetBudgets: false,
  itemStyling: false,
}

/**
 * The regions of one page, out of a merged manifest's list.
 *
 * THE RULE IS THE BRIDGE'S, not a new one: an ABSENT `page` means "the first declared
 * page" (see `PageScoped` in the bridge's manifest.ts, and `rank` in `mergeManifests`,
 * which sorts untagged regions with the first page for exactly this reason). That is what
 * makes every existing single-page manifest correct without touching it, and why skeen
 * needed no change — its home regions are untagged and its About regions are tagged.
 *
 * Two states filter NOTHING, and both are the common case rather than an edge:
 *   - `page === null` — the frame has not said which page it shows yet, and never will on
 *     a site with no pages. Filtering here would blank every panel on load.
 *   - the site declares no `pages` — there is no first page to belong to.
 *
 * A tag naming a page the site does NOT declare falls back to the first page, following
 * the fold's own principle: degrade to misplaced, never to invisible. A manager must not
 * lose their only route to a region because a page was renamed.
 */
export function onPage<T extends { page?: string }>(
  items: readonly T[] | undefined,
  page: string | null,
  pages: readonly ManifestPage[] | undefined,
): T[] | undefined {
  if (!items) return undefined
  if (page === null || !pages || pages.length === 0) return [...items]
  const first = pages[0].key
  const declared = new Set(pages.map((p) => p.key))
  return items.filter((item) => (item.page && declared.has(item.page) ? item.page : first) === page)
}

/**
 * The merged manifest narrowed to ONE page, before any panel reads it.
 *
 * Done here, once, rather than in each resolver below: every page-scoped category is
 * filtered by the same rule, and a category that gained its own copy of the predicate is
 * a category that can drift from it. `CATEGORY_IS_PAGE_SCOPED` decides which keys are
 * touched, so the registry is what runs rather than what documents.
 *
 * TWO SURVIVING MUTANTS HERE ARE EQUIVALENT TODAY, recorded so the next reader does not
 * spend an afternoon on them (Stryker, 2026-09-09):
 *
 *  - `page === null` in the guard below. Deleting it changes nothing, because `onPage`
 *    makes the same check itself and returns the list whole. Kept as the early exit: it
 *    skips the whole copy on the common path, and states the rule where it is read.
 *  - the `CATEGORY_IS_PAGE_SCOPED` check and the `Array.isArray` check are each other's
 *    backstop, so neither can be killed while the other stands. That is an accident of
 *    the registry as it is: every category currently marked site-wide happens to be a
 *    non-array (`styleOptions`, `assetBudgets`, `itemStyling`), so the type check alone
 *    happens to reach the same answer. The registry check is the LOAD-BEARING one — it
 *    is the line a reader changes when a category's scope changes — and the day a
 *    site-wide category is a list, it starts biting and the type check goes back to being
 *    what it says it is. Neither is removed to chase a score.
 */
function manifestForPage(manifest: TemplateManifest | null, page: string | null): TemplateManifest | null {
  if (!manifest || page === null || !manifest.pages?.length) return manifest
  const pages = manifest.pages
  // ITERATED, not hand-listed. A six-key literal here would have read identically and
  // silently skipped the seventh category the day one was added — the defect this whole
  // file exists to end, arriving one layer down. Every category name is a manifest key by
  // construction, so the registry alone decides what gets narrowed.
  //
  // A COPY, never the held manifest: narrowing is a VIEW. Mutating in place would empty
  // Home on the way back from About, and the fold has no way to rebuild what it dropped.
  const out: Record<string, unknown> = { ...manifest }
  for (const category of MANIFEST_CATEGORIES) {
    if (!CATEGORY_IS_PAGE_SCOPED[category]) continue
    const items = manifest[category]
    // A category the site declared as something other than a list is left alone rather
    // than coerced: `itemStyling` is a boolean, and a future scalar would be too.
    if (!Array.isArray(items)) continue
    out[category] = onPage(items as readonly { page?: string }[], page, pages)
  }
  return out as unknown as TemplateManifest
}

/** Everything the inspector needs that a manifest can decide. */
export type PanelInputs = {
  textFields: EditorTextField[]
  imageFields: EditorImageField[]
  /** The site's declared image COLLECTIONS, in declaration order — one labelled grid
   *  each in the Images panel. Empty means the site renders no open photo pool at all,
   *  which is why this replaced a `showGallery` boolean: "how many, and what are they
   *  called" is the same question as "is there one", and one list answers both. The
   *  FIRST is where untagged photos live (every photo placed before collections). */
  imageCollections: readonly { key: string; label: string }[]
  /** False when the site locks its look (manifest itemStyling: false): gallery tiles
   *  offer Replace, never the per-item style editor. */
  itemStyling: boolean
  components: NonNullable<TemplateManifest['components']>
  videoSlots: NonNullable<TemplateManifest['videoSlots']>
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
  /** The page the FRAME is showing (`framePage`), or null before its first `page-change`
   *  — which is also forever, on a site that declares no pages. Page-scoped categories
   *  narrow to it; site-wide ones ignore it entirely (CATEGORY_IS_PAGE_SCOPED). */
  page: string | null
  /** The draft the editor holds — where a declared field's current VALUE comes from. */
  draft: PublicSitePayload | null
  siteContent: SiteContent
  /** What page.tsx resolved from the LOCAL manifest, for a built-in template. */
  local: { textFields: EditorTextField[]; imageFields: EditorImageField[] }
  /** Per-category derivations that need more than a lookup (values joined from the
   *  draft). Injected so this module stays free of React and of the editor's internals. */
  derive: {
    textFields: (m: TemplateManifest | null, values: SiteContent, draft: PublicSitePayload | null) => EditorTextField[]
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
  const { customSiteUrl, manifest: merged, page, draft, siteContent, local, derive } = args
  // Narrowed ONCE, at the top, so every reader below sees one page's manifest and no
  // resolver can forget. The derived text/image fields read it too — a Text panel that
  // still listed Home's headings on About would be the same bug in a different panel.
  const manifest = manifestForPage(merged, page)
  const announced = customSiteUrl ? manifest : null
  return {
    textFields: customSiteUrl ? derive.textFields(manifest, siteContent, draft) : local.textFields,
    imageFields: customSiteUrl ? derive.imageFields(manifest, draft) : local.imageFields,
    // Gated like every sibling. It read the UNGATED manifest until this refactor, so a
    // built-in that announced an image slot would have shown a gallery its template does
    // not render — the same class of bug, arriving from the other direction.
    imageCollections: (announced?.slots ?? [])
      .filter((sl) => sl.accepts === 'image')
      .map((sl) => ({ key: sl.key, label: sl.label })),
    // Absent = true: every site and built-in template before ftbk styled items.
    itemStyling: announced?.itemStyling !== false,
    components: announced?.components ?? [],
    // The Videos panel is built from THESE, not a hardcoded list — a site that declares
    // none (Juniper) shows no video slots at all (phase 4, 2026-08-12).
    videoSlots: announced?.videoSlots ?? [],
    styleRegions: announced?.styles ?? [],
    styleOptions: announced?.styleOptions,
    assetBudgets: announced?.assetBudgets,
    linkRegions: announced?.links ?? [],
  }
}

/**
 * Whether a resolved input carries anything — the shape-agnostic "did this category reach
 * a panel" check the coverage test asserts with. LOAD-BEARING: if this said yes to
 * everything, that test would pass with every panel empty.
 *
 * One Stryker mutant survives here and is EQUIVALENT, recorded so the next reader does
 * not spend an afternoon on it: deleting the `Array.isArray` line changes nothing,
 * because `Object.keys([x]).length` answers identically for a dense array. The branch
 * stays for the reader — an array is not an object to most people — and because a sparse
 * array would diverge.
 */
/** What each BOOLEAN input resolves to with no manifest at all. A boolean is
 *  "populated" when it DIFFERS from this — `itemStyling: false` is a declaration
 *  reaching the panels, not an empty value (the truthy check called it missing). */
const BOOLEAN_DEFAULTS: Partial<Record<keyof PanelInputs, boolean>> = {
  itemStyling: true,
}

export function inputIsPopulated(key: keyof PanelInputs, value: PanelInputs[keyof PanelInputs]): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'boolean') return value !== (BOOLEAN_DEFAULTS[key] ?? false)
  if (Array.isArray(value)) return value.length > 0
  return Object.keys(value).length > 0
}
