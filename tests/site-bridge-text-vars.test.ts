// @vitest-environment jsdom
/**
 * The SECOND wave of the CSS-variable migration (CONNECTING.md §5): the six remaining
 * text controls, same recipe as size/font. Each token lifts to a variable AND inlines
 * the property (so a site that opts into nothing renders identically); a region claims
 * a property in its BASE to get only the variable.
 *
 *   weight-[700]        → --lse-weight     / font-weight
 *   align-[center]      → --lse-align      / text-align
 *   lead-[1.25]         → --lse-leading    / line-height   (unitless ratio)
 *   track-[-0.04em]     → --lse-tracking   / letter-spacing
 *   case-[uppercase]    → --lse-case       / text-transform
 *   fstyle-[italic]     → --lse-fontstyle  / font-style
 *
 * One bonus over the class forms: leading needed Tailwind's `!` prefix because text-*
 * size utilities set line-height too and a parent could pin it at higher specificity.
 * Inline needs neither — it beats both by construction.
 */
import { describe, expect, it } from "vitest";
import { createStyleApplier } from "@samfox1/site-bridge/frame";
import { MANAGED_STYLE_PROPS, resolveRegionStyle } from "@samfox1/site-bridge";

/** token → [variable, property, inline value] — the whole matrix, driven as data so a
 *  family added later must join the table rather than getting its own half-tests. */
const FAMILIES: [string, string, keyof CSSStyleDeclaration & string, string][] = [
  ["weight-[700]", "--lse-weight", "fontWeight", "700"],
  ["align-[center]", "--lse-align", "textAlign", "center"],
  ["lead-[1.25]", "--lse-leading", "lineHeight", "1.25"],
  ["track-[-0.04em]", "--lse-tracking", "letterSpacing", "-0.04em"],
  ["case-[uppercase]", "--lse-case", "textTransform", "uppercase"],
  ["fstyle-[italic]", "--lse-fontstyle", "fontStyle", "italic"],
];

/** The claim key for each family (italic's property is font-style; its claim reads as
 *  the control the manager knows). */
const CLAIM: Record<string, string> = {
  "weight-[700]": "weight",
  "align-[center]": "align",
  "lead-[1.25]": "leading",
  "track-[-0.04em]": "tracking",
  "case-[uppercase]": "case",
  "fstyle-[italic]": "italic",
};

describe("each token sets its variable AND its property, unclaimed", () => {
  for (const [token, variable, prop, value] of FAMILIES) {
    it(token, () => {
      const { style, className } = resolveRegionStyle("r", "grid", token);
      expect(style[variable]).toBe(value);
      expect(style[prop]).toBe(`var(${variable})`);
      // Editor vocabulary — no site compiles it, so it must never survive as a class.
      expect(className).toBe("");
    });
  }
});

describe("a claim suppresses the property, keeps the variable", () => {
  for (const [token, variable, prop, value] of FAMILIES) {
    it(`${CLAIM[token]} claimed`, () => {
      const { style } = resolveRegionStyle("r", `grid lse-owns-[${CLAIM[token]}]`, token);
      expect(style[variable]).toBe(value);
      expect(style[prop]).toBeUndefined();
    });
  }

  it("claims stay per-property across the whole set", () => {
    const { style } = resolveRegionStyle(
      "r",
      "grid lse-owns-[weight,case]",
      "weight-[700] case-[uppercase] align-[center]",
    );
    expect(style.fontWeight).toBeUndefined();
    expect(style.textTransform).toBeUndefined();
    expect(style.textAlign).toBe("var(--lse-align)"); // unclaimed — still inlined
  });
});

describe("malformed payloads are inert, not classes", () => {
  it("rejects out-of-range and junk values", () => {
    for (const bad of [
      "weight-[1000]", "weight-[abc]",
      "align-[banana]",
      "lead-[abc]", "lead-[99]",
      "track-[4em]", "track-[red]",
      "case-[blink]",
      "fstyle-[wavy]",
    ]) {
      const { style, className } = resolveRegionStyle("r", "grid", `flex ${bad}`);
      expect(Object.keys(style), bad).toEqual([]);
      expect(className, bad).toBe("flex");
    }
  });
});

describe("the live re-apply path", () => {
  it("clears every family when the manager removes them", () => {
    document.body.innerHTML = `<section data-lse-style="r" class="grid"></section>`;
    const el = document.querySelector("section") as HTMLElement;
    const { applyStyleToDom: apply } = createStyleApplier({ regionBase: () => "grid" });
    apply(document.body, "r", FAMILIES.map(([t]) => t).join(" "));
    expect(el.style.getPropertyValue("font-weight")).toBe("var(--lse-weight)");

    apply(document.body, "r", "");
    for (const [, variable, , ] of FAMILIES) {
      expect(el.style.getPropertyValue(variable), variable).toBe("");
    }
    expect(el.style.getPropertyValue("text-transform")).toBe("");
    expect(el.style.getPropertyValue("line-height")).toBe("");
  });

  it("declares every property it writes in the clear-list", () => {
    for (const p of [
      "font-weight", "text-align", "line-height", "letter-spacing",
      "text-transform", "font-style",
      "--lse-weight", "--lse-align", "--lse-leading", "--lse-tracking",
      "--lse-case", "--lse-fontstyle",
    ]) {
      expect(MANAGED_STYLE_PROPS).toContain(p);
    }
  });
});
