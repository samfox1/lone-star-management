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

type TextSizeOption = { value: string; label: string };

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

/* ── SIZE and FONT as CSS custom properties (CONNECTING.md §5) ────────────────────────
 * A class-writing control beats the site's breakpoints: it lands in the merged string,
 * and a section override REPLACES the base, so the `md:text-6xl` the site wrote is gone.
 * These two tokens invert that. The editor supplies a VALUE on `--lse-size` /
 * `--lse-font`; the site writes the rule that reads it and can still shrink it on a
 * phone.
 *
 * The property is inlined TOO, so a site that opts into nothing renders exactly as it
 * does today. A region takes that authority back by CLAIMING the property in its base
 * (`lse-owns-[size]`), after which only the variable is set.
 */

/** Desktop px → the ladder's own clamp, derived from TEXT_SIZES so a step added to the
 *  ladder is carried here automatically. Every already-styled headline must render
 *  pixel-identically after the migration, which means reusing the exact same clamp
 *  string the `text-[clamp(…)]` class carried. */
const SIZE_BY_PX: Map<number, string> = new Map(
  TEXT_SIZES.map((o) => [
    Number(o.label.replace("px", "")),
    o.value.replace(/^text-\[/, "").replace(/\]$/, ""),
  ]),
);

/**
 * The CSS length `--lse-size` carries for a chosen desktop size.
 *
 * On the ladder: that step's clamp, verbatim. Off it (a site's own base size is almost
 * never a step): a clamp derived the same way — a floor at 70% so a phone has something
 * to give, a vw term that reaches the chosen size at a 1024px viewport, and the choice
 * itself as the ceiling. Fluid either way; a fixed length is the bug this replaces.
 */
export function sizeLength(px: number): string {
  const exact = SIZE_BY_PX.get(px);
  if (exact) return exact;
  const min = Math.round(px * 0.7);
  const vw = ((px / 1024) * 100).toFixed(2).replace(/\.?0+$/, "");
  return `clamp(${min}px,${vw}vw,${px}px)`;
}

/** A font stack is a name list and nothing else. It reaches a style attribute verbatim,
 *  so anything that could close a declaration or open a fetch is refused outright rather
 *  than escaped — there is no legitimate family name containing a paren or a semicolon. */
const FONT_STACK_OK = /^[A-Za-z0-9 ,-]+$/;
const MAX_FONT_STACK = 200;

/** CSS's own family keywords, which must NOT be quoted — `font-family: 'serif'` asks for
 *  a font actually named "serif" and falls back to the browser default instead. */
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji",
  "fangsong", "inherit", "initial", "revert", "unset",
]);

/**
 * Decode a `fontfam-[…]` payload into a real font stack, or null if it is not one.
 *
 * Underscores stand in for spaces — Tailwind's own arbitrary-value convention, and the
 * only workable one here because the stored style string is split on whitespace.
 *
 * The stored token carries NO quotes: a quote is one of the few characters that could
 * end a style attribute, so the editor's save validator refuses it outright and that
 * refusal is worth keeping. Quoting is restored HERE instead, per family, which is also
 * the only place that can do it correctly — a generic keyword must stay bare, and a name
 * beginning with a digit is invalid unless quoted.
 */
export function fontFamilyValue(encoded: string): string | null {
  const value = encoded.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!value || value.length > MAX_FONT_STACK) return null;
  if (!FONT_STACK_OK.test(value)) return null;
  const families = value
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (!families.length) return null;
  return families
    .map((f) => (GENERIC_FAMILIES.has(f.toLowerCase()) ? f : `'${f}'`))
    .join(", ");
}

/** A region CLAIMS a property when it writes the rule that reads the variable itself.
 *  Claims are per-property and independent: owning size says nothing about font. */
const CLAIM_TOKEN = /^lse-owns-\[([a-z,]+)\]$/;

/** The properties a base claims. Read from the BASE, never the merged string — a section
 *  override replaces the base, so a claim read from the merged string would evaporate the
 *  moment a manager styled the region. */
function claimedProps(base: string): Set<string> {
  const claims = new Set<string>();
  for (const token of base.split(/\s+/)) {
    const m = token.match(CLAIM_TOKEN);
    if (m) for (const prop of m[1].split(",")) claims.add(prop);
  }
  return claims;
}

/**
 * The SECOND-WAVE text families (2026-08-17): the remaining class-writing text controls
 * as value tokens, one row each. `parse` returns the CSS value or null for a refused
 * payload — refusal must be airtight, since these land in a style attribute.
 *
 * Leading gets a bonus over its class form: `!leading-*` needed Tailwind's important
 * prefix because text-* size utilities set line-height too and a parent could pin it at
 * higher specificity. Inline beats both by construction, so the `!` era ends here.
 */
const TEXT_VARS: {
  re: RegExp;
  claim: string;
  variable: string;
  camel: string;
  parse: (payload: string) => string | null;
}[] = [
  // Every `re` claims the whole FAMILY (`prefix-[anything]`) and `parse` alone decides
  // validity. A narrower regex would let a malformed payload fall through as a class —
  // a dead token in the DOM instead of an inert one, and the difference is testable.
  {
    re: /^weight-\[(.+)\]$/, claim: "weight", variable: "--lse-weight", camel: "fontWeight",
    parse: (p) => (/^\d{3}$/.test(p) && Number(p) >= 100 && Number(p) <= 900 ? p : null),
  },
  {
    re: /^align-\[(.+)\]$/, claim: "align", variable: "--lse-align", camel: "textAlign",
    parse: (p) => (["left", "center", "right", "justify", "start", "end"].includes(p) ? p : null),
  },
  {
    // Unitless ratio, matching what the leading scale always meant. 0.5–3 spans every
    // step the editor offers with slack, and excludes px-sized junk.
    re: /^lead-\[(.+)\]$/, claim: "leading", variable: "--lse-leading", camel: "lineHeight",
    parse: (p) =>
      /^\d(?:\.\d{1,3})?$/.test(p) && Number(p) >= 0.5 && Number(p) <= 3 ? p : null,
  },
  {
    re: /^track-\[(.+)\]$/, claim: "tracking", variable: "--lse-tracking", camel: "letterSpacing",
    parse: (p) =>
      /^-?\d(?:\.\d{1,3})?em$/.test(p) && Math.abs(parseFloat(p)) <= 1 ? p : null,
  },
  {
    re: /^case-\[(.+)\]$/, claim: "case", variable: "--lse-case", camel: "textTransform",
    parse: (p) => (["uppercase", "lowercase", "capitalize", "none"].includes(p) ? p : null),
  },
  {
    re: /^fstyle-\[(.+)\]$/, claim: "italic", variable: "--lse-fontstyle", camel: "fontStyle",
    parse: (p) => (["italic", "normal"].includes(p) ? p : null),
  },
];

/**
 * MOBILE OVERRIDES (0.19.0): a second, phone-only value set from the editor's phone
 * view. Inline styles cannot express @media, so the token sets a variable and the
 * element gains a MARKER CLASS that tokens.css reads inside its media query (with
 * !important, to beat the same element's inline desktop property).
 *
 * A CLAIMED property gets the variable only — no marker class — because the package
 * rule would otherwise beat the site's own phone cap, which is the authority the claim
 * exists to protect. The site reads var(--lse-size-m, var(--lse-size, …)) itself.
 *
 * Values are EXACT px, not clamps: the manager chose the number while looking at a
 * phone; there is nothing left to adapt.
 */
const PX_ONLY = (p: string) => (/^\d{1,4}px$/.test(p) ? p : null);
const MOBILE_VARS: {
  re: RegExp;
  variable: string;
  marker: string;
  /** The claim that suppresses the marker class, or null when unclaimable. */
  claim: string | null;
  parse: (payload: string) => string | null;
}[] = [
  { re: /^sizesm-\[(.+)\]$/, variable: "--lse-size-m", marker: "lse-msize", claim: "size", parse: PX_ONLY },
  { re: /^padsm-\[(.+)\]$/, variable: "--lse-pad-m", marker: "lse-mpad", claim: null, parse: PX_ONLY },
  { re: /^gapsm-\[(.+)\]$/, variable: "--lse-gap-m", marker: "lse-mgap", claim: null, parse: PX_ONLY },
  // Item scale, percent → ratio (`scale-135` desktop ↔ `scalesm-[135]` phone). The
  // hero-logo case: per-item Size is a scale, and it had no twin at all.
  {
    re: /^scalesm-\[(.+)\]$/, variable: "--lse-scale-m", marker: "lse-mscale", claim: null,
    parse: (p) => (/^\d{1,3}$/.test(p) ? String(Number(p) / 100) : null),
  },
  // Every TEXT_VARS family joins with a derived row (0.22.0, Sam: "all the styles") —
  // same payload validation as its desktop twin, so the two can never disagree about
  // what a legal value is. Marker naming: lse-m + the claim the manager knows.
  ...TEXT_VARS.map((fam) => ({
    re: new RegExp(fam.re.source.replace("-\\[", "sm-\\[")),
    variable: `${fam.variable}-m`,
    marker: `lse-m${fam.claim}`,
    claim: fam.claim,
    parse: fam.parse,
  })),
];

/** A mobile token → its inline variable + optional marker class, `{}`-style inert on a
 *  refused payload, or null when the token is not a mobile one. */
function mobileToken(
  token: string,
  claims: Set<string>,
): { style: Record<string, string>; marker?: string } | null {
  for (const fam of MOBILE_VARS) {
    const m = token.match(fam.re);
    if (!m) continue;
    const value = fam.parse(m[1]);
    if (value == null) return { style: {} };
    return {
      style: { [fam.variable]: value },
      ...(fam.claim === null || !claims.has(fam.claim) ? { marker: fam.marker } : {}),
    };
  }
  return null;
}

/** `size-[Npx]` / `fontfam-[…]` / the TEXT_VARS families → the variable, plus the
 *  property itself unless the region has claimed it. Returns `{}` for a token whose
 *  payload is refused, so a malformed one is inert rather than falling through to the
 *  class list. */
function variableToken(
  token: string,
  claims: Set<string>,
): Record<string, string> | null {
  let m = token.match(/^size-\[(\d{1,4})px\]$/);
  if (m) {
    const style: Record<string, string> = { "--lse-size": sizeLength(Number(m[1])) };
    if (!claims.has("size")) style.fontSize = "var(--lse-size)";
    return style;
  }
  m = token.match(/^fontfam-\[(.+)\]$/);
  if (m) {
    const value = fontFamilyValue(m[1]);
    if (!value) return {};
    const style: Record<string, string> = { "--lse-font": value };
    if (!claims.has("font")) style.fontFamily = "var(--lse-font)";
    return style;
  }
  for (const fam of TEXT_VARS) {
    const hit = token.match(fam.re);
    if (!hit) continue;
    const value = fam.parse(hit[1]);
    if (value == null) return {};
    const style: Record<string, string> = { [fam.variable]: value };
    if (!claims.has(fam.claim)) style[fam.camel] = `var(${fam.variable})`;
    return style;
  }
  return null;
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

/* ── DELTA OVERRIDES (0.24.0) — the end of the frozen region ─────────────────────────
 * A section override used to REPLACE the base wholesale, freezing a styled region at
 * the design of that day (CONNECTING.md's oldest rough edge; three 2026-08-17 review
 * findings traced to it). A stored override is now a DELTA: the sentinel `lse-delta`
 * plus only the tokens the manager changed. Rendering keeps every base token whose
 * FAMILY the delta does not touch — layout, hook classes, claims — and swaps in the
 * delta's families. `lse-not-[fam]` is an explicit removal: strip the base's family,
 * apply nothing (a toggle turned OFF against a base that had it ON).
 *
 * Legacy full-string rows (no sentinel) keep replace semantics forever; the editor
 * rewrites each as a delta the next time it is edited. */

export const DELTA_SENTINEL = "lse-delta";
const NOT_TOKEN = /^lse-not-\[([a-z]+)\]$/;

/** Is this stored string a delta? The sentinel leads by construction, but membership is
 *  enough — an editor that reordered tokens must not silently flip semantics. */
export function isDeltaOverride(stored: string): boolean {
  return stored.split(/\s+/).includes(DELTA_SENTINEL);
}

const NAMED_SIZES = new Set([
  "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl",
]);
const ALIGN_WORDS = new Set(["left", "center", "right", "justify", "start", "end"]);
const NON_COLOR_TEXT = new Set([
  ...NAMED_SIZES, ...ALIGN_WORDS, "wrap", "nowrap", "balance", "pretty", "ellipsis", "clip",
]);
const WEIGHT_WORDS = new Set([
  "thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black",
]);

/**
 * The FAMILY a token belongs to — the unit a delta replaces — or null for a token the
 * editor does not own (layout, hook classes, site vocabulary), which a delta must
 * always keep from the base. Spans BOTH eras of every control: the value tokens the
 * editor writes now and the classes it wrote before, because a base legitimately wears
 * either.
 */
export function familyOf(raw: string): string | null {
  const t = raw.replace(/^!/, "");
  if (t === DELTA_SENTINEL || CLAIM_TOKEN.test(t)) return null;
  const not = t.match(NOT_TOKEN);
  if (not) return not[1];

  // Mobile twins first: their prefix embeds the family (`sizesm`, `scalesm`, …).
  const sm = t.match(/^([a-z]+)sm-\[/);
  if (sm) return `${sm[1]}sm`;

  // Bracketed forms. The `text-[…]` shape is three families wearing one prefix.
  const arb = t.match(/^([a-z]+)-\[(.+)\]$/);
  if (arb) {
    const [, prefix, payload] = arb;
    if (prefix === "text")
      return payload.startsWith("#") ? "textColor" : "size";
    if (prefix === "bg") return payload.startsWith("#") ? "bgColor" : null;
    if (prefix === "border")
      return payload.startsWith("#") ? "borderColor" : "borderWidth";
    if (prefix === "leading") return "leading";
    if (prefix === "tracking") return "tracking";
    if (prefix === "rounded") return "radius";
    if (prefix === "tilt") return "tilt";
    if (prefix === "soften") return "soften";
    if (prefix === "feather") return "feather";
    if (prefix === "textstroke") return "textstroke";
    if (prefix === "decothick") return "decothick";
    if (prefix === "underoffset") return "underoffset";
    // Value-token prefixes whose class-era twins already named the family.
    if (prefix === "fontfam") return "font";
    if (prefix === "lead") return "leading";
    if (prefix === "track") return "tracking";
    if (prefix === "fstyle") return "italic";
    if (prefix === "enterdur") return "enterdur";
    if (prefix === "enterdist") return "enterdist";
    if (prefix === "speed") return "speed";
    // Every remaining bracketed prefix is its own single-family vocabulary:
    // size, fontfam, weight, align, lead, track, case, fstyle, pad, pady, gap, just,
    // secw, sech, maxw, iconsize, hovercolor, frost, decocolor, textgrad, bggrad.
    return prefix;
  }

  // Named classes, oldest era.
  if (t.startsWith("font-"))
    return WEIGHT_WORDS.has(t.slice(5)) ? "weight" : "font";
  if (t.startsWith("text-")) {
    const suffix = t.slice(5);
    if (NAMED_SIZES.has(suffix)) return "size";
    if (ALIGN_WORDS.has(suffix)) return "align";
    if (NON_COLOR_TEXT.has(suffix)) return null; // wrapping etc — not a control's
    return "textColor"; // a palette class (text-foreground, text-ink/60)
  }
  if (t.startsWith("bg-")) return "bgColor";
  if (t.startsWith("leading-")) return "leading";
  if (t.startsWith("tracking-")) return "tracking";
  if (t === "uppercase" || t === "lowercase" || t === "capitalize" || t === "normal-case") return "case";
  if (t === "italic" || t === "not-italic") return "italic";
  if (t === "underline") return "underline";
  if (t === "line-through") return "strike";
  if (t === "border" || /^border-(0|2|4|8)$/.test(t)) return "borderWidth";
  if (t === "rounded" || /^rounded-(none|sm|md|lg|xl|2xl|3xl|full)$/.test(t)) return "radius";
  if (/^shadow(-|$)/.test(t)) return "shadow";
  if (/^scale-\d/.test(t)) return "scale";
  if (/^opacity-\d/.test(t)) return "opacity";
  const filter = t.match(/^(bw|sepia|brightness|contrast|saturate)-\d/);
  if (filter) return filter[1];
  if (/^textshadow-/.test(t)) return "textshadow";
  if (/^textglow-/.test(t)) return "textglow";
  if (/^(shape)-/.test(t)) return "shape";
  if (/^fit-/.test(t)) return "fit";
  return null;
}

/** The delta applied to a base: keep every base token whose family the delta does not
 *  name, then the delta's own tokens (removals excluded — their work is the strip). */
function applyDelta(base: string, stored: string): string {
  const deltaTokens = stored.split(/\s+/).filter((t) => t && t !== DELTA_SENTINEL);
  const touched = new Set<string>();
  for (const t of deltaTokens) {
    const fam = familyOf(t);
    if (fam) touched.add(fam);
  }
  const kept = base.split(/\s+/).filter((t) => {
    if (!t) return false;
    const fam = familyOf(t);
    return fam === null || !touched.has(fam);
  });
  const applied = deltaTokens.filter((t) => !NOT_TOKEN.test(t));
  return [...kept, ...applied].join(" ");
}

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
  if (!isItemKey(key))
    return isDeltaOverride(override) ? applyDelta(base, override) : override;
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

/* ── Slice-1 visual effects (2026-08-10). All lift inline, so every already-deployed
 * site gets them the moment the editor offers them. The six FILTER families share one
 * CSS property, so they return PARTS that resolveTokens composes into a single
 * `filter` value — Object.assign would keep only the last one. */

/** `<token>` → a filter function, or null. Order of application follows token order in
 *  the stored string, which is stable: the editor rewrites the whole string per change. */
function filterPart(token: string): string | null {
  let m = token.match(/^bw-(\d{1,3})$/);
  if (m) return `grayscale(${Math.min(100, Number(m[1]))}%)`;
  m = token.match(/^sepia-(\d{1,3})$/);
  if (m) return `sepia(${Math.min(100, Number(m[1]))}%)`;
  m = token.match(/^brightness-(\d{1,3})$/);
  if (m) return `brightness(${m[1]}%)`;
  m = token.match(/^contrast-(\d{1,3})$/);
  if (m) return `contrast(${m[1]}%)`;
  m = token.match(/^saturate-(\d{1,3})$/);
  if (m) return `saturate(${m[1]}%)`;
  m = token.match(/^soften-\[(\d{1,2})px\]$/);
  if (m) return `blur(${m[1]}px)`;
  return null;
}

/** Tilt and crop-fit — single-property lifts. `rotate` and `scale` are their own CSS
 *  properties (not `transform`), so Size and Tilt never fight over one value. */
function mediaToken(token: string): Record<string, string> | null {
  const m = token.match(/^tilt-\[(-?\d{1,2})deg\]$/);
  if (m) return { rotate: `${m[1]}deg` };
  if (token === "fit-cover") return { objectFit: "cover" };
  if (token === "fit-contain") return { objectFit: "contain" };
  if (token === "fit-top") return { objectPosition: "top" };
  if (token === "fit-bottom") return { objectPosition: "bottom" };
  if (token === "fit-left") return { objectPosition: "left" };
  if (token === "fit-right") return { objectPosition: "right" };
  return null;
}

/** Depth n (1–8) → a black shadow growing in offset, blur and weight together, so the
 *  slider reads as "more" in one direction. Deliberately assertive at the top end —
 *  the first curve maxed at an alpha a light page barely showed (Sam, 2026-08-10:
 *  "I dont see the text shadow doing anything"). */
function textShadowDepth(n: number): string {
  return `0 ${n}px ${n * 2}px rgb(0 0 0 / ${(0.3 + n * 0.08).toFixed(2)})`;
}

/** Glow n (1–8) → a two-layer currentColor halo; the second layer is what makes the
 *  high end read as bloom rather than blur. */
function textGlowDepth(n: number): string {
  return `0 0 ${n * 2}px currentColor, 0 0 ${n * 6}px currentColor`;
}

/** A text-shadow LAYER for one token, or null. Shadow and glow both live in the one
 *  `text-shadow` property, which takes a list — so like the filters, they are collected
 *  and COMPOSED, never assigned over each other. */
function textShadowPart(token: string): string | null {
  let m = token.match(/^textshadow-([1-9]|1[0-2])$/);
  if (m) return textShadowDepth(Number(m[1]));
  m = token.match(/^textglow-([1-9]|1[0-2])$/);
  if (m) return textGlowDepth(Number(m[1]));
  return null;
}

const CLIP_SHAPES: Record<string, string> = {
  "shape-circle": "circle(50% at 50% 50%)",
  "shape-arch": "inset(0 round 999px 999px 0 0)",
  "shape-pill": "inset(0 round 999px)",
  "shape-diagonal": "polygon(0 0, 100% 6%, 100% 100%, 0 94%)",
};

/** Slice-2 ITEM lifts: cutout shapes and feathered edges. */
function shapeToken(token: string): Record<string, string> | null {
  if (token in CLIP_SHAPES) return { clipPath: CLIP_SHAPES[token] };
  const m = token.match(/^feather-(\d{1,2})$/);
  if (m) {
    // A mask that holds full ink until (100-N)% of the way out, then fades — reads as
    // the photo dissolving into the page. Both spellings: Safari still prefixes.
    const mask = `radial-gradient(closest-side, #000 ${100 - Number(m[1])}%, transparent 100%)`;
    return { maskImage: mask, WebkitMaskImage: mask };
  }
  return null;
}

const HEX_PAIR = /^\[(#[0-9a-fA-F]{3,8})_(#[0-9a-fA-F]{3,8})\]$/;

/**
 * Slice-2 SECTION-safe lifts: decorations, gradients, frost, padding. Section context
 * included for the same reason as the text effects — these tokens are editor-invented,
 * so left as classes they would be silent no-ops everywhere.
 */
function sectionEffectStyle(token: string): Record<string, string> | null {
  if (token === "underline" || token === "line-through")
    return { textDecorationLine: token }; // composed below — the two can coexist
  let m = token.match(/^textgrad-(.+)$/);
  if (m) {
    const pair = m[1].match(HEX_PAIR);
    if (!pair) return null;
    // Clip the gradient to the glyphs. `color: transparent` lets it show through;
    // WebkitTextFillColor beats any inherited fill on WebKit.
    return {
      backgroundImage: `linear-gradient(135deg, ${pair[1]}, ${pair[2]})`,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      WebkitTextFillColor: "transparent",
    };
  }
  m = token.match(/^bggrad-(.+)$/);
  if (m) {
    const pair = m[1].match(HEX_PAIR);
    if (!pair) return null;
    return { backgroundImage: `linear-gradient(135deg, ${pair[1]}, ${pair[2]})` };
  }
  m = token.match(/^decocolor-\[(#[0-9a-fA-F]{3,8})\]$/);
  if (m) return { textDecorationColor: m[1] };
  // Sub-pixel thickness and negative offset are the LEFT half of the centred sliders.
  m = token.match(/^decothick-\[(\d{1,2}(?:\.\d{1,2})?)px\]$/);
  if (m) return { textDecorationThickness: `${m[1]}px` };
  m = token.match(/^underoffset-\[(-?\d{1,2})px\]$/);
  if (m) return { textUnderlineOffset: `${m[1]}px` };
  // Entrance speed rides a custom property the effects rules read — the class stays
  // compiled CSS, the knob lifts inline like every other slider.
  m = token.match(/^enterdur-\[(\d{3,4})ms\]$/);
  if (m) return { "--lse-enter-duration": `${m[1]}ms` };
  // Entrance travel rides its own property the same way; vw is the "screen edge" step.
  m = token.match(/^enterdist-\[(\d{1,4})(px|vw)\]$/);
  if (m) return { "--lse-enter-distance": `${m[1]}${m[2]}` };
  // Hover colour: the hex lifts here, the `hovercolor` marker class (compiled) applies
  // it on :hover — inline styles cannot express pseudo-classes.
  m = token.match(/^hovercolor-\[(#[0-9a-fA-F]{3,8})\]$/);
  if (m) return { "--lse-hover-color": m[1] };
  m = token.match(/^frost-\[(\d{1,2})px\]$/);
  if (m) return { backdropFilter: `blur(${m[1]}px)`, WebkitBackdropFilter: `blur(${m[1]}px)` };
  m = token.match(/^pad-\[(\d{1,3})px\]$/);
  if (m) return { padding: `${m[1]}px` };
  // Vertical-only padding (the page band + chrome bars): top/bottom longhands, so a
  // base's horizontal padding (a bar's `px-6` side gutters) survives underneath.
  m = token.match(/^pady-\[(\d{1,3})px\]$/);
  if (m) return { paddingTop: `${m[1]}px`, paddingBottom: `${m[1]}px` };
  // Content width: the cap on a centred content column (the site's max-w-* container).
  // A px cap because the base's own cap is one (max-w-3xl = 768px); auto margins keep
  // the column centred even on a base that lost its mx-auto. `maxw-full` releases the
  // cap entirely — full-bleed content inside the page band.
  if (token === "maxw-full") return { maxWidth: "none" };
  m = token.match(/^maxw-\[(\d{3,4})px\]$/);
  if (m) return { maxWidth: `${m[1]}px`, marginLeft: "auto", marginRight: "auto" };
  // Section geometry: width narrows AND centres the band (auto margins — the page
  // shows at the sides); height is a FLOOR, so content can still grow past it.
  m = token.match(/^secw-\[(\d{1,3})%\]$/);
  if (m) return { width: `${m[1]}%`, marginLeft: "auto", marginRight: "auto" };
  m = token.match(/^sech-\[(\d{1,4})px\]$/);
  if (m) return { minHeight: `${m[1]}px` };
  // Block alignment: orient a content-sized row (the hero name + portrait) left / centre
  // / right. justify-content positions the packed tracks, so it only shows once the
  // region's columns are auto-sized rather than 1fr-filling the width.
  m = token.match(/^just-\[(start|center|end)\]$/);
  if (m) return { justifyContent: m[1] };
  // The gutter between a region's items (grid/flex gap) — the hero name↔portrait space.
  m = token.match(/^gap-\[(\d{1,3})px\]$/);
  if (m) return { gap: `${m[1]}px` };
  // Icon size for an icon group: a CSS var the group's icons read, so one value scales
  // them all together (the socials row). The icons opt in by sizing off the var.
  m = token.match(/^iconsize-\[(\d{1,3})px\]$/);
  if (m) return { "--lse-icon-size": `${m[1]}px` };
  return null;
}

/**
 * Text-effect tokens — shadow and stroke. Lifted in BOTH contexts, sections included:
 * the section path otherwise lifts colours only (its vocabulary is the site's own
 * compiled classes), but these tokens are editor-invented — no site compiles
 * `textshadow-soft` — so left as classes they would be silent no-ops on every region.
 */
function textEffectStyle(token: string): Record<string, string> | null {
  // The legacy single glow stop (shipped for a day in 0.5.0) resolves as glow 5, so a
  // stored string from that build keeps its look instead of going dark.
  if (token === "textshadow-glow") return { textShadow: textGlowDepth(5) };
  const m = token.match(/^textstroke-\[(\d(?:\.5)?)px\]$/);
  if (m) return { WebkitTextStroke: `${m[1]}px currentColor` };
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
  "filter",
  "rotate",
  "object-fit",
  "object-position",
  "text-shadow",
  "-webkit-text-stroke",
  "text-decoration-line",
  "text-decoration-color",
  "text-decoration-thickness",
  "text-underline-offset",
  "background-image",
  "-webkit-background-clip",
  "background-clip",
  "-webkit-text-fill-color",
  "clip-path",
  "mask-image",
  "-webkit-mask-image",
  "backdrop-filter",
  "-webkit-backdrop-filter",
  "padding",
  "padding-top",
  "padding-bottom",
  "justify-content",
  "gap",
  "--lse-enter-duration",
  "--lse-enter-distance",
  "--lse-hover-color",
  "--lse-icon-size",
  "width",
  "margin-left",
  "margin-right",
  "min-height",
  "max-width",
  "font-size",
  "font-family",
  "--lse-size",
  "--lse-font",
  "font-weight",
  "text-align",
  "line-height",
  "letter-spacing",
  "text-transform",
  "font-style",
  "--lse-weight",
  "--lse-align",
  "--lse-leading",
  "--lse-tracking",
  "--lse-case",
  "--lse-fontstyle",
  "--lse-size-m",
  "--lse-pad-m",
  "--lse-gap-m",
  "--lse-weight-m",
  "--lse-align-m",
  "--lse-leading-m",
  "--lse-tracking-m",
  "--lse-case-m",
  "--lse-fontstyle-m",
  "--lse-scale-m",
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
function resolveTokens(
  classString: string,
  liftAll: boolean,
  claims: Set<string> = new Set(),
): ResolvedStyle {
  const classes: string[] = [];
  const style: Record<string, string> = {};
  const filters: string[] = [];
  const textShadows: string[] = [];
  const decorations: string[] = [];
  let playbackRate: number | undefined;
  for (const token of classString.split(/\s+/).filter(Boolean)) {
    // The claim marker is a DECLARATION, not CSS — no site compiles it, and leaving it
    // in the class list would put a dead token in the public page's markup.
    if (CLAIM_TOKEN.test(token)) continue;
    // Mobile tokens first: they contribute a CLASS as well as style, which no other
    // family does — routing them through `inline` would drop the marker.
    const mobile = mobileToken(token, claims);
    if (mobile) {
      Object.assign(style, mobile.style);
      if (mobile.marker) classes.push(mobile.marker);
      continue;
    }
    const decoration = token === "underline" || token === "line-through" ? token : null;
    const inline =
      colorStyle(token) ??
      variableToken(token, claims) ??
      textEffectStyle(token) ??
      (decoration ? null : sectionEffectStyle(token)) ??
      (liftAll ? (inlineToken(token) ?? mediaToken(token) ?? shapeToken(token)) : null);
    const shadowLayer = textShadowPart(token); // both contexts — sections carry these too
    const filter = liftAll ? filterPart(token) : null;
    const speed = liftAll ? speedRate(token) : null;
    if (decoration) decorations.push(decoration);
    else if (inline) Object.assign(style, inline);
    else if (shadowLayer) textShadows.push(shadowLayer);
    else if (filter) filters.push(filter);
    else if (speed != null) playbackRate = speed;
    else classes.push(token);
  }
  // Composed LAST: each of these families shares one property, and per-token
  // assignment would keep only whichever token happened to be written down first.
  if (filters.length) style.filter = filters.join(" ");
  if (textShadows.length) style.textShadow = textShadows.join(", ");
  // Underline and strikethrough COEXIST in the one property, space-separated.
  if (decorations.length) style.textDecorationLine = decorations.join(" ");
  return {
    className: classes.join(" "),
    style,
    ...(playbackRate != null ? { playbackRate } : {}),
  };
}

/* ── The token GRAMMAR, exported for the EDITOR side (moved from lone-star's
 * style-apply.ts, 2026-08-07): everything that reads or writes the arbitrary-colour
 * and speed tokens — `owns` matchers in the style controls, the item editor's
 * constructor — goes through these instead of re-spelling the regexes. The same
 * regexes drive the lift above, so the writer and the resolver can never disagree. */

/** The CSS property one of the editor's managed colour tokens sets (camelCase — the
 *  editor compares against these; the DOM clear-list MANAGED_STYLE_PROPS is the
 *  kebab-case twin used with style.setProperty/removeProperty). */
export type ManagedColorProp = "borderColor" | "color" | "backgroundColor";

/** `<prefix>-[#hex]` → its CSS property + hex, or null if not an arbitrary colour. */
export function colorToken(token: string): { prop: ManagedColorProp; value: string } | null {
  const m = token.match(/^([a-z]+)-\[(#[0-9a-fA-F]{3,8})\]$/);
  const prop = m ? COLOR_PROPS[m[1]] : undefined;
  return m && prop ? { prop, value: m[2] } : null;
}

/** The arbitrary-colour utility for a prefix — the write half of `colorToken`. */
export function colorClass(prefix: "border" | "text" | "bg", hex: string): string {
  return `${prefix}-[${hex}]`;
}

/** `speed-[<rate>x]` → the playback rate it sets, or null (malformed or outside what a
 *  media element accepts — an out-of-range token stays an inert class rather than
 *  throwing mid-apply). The write half is the editor's own template literal. */
export function speedToken(token: string): number | null {
  return speedRate(token);
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
  // From the BASE, before the merge: a section override REPLACES the base, so a claim
  // read out of the merged string would vanish the moment a manager styled the region.
  const claims = claimedProps(base);
  // The two size scopes stay fully independent — desktop on --lse-size, phone on
  // --lse-size-m, joined only by the media rules that read them. Fusion (0.20.x)
  // blended them across a 390-1024px slope instead, and every not-fullscreen laptop sat
  // on it: the phone pick kept a hand in "desktop" (Sam, live, twice). Discrete beats
  // fluid here because each editor view must edit exactly what it shows.
  if (!isItemKey(key))
    return resolveTokens(mergeStyle(key, base, override), false, claims);
  const lifted = resolveTokens(override.trim(), true, claims);
  const kept = base
    .split(/\s+/)
    .filter((t) => t && !CLAIM_TOKEN.test(t))
    .join(" ");
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
 * `base` is REQUIRED here — the registry is site design, not contract, and a package
 * default would smuggle one site's look into every site. Sites do not call this raw
 * form: `bindSiteRegistry({ regionBase })` (./bind) returns it pre-bound, alongside
 * the frame mount, so the registry is bound exactly ONCE (the 2026-08-07 deepening —
 * this docblock used to print a wrapper recipe for each site to hand-write, which was
 * shipping instructions where an interface belonged).
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
