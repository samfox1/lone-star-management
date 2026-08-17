/**
 * The MANIFEST SCHEMA — what a site declares editable (SITE_EDITOR_PLAN.md phase 0,
 * moved here from lone-star's `src/lib/site-editor/manifest.ts` per SITE_BRIDGE_PLAN.md
 * phase 1, types only — lone-star keeps its built-in template MANIFESTS data and the
 * role/key helper functions; this package owns the SHAPE both sides agree on).
 *
 * The visual editor is a CONTENT UPDATER, not a website builder: the only editable
 * things are a fixed set — declared text, images, and library slots (tracks / videos /
 * photos / merch / tour). A site declares its editable regions via this manifest and
 * marks the matching DOM regions; the one editor reads both and never has to know a
 * site's layout.
 *
 * EVOLUTION RULE: additive only, same as the payload — an editor may meet a manifest
 * announced by an older site build at any time, forever.
 */

/**
 * This package's RELEASE version (semver), for the editor's "republish to apply" flag. A
 * site stamps it into its manifest (`bridgeVersion`) at build time from whatever bridge it
 * installed; the editor compares against its own copy. Distinct from protocol.ts's numeric
 * `BRIDGE_VERSION`, which is the postMessage wire version — this one tracks the npm
 * release, because that is what determines which style tokens the site's applier can lift.
 * KEEP IN SYNC with package.json `version`. (Hardcoded rather than imported: the package is
 * consumed from source, and a JSON import of package.json is not part of the export surface.)
 */
export const PACKAGE_VERSION = '0.22.0'

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
   * broken one.
   */
  styleKey?: string
}

/** The library asset types a slot can hold, AS A VALUE — so item-marker parsers can
 *  validate against the registry instead of hand-listing it (AGENTS.md rule 4: a
 *  hand-written list silently omits every future member; lone-star's markers.ts had
 *  exactly that copy). Mirrors the content entities. */
export const LIBRARY_ASSETS = ['track', 'video', 'image', 'merch', 'tour_date', 'link'] as const
export type LibraryAsset = (typeof LIBRARY_ASSETS)[number]

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
   *  site declares none, the editor infers groups from shared key prefixes. Declaring
   *  it wins, so a site can name its own outline. */
  group?: string
  /** Where this region lives in the editor (one edit path per thing, Sam 2026-08-12).
   *  `'site'`: the page-wide surface (the body band) — the Style tab lists it, offering
   *  surface controls only. `'chrome'`: a BAR framing the page (nav, footer) — listed
   *  like 'site' and additionally offered geometry (width/height), which the body band
   *  can't show (height is a floor the body always exceeds). `'item'`: a PER-ITEM
   *  region (song titles) — its instances dress LIBRARY content, so the Text panel
   *  must not list it as a text area and styling stays click-to-edit on the item.
   *  Additive; absent means element-scoped (click-to-edit). 'icons' is an icon GROUP (the
   *  socials row): a curated set — icon size, colour, hover colour, gap — that cascades to
   *  every icon so they stay consistent. */
  scope?: 'site' | 'chrome' | 'item' | 'icons'
}

/** A link-powered element — one `data-lse-link="<key>"` <a> whose href is editable by
 *  KEY (not by guessing from its label). The editor maps a URL to it and the site binds
 *  the link to the element by this key (`links.role`). `description` explains what the
 *  link powers ("Disco-ball playlist link"), shown in the inspector. */
export type ManifestLinkRegion = {
  key: string
  label: string
  description?: string
  /**
   * `false` when this link CONFIGURES something rather than powering an element on the
   * page — skeen's `booking` is the address the contact form sends enquiries to, so there
   * is no anchor to mark and no `data-lse-link` to emit.
   *
   * Declared rather than inferred, because a link with no marker is otherwise
   * indistinguishable from one whose marker was forgotten — which is a control the
   * manager can set that changes nothing, with no error anywhere. `checkContract` demands
   * a marker for every link that does not opt out here.
   */
  rendered?: boolean
}

/**
 * A repeated multi-image COMPONENT the site renders a fixed number of (skeen's polaroid
 * wall: 5 cards, each holding a photo and a handwriting PNG).
 *
 * The site owns the count — it is a fact about the layout, not something the manager
 * adds to (Sam, 2026-07-21) — and owns the slot names. A media row is bound to one slot
 * by `media.site_role`, whose value is `<key>_<n>_<slot.key>` (e.g. `polaroid_3_photo`),
 * matching the field keys the site declares.
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

/** One video slot the site renders — declared, not hardcoded (phase 4). */
export type ManifestVideoSlot =
  | {
      /** A background clip: one UPLOADED video assigned to a site_role. */
      kind: 'hero'
      /** The site_role the placed clip carries (e.g. `hero_landscape`). */
      role: string
      /** The slot's label in the panel + picker heading. */
      label: string
      /** The group heading it sits under ("Landing page", "Bio background"). */
      group: string
    }
  | {
      /** A row of YouTube embeds toggled on-site (skeen's videos band). */
      kind: 'band'
      /** How many embed slots the row shows. */
      count: number
      /** The per-slot label base ("Video slot" → "Video slot 1"). */
      label: string
      /** The group heading it sits under ("Videos band"). */
      group: string
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

/** One offered value for a style control (a class the site can actually compile). */
export type StyleOption = {
  value: string
  label: string
  /** For a COLOUR option, the hex it renders as. The value is a class (`text-flash-1`)
   *  whose colour lives in the site's own CSS, so the editor can't know what it looks
   *  like — a site that declares this gets its palette offered as real swatches in the
   *  colour picker. Optional: a site that omits it simply isn't offered there. */
  hex?: string
  /**
   * For a FONT option, the CSS `font-family` value the class resolves to
   * (`'"Momo Display", serif'`).
   *
   * The same shape of declaration as `hex`, for the same reason: the class is the site's
   * own, so the editor cannot know what it means. Declaring it lets the editor set
   * `--lse-font` instead of writing the class, which is what keeps the site in charge of
   * the typeface at each breakpoint (CONNECTING.md §5). Omitted, the editor keeps writing
   * the class — a site migrates one font at a time, never all at once.
   */
  css?: string
}

/** A site's declared design palette (from its manifest). Colours + fonts are the site's
 *  OWN tokens (skeen: `bg-flash-1`, `font-momo`), so the dropdowns offer real, compiled
 *  classes rather than generic guesses. */
export type SiteStyleOptions = {
  fonts?: StyleOption[]
  textColors?: StyleOption[]
  bgColors?: StyleOption[]
  /**
   * The FONT SIZES this site can actually render, low → high.
   *
   * Tailwind builds only the classes it can see, so an editor-offered size the site
   * never compiled lands on the element with no CSS behind it and silently no-ops.
   * The site is the authority; omitted or empty falls back to the editor's standard
   * ladder, which keeps older builds and lone-star's own templates working unchanged.
   */
  textSizes?: StyleOption[]
}

/** What a slot needs from an uploaded file. All fields optional; absent means "no
 *  opinion". The manifest is the contract (BRIEF-asset-compression.md). */
export type AssetBudget = {
  /** Longest-edge pixels the slot can usefully display (2× render size, for retina).
   *  Downscale target only — never upscale. Images only. */
  maxEdgePx?: number
  /** Hard ceiling on stored bytes. Images tune quality to land under it; video/fonts
   *  gate on it. */
  maxBytes?: number
  /** Re-encode target for images (`image/webp`). Never set on video/fonts. */
  mime?: string
}

/** A site's declared budgets: per upload kind, with per-slot overrides keyed
 *  `<component>_<slot>` (`polaroid_photo`). */
export type AssetBudgets = {
  image?: AssetBudget
  video?: AssetBudget
  font?: AssetBudget
  slots?: Record<string, AssetBudget>
}

/** One site's full editable surface. `template` is the built-in template name or a
 *  custom site's declared id. */
export type TemplateManifest = {
  template: string
  /** The version of THIS package the site was built against (`BRIDGE_VERSION`). The
   *  editor compares it to its own: when the site is behind, a control may emit a token
   *  the site's bundled applier can't lift yet, so the editor flags "republish to apply".
   *  Optional — a site that omits it (an older build) simply isn't flagged. */
  bridgeVersion?: string
  fields: ManifestField[]
  slots: ManifestSlot[]
  styles: ManifestStyleRegion[]
  /** Declared link-powered elements, bound to a `links` row by key (`role`). A custom
   *  site sends its own on `ready`; the built-in templates declare none yet. */
  links: ManifestLinkRegion[]
  /** Repeated multi-image components (the polaroid wall). Optional — a site that
   *  declares none simply has no component section in the editor. */
  components?: ManifestComponent[]
  /** The video slots the site renders — the Videos panel is built from THESE, not from
   *  a hardcoded list (SITE_BRIDGE_PLAN phase 4). Optional and defaulting to empty, so a
   *  site with no video (Juniper) shows no video slots at all, instead of inheriting
   *  skeen's hero + band slots. A `'hero'` slot holds one uploaded clip bound by
   *  `role` (site_role); a `'band'` slot is a row of `count` YouTube embeds. */
  videoSlots?: ManifestVideoSlot[]
  /** The site's design palette (its own colour + font classes) for the no-code Style
   *  panel's dropdowns. Optional — the universal controls (size/weight/align/case) work
   *  without it; colour + font controls only appear when the site declares them. */
  styleOptions?: SiteStyleOptions
  /** Per-kind / per-slot upload budgets. The editor's upload gate reads these; absent
   *  (older manifests) means no gate beyond the editor's own floor. */
  assetBudgets?: AssetBudgets
}

/** Field keys the manifest declares as TEXT. NOTE (2026-08-07 review): only
 *  `type === 'text'` counts. `email` rides the image-guess path harmlessly (an email
 *  never matches looksLikeUrl), but when the `richtext` v2 seed becomes real it MUST be
 *  added here — a rich value starting with `/` would hit swapForImage otherwise. `editList` is deliberately `unknown` here —
 *  the bridge only forwards it — so this reads defensively instead of typing it. */
export function textFieldKeys(editList: unknown): Set<string> {
  const fields = (editList as { fields?: unknown } | null | undefined)?.fields;
  if (!Array.isArray(fields)) return new Set();
  const keys = fields
    .filter(
      (f): f is { key: string } =>
        !!f &&
        typeof f === "object" &&
        (f as { type?: unknown }).type === "text" &&
        typeof (f as { key?: unknown }).key === "string",
    )
    .map((f) => f.key);
  return new Set(keys);
}

