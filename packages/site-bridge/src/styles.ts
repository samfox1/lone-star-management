/**
 * The STYLE RESOLUTION machinery — how a stored class string becomes what an element
 * actually renders. Ported VERBATIM from skeen's `lib/styles.ts` + `lib/textSizes.ts`
 * (SITE_BRIDGE_PLAN.md phase 1 slice 2). skeen's own file said it plainly: "the
 * SEMANTICS below are a shared contract, so change them in both repos or the editor
 * preview and the live site will disagree" — this module is that contract with ONE
 * home. What stays in a site: its region REGISTRY (keys, labels, base classes) — that
 * is design, not contract — bound to `regionProps` via a local wrapper.
 *
 * The TEXT_SIZES ladder lives here too: it existed character-identical in BOTH repos
 * (lone-star's SIZE_OPTIONS and skeen's textSizes.ts — verified 2026-08-07), was the
 * epicenter of the three-lists drift bug of 2026-08-05, and is what tokens.css is
 * generated from.
 */
import { STYLE_ATTR, WINDOW_ATTR } from "./markers";
import type { SiteStyles } from "./payload";

export { STYLE_ATTR, WINDOW_ATTR };

export type TextSizeOption = { value: string; label: string };

// LABELS are the desktop px (each clamp's max) — the number every site editor shows for
// font size, and the only labelling that stays ordered across 19 stops. The first pass
// used words ("Medium, XL, Large, Huge, Giant"), which read as random on a slider.
export const TEXT_SIZES: TextSizeOption[] = [
  { value: "text-[clamp(0.7rem,1.6vw,0.75rem)]", label: "12px" },
  { value: "text-[clamp(0.78rem,1.9vw,0.875rem)]", label: "14px" },
  { value: "text-[clamp(0.85rem,2.2vw,1rem)]", label: "16px" },
  { value: "text-[clamp(0.95rem,2.6vw,1.125rem)]", label: "18px" },
  { value: "text-[clamp(1rem,3vw,1.25rem)]", label: "20px" },
  { value: "text-[clamp(1.15rem,3.6vw,1.5rem)]", label: "24px" },
  { value: "text-[clamp(1.3rem,4.4vw,1.875rem)]", label: "30px" },
  { value: "text-[clamp(1.5rem,5.2vw,2.25rem)]", label: "36px" },
  { value: "text-[clamp(1.75rem,6.5vw,3rem)]", label: "48px" },
  { value: "text-[clamp(2rem,8vw,3.75rem)]", label: "60px" },
  { value: "text-[clamp(2.25rem,9.5vw,4.5rem)]", label: "72px" },
  { value: "text-[clamp(2.6rem,12vw,6rem)]", label: "96px" },
  { value: "text-[clamp(3rem,15vw,8rem)]", label: "128px" },
  // DISPLAY sizes, above anything Tailwind names. The scale used to stop at 8rem while
  // the hero wordmark is 11rem, so the largest size on offer was a 27% shrink with no way
  // back up.
  { value: "text-[clamp(3.2rem,16vw,9rem)]", label: "144px" },
  { value: "text-[clamp(3.5rem,17vw,10rem)]", label: "160px" },
  // The hero wordmark's own clamp, character for character, so a manager opens ON it
  // rather than beside it.
  { value: "text-[clamp(4rem,18vw,11rem)]", label: "176px" },
  { value: "text-[clamp(4.2rem,19vw,12rem)]", label: "192px" },
  { value: "text-[clamp(4.6rem,21vw,14rem)]", label: "224px" },
  { value: "text-[clamp(5rem,23vw,16rem)]", label: "256px" },
];

/**
 * Legacy fixed size → its fluid twin: the clamp whose MAX is that exact size.
 *
 * Rows styled before the scale went fluid (2026-08-05) store `text-4xl` and friends. A
 * fixed size is the same rem at every width, which is why four of the five polaroid
 * captions ran off their cards on a phone while the one styled after the change fit.
 * Those rows are the manager's data — the fix is to render them as what they would say
 * on today's scale, not to edit them. resolveRegionStyle applies this map to every
 * override; desktop is pixel-identical because each clamp maxes at the size it replaces.
 *
 * Values come straight out of TEXT_SIZES, whose safelisting editList.test.ts proves — a
 * translation can never produce an uncompiled class.
 */
/** Tailwind's named sizes, in scale order. Position i's fluid twin is TEXT_SIZES[i] —
 *  each clamp's max IS the fixed size it replaced, which styles.test.ts pins per name, so
 *  deriving the map (rather than hand-writing 13 pairs) leaves nothing to drift. */
const LEGACY_NAMES = [
  "text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl",
  "text-4xl", "text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl",
];
export const LEGACY_TO_FLUID: Record<string, string> = Object.fromEntries(
  LEGACY_NAMES.map((name, i) => [name, TEXT_SIZES[i].value]),
);

/**
 * An override string with every legacy fixed size replaced by its fluid twin. Variants
 * ride along (`sm:text-5xl` → `sm:text-[clamp(…)]`): a size behind a breakpoint is just
 * as fixed, one breakpoint later. Look-alikes (`text-center`, `text-flash-1`) miss the
 * map and pass through untouched.
 */
export function fluidizeSizes(override: string): string {
  if (!override.includes("text-")) return override;
  return override
    .split(/\s+/)
    .map((token) => {
      const at = token.lastIndexOf(":") + 1;
      // Strip an important prefix for the lookup, keep it on the result — `!text-4xl`
      // is just as fixed as `text-4xl`, one modifier later (2026-08-07 review).
      const bare = token.slice(at);
      const bang = bare.startsWith("!") ? "!" : "";
      const mapped = LEGACY_TO_FLUID[bang ? bare.slice(1) : bare];
      return mapped ? token.slice(0, at) + bang + mapped : token;
    })
    .join(" ");
}

/**
 * Resolve a region's class string: the editor override if the manager set one,
 * otherwise the given base classes. Exported for direct use/testing; components
 * usually go through regionProps().
 */
export function styleClass(
  styles: SiteStyles | undefined,
  key: string,
  base: string,
): string {
  return mergeStyle(key, base, styles?.[key] ?? "");
}

/* ── Per-ITEM overlays + colours the build can't compile ──────────────────────────
 * Mirrors lone-star's `lib/site-editor/style-apply.ts`. Skeen keeps its own copy of
 * the editor protocol on purpose (see frameBridge.ts) — but the SEMANTICS below are a
 * shared contract, so change them in both repos or the editor preview and the live
 * site will disagree about what a stored string means. */

/** True when the key addresses ONE item inside a slot rather than a whole section: the
 *  colon convention (`slot:polaroid_1_photo`, `image:<uuid>`). A section override
 *  REPLACES its base classes; an item override is an OVERLAY that adds to them, because
 *  the editor's item panel starts empty and emits only what the manager changed. */
export function isItemKey(key: string): boolean {
  return key.includes(":");
}

/** The final class string for a region: item overlays append (and so win on equal
 *  specificity), section overrides replace, and a blank override always restores base. */
export function mergeStyle(
  key: string,
  base: string,
  override: string,
): string {
  if (!override.trim()) return base;
  if (!isItemKey(key)) return override;
  return base.trim() ? `${base.trim()} ${override.trim()}` : override.trim();
}

/** Arbitrary-value colour utilities → the CSS property each sets. */
const COLOR_PROPS: Record<string, "borderColor" | "color" | "backgroundColor"> =
  {
    border: "borderColor",
    text: "color",
    bg: "backgroundColor",
  };

/* The editor's whole per-item vocabulary applies as INLINE STYLE, not classes
 * (mirrors lone-star's style-apply.ts, 2026-08-03). Classes failed two ways: this
 * site's build had never compiled the overlay utilities (they only exist at runtime),
 * and even compiled ones tie with same-property base classes (border-4 vs
 * border-[6px]) where STYLESHEET order — not class order — decides. Inline needs no
 * build and beats any class deterministically. */
const SHADOWS: Record<string, string> = {
  "shadow-sm": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  shadow: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  "shadow-md":
    "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  "shadow-lg":
    "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  "shadow-xl":
    "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
  "shadow-2xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
};

/** One owned utility → the inline CSS it means, or null when the token is the site's
 *  own vocabulary (which stays a class). */
function inlineToken(token: string): Record<string, string> | null {
  let m = token.match(/^scale-(\d{1,3})$/);
  if (m) return { scale: String(Number(m[1]) / 100) };
  m = token.match(/^opacity-(\d{1,3})$/);
  if (m) return { opacity: String(Number(m[1]) / 100) };
  m = token.match(/^border-\[(\d{1,3})px\]$/);
  if (m) return { borderWidth: `${m[1]}px`, borderStyle: "solid" };
  m = token.match(/^rounded-\[(\d{1,3})px\]$/);
  if (m) return { borderRadius: `${m[1]}px` };
  if (token === "rounded-full") return { borderRadius: "9999px" };
  if (token in SHADOWS) return { boxShadow: SHADOWS[token] };
  return null;
}

/** Every inline property the editor may write — the clear list a live re-apply resets
 *  before setting the current overlay, so removing a control removes its effect. */
export const MANAGED_STYLE_PROPS = [
  "border-color",
  "color",
  "background-color",
  "scale",
  "opacity",
  "border-width",
  "border-style",
  "border-radius",
  "box-shadow",
] as const;

export type ResolvedStyle = {
  className: string;
  style: Record<string, string>;
  /** Video playback rate (`speed-[1.5x]`) — a DOM property, not CSS. Absent when the
   *  string carries no speed token; the consumer resets to 1. */
  playbackRate?: number;
};

/** `speed-[<rate>x]` — the editor's playback-speed pseudo-token (mirrors lone-star's
 *  style-apply.ts). Speed can never be CSS, so like the colours it rides the stored
 *  class string and is applied as a property (`video.playbackRate`). */
const SPEED_TOKEN = /^speed-\[(\d+(?:\.\d+)?)x\]$/;

/** The rates a media element will actually accept. WebKit throws NotSupportedError
 *  outside roughly this range, and BOTH consumers assign `playbackRate` unguarded, so an
 *  out-of-range token must resolve to nothing rather than throw mid-apply. */
const MIN_PLAYBACK_RATE = 0.0625;
const MAX_PLAYBACK_RATE = 16;

/** An arbitrary hex colour token → the inline property it sets, or null. Colours lift
 *  from ANY string: no build can compile 16.7M of them, so they were never classes. */
function colorStyle(token: string): Record<string, string> | null {
  const m = token.match(/^([a-z]+)-\[(#[0-9a-fA-F]{3,8})\]$/);
  const prop = m ? COLOR_PROPS[m[1]] : undefined;
  return m && prop ? { [prop]: m[2] } : null;
}

/** `speed-[Nx]` → a rate a media element will actually accept, or null. */
function speedRate(token: string): number | null {
  const m = token.match(SPEED_TOKEN);
  if (!m) return null;
  const rate = Number(m[1]);
  return rate >= MIN_PLAYBACK_RATE && rate <= MAX_PLAYBACK_RATE ? rate : null;
}

/**
 * Split a class string into classes Tailwind can compile, inline styles it can't, and
 * the playback rate that isn't CSS at all.
 *
 * The editor's colour palette is 16.7M colours picked at runtime, so `border-[#123abc]`
 * is a class no build ever emits — Tailwind only compiles what it can see in source, and
 * safelisting is hopeless at that cardinality. Colours therefore ride as inline style.
 * Lengths, corners, shadows, scale and opacity ride inline TOO (see inlineToken): this
 * site's build never compiled them, and even compiled they only tie with same-property
 * base classes, where stylesheet order decides. Inline needs no build and always wins.
 * Everything else — the site's own vocabulary — stays a class.
 */
function resolveTokens(classString: string, liftAll: boolean): ResolvedStyle {
  const classes: string[] = [];
  const style: Record<string, string> = {};
  let playbackRate: number | undefined;
  for (const token of classString.split(/\s+/).filter(Boolean)) {
    const inline = colorStyle(token) ?? (liftAll ? inlineToken(token) : null);
    const speed = liftAll ? speedRate(token) : null;
    if (inline) Object.assign(style, inline);
    else if (speed != null) playbackRate = speed;
    else classes.push(token);
  }
  return {
    className: classes.join(" "),
    style,
    ...(playbackRate != null ? { playbackRate } : {}),
  };
}

/** Full lift — for a string the MANAGER authored (an item overlay). */
export function resolveStyle(classString: string): ResolvedStyle {
  return resolveTokens(classString, true);
}

/**
 * What a marked element's class and inline style should become, given its base classes
 * and the manager's stored string for that key.
 *
 * PROVENANCE decides what may lift (mirrors lone-star's resolveRegionStyle, 2026-08-03).
 * The item-vocabulary lift applies ONLY to the manager's overlay — never to the base
 * classes, which belong to the SITE and may legitimately carry `opacity-0`,
 * `rounded-full`, or variant pairs (`hover:`, `md:`) whose class semantics inlining
 * would destroy. Inline beats every class in every state and at every breakpoint, so a
 * lifted base token kills its own variants silently.
 *
 * Section strings lift colours only, matching their pre-inline behaviour: a section's
 * vocabulary is the site's own compiled classes.
 *
 * Skeen learned this the hard way on 2026-08-04. Lifting from the merged string meant
 * Hero's transient `opacity-0` fade class became inline `opacity: 0` — which React,
 * owning only the class attribute, could never take back.
 */
export function resolveRegionStyle(
  key: string,
  base: string,
  rawOverride: string,
): ResolvedStyle {
  // The OVERRIDE only, never the base: stored rows from before the scale went fluid
  // carry fixed sizes (`text-5xl`) that overflow phones — the polaroid-caption
  // screenshot of 2026-08-05. The base is code and says what it means; the override is
  // data with a history. See fluidizeSizes.
  const override = fluidizeSizes(rawOverride);
  if (!isItemKey(key))
    return resolveTokens(mergeStyle(key, base, override), false);
  const lifted = resolveTokens(override.trim(), true);
  const kept = base.trim();
  return {
    className: [kept, lifted.className].filter(Boolean).join(" "),
    style: lifted.style,
    ...(lifted.playbackRate != null
      ? { playbackRate: lifted.playbackRate }
      : {}),
  };
}

/**
 * Props to spread onto a styled region element: its resolved className, plus the
 * `data-lse-style` marker in edit mode only (so the public site carries no tags):
 *   <section {...regionProps(styles, REGION.workSection, editable, myBase)}>
 *
 * `base` is REQUIRED here, and that is the package's one deliberate signature change
 * from skeen's original (SITE_BRIDGE_PLAN.md, the registry inversion): skeen defaulted
 * it from its OWN region registry (`base = regionBase(key)`), but the registry is site
 * design, not contract — a package default would smuggle one site's look into every
 * site. A site keeps a two-line wrapper that binds its registry:
 *   const regionProps = (styles, key, editable, base = regionBase(key)) =>
 *     bridgeRegionProps(styles, key, editable, base)
 */
export function regionProps(
  styles: SiteStyles | undefined,
  key: string,
  editable: boolean,
  base: string,
): { className: string; style?: Record<string, string> } & Record<
  string,
  unknown
> {
  const { className, style } = resolveRegionStyle(
    key,
    base,
    styles?.[key] ?? "",
  );
  // `style` only when there IS one: spreading `style: {}` onto every region would stamp
  // an empty style attribute across the whole page.
  const styleProp = Object.keys(style).length > 0 ? { style } : {};
  return editable
    ? { className, ...styleProp, [STYLE_ATTR]: key }
    : { className, ...styleProp };
}

/** A per-item region key, e.g. regionProps(styles, itemRegion("videos", id), editable,
 *  base). The `<slot>:<id>` shape IS the item/section discriminator — see isItemKey. */
export function itemRegion(slot: string, id: string): string {
  return `${slot}:${id}`;
}

/** A per-item style key for a component slot the editor exposes (`polaroid_1_photo` →
 *  `slot:polaroid_1_photo`). Must match lone-star's item editor, which keys any library
 *  item as `<assetType>:<id>` — `slot:<role>`, `image:<id>`, `video:<id>`. */
export function slotRegion(role: string): string {
  return `slot:${role}`;
}

/** Overlay tokens that must sit on the window to be visible. On the item inside an
 *  `overflow-hidden` wrapper they apply but can't be SEEN: corners and borders are
 *  clipped square again by the wrapper, and a shadow is cut off entirely. */
// `!?` — the important prefix is an established editor convention (the leading
// controls); a future `!rounded-*` routed to the clipped inner element would be a
// silent visual no-op (2026-08-07 review, latent edge).
const WINDOW_TOKEN = /^!?(rounded|border|shadow)(-|$)/;

/**
 * Split a per-item overlay between the item and its window.
 *
 * The editor stores ONE class string per item (`slot:polaroid_1_photo`), but a polaroid
 * photo renders as two elements: the clipping window and the <img> inside it. Corners,
 * border (including its `border-[#hex]` colour) and shadow go to the window, where they
 * survive the clip; size and transparency stay on the image, where scale reads as a
 * zoom within the frame instead of the card bursting its own padding.
 */
export function splitItemOverlay(override: string): {
  window: string;
  inner: string;
} {
  const win: string[] = [];
  const inner: string[] = [];
  for (const token of override.split(/\s+/).filter(Boolean)) {
    (WINDOW_TOKEN.test(token) ? win : inner).push(token);
  }
  return { window: win.join(" "), inner: inner.join(" ") };
}

/**
 * `regionProps` for a windowed item: one stored overlay, split across the two elements.
 * The inner element carries the STYLE_ATTR marker (it's what the editor selects and
 * highlights); the window carries WINDOW_ATTR so the live bridge can find it too.
 */
export function splitItemProps(
  styles: SiteStyles | undefined,
  key: string,
  editable: boolean,
  innerBase: string,
  windowBase: string,
): {
  window: { className: string; style?: Record<string, string> } & Record<
    string,
    unknown
  >;
  inner: { className: string; style?: Record<string, string> } & Record<
    string,
    unknown
  >;
} {
  const parts = splitItemOverlay(styles?.[key] ?? "");
  const win = resolveRegionStyle(key, windowBase, parts.window);
  const inn = resolveRegionStyle(key, innerBase, parts.inner);
  return {
    window: {
      className: win.className,
      ...(Object.keys(win.style).length > 0 ? { style: win.style } : {}),
      ...(editable ? { [WINDOW_ATTR]: key } : {}),
    },
    inner: {
      className: inn.className,
      ...(Object.keys(inn.style).length > 0 ? { style: inn.style } : {}),
      ...(editable ? { [STYLE_ATTR]: key } : {}),
    },
  };
}
