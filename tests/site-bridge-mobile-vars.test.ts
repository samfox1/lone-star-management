// @vitest-environment jsdom
/**
 * MOBILE OVERRIDES (bridge 0.19.0) — the plan agreed 2026-08-17: editing in the
 * editor's phone view sets a SECOND, phone-only value. Two tokens:
 *
 *   sizesm-[18px] → --lse-size-m   (font-size below 640px)
 *   padsm-[12px]  → --lse-pad-m    (padding below 640px)
 *
 * The mechanism differs from the desktop tokens because INLINE STYLES CANNOT EXPRESS
 * @media. So the token sets the variable inline, and the element gains a marker class
 * (`lse-msize` / `lse-mpad`) that a rule in the package's own tokens.css reads inside
 * its media query — with !important, because it must beat the inline desktop
 * `font-size: var(--lse-size)` on the same element.
 *
 * A region that CLAIMS size gets the variable only, and NO marker class: the site's own
 * media query reads var(--lse-size-m, var(--lse-size, …)) and keeps owning where
 * "mobile" begins. The package rule would beat the site's phone cap otherwise.
 *
 * The value is an EXACT px, not a clamp: the manager chose it while looking at a phone.
 */
import { describe, expect, it } from "vitest";
import { createStyleApplier } from "@samfox1/site-bridge/frame";
import { MANAGED_STYLE_PROPS, resolveRegionStyle } from "@samfox1/site-bridge";
import { buildTokensCss } from "../scripts/generate-bridge-tokens";

describe("sizesm-[Npx] on an UNCLAIMED region", () => {
  it("sets the variable exactly and adds the marker class", () => {
    const { style, className } = resolveRegionStyle("r", "grid", "sizesm-[18px]");
    expect(style["--lse-size-m"]).toBe("18px");
    expect(className.split(/\s+/)).toContain("lse-msize");
    // The raw token never survives as a class.
    expect(className).not.toContain("sizesm-[18px]");
  });

  it("coexists with the desktop token — two values, one element", () => {
    const { style, className } = resolveRegionStyle("r", "grid", "size-[48px] sizesm-[18px]");
    expect(style.fontSize).toBe("var(--lse-size)");
    expect(style["--lse-size-m"]).toBe("18px");
    expect(className.split(/\s+/)).toContain("lse-msize");
  });
});

describe("sizesm-[Npx] on a CLAIMED region", () => {
  it("sets ONLY the variable — no marker class, or the package rule beats the site's cap", () => {
    const { style, className } = resolveRegionStyle(
      "r",
      "grid lse-owns-[size]",
      "size-[48px] sizesm-[18px]",
    );
    expect(style["--lse-size-m"]).toBe("18px");
    expect(style.fontSize).toBeUndefined();
    expect(className.split(/\s+/)).not.toContain("lse-msize");
  });
});

describe("padsm-[Npx]", () => {
  it("sets the variable and its marker class (padding has no claim concept)", () => {
    const { style, className } = resolveRegionStyle("r", "grid", "padsm-[12px]");
    expect(style["--lse-pad-m"]).toBe("12px");
    expect(className.split(/\s+/)).toContain("lse-mpad");
  });
});

describe("malformed payloads are inert", () => {
  it("rejects junk without leaving a class behind", () => {
    for (const bad of ["sizesm-[abc]", "sizesm-[99999px]", "padsm-[12em]", "padsm-[red]"]) {
      const { style, className } = resolveRegionStyle("r", "grid", `flex ${bad}`);
      expect(Object.keys(style), bad).toEqual([]);
      expect(className, bad).toBe("flex");
    }
  });
});

describe("the live re-apply path", () => {
  it("clears both variables and marker classes on removal", () => {
    document.body.innerHTML = `<section data-lse-style="r" class="grid"></section>`;
    const el = document.querySelector("section") as HTMLElement;
    const { applyStyleToDom: apply } = createStyleApplier({ regionBase: () => "grid" });
    apply(document.body, "r", "sizesm-[18px] padsm-[12px]");
    expect(el.classList.contains("lse-msize")).toBe(true);

    apply(document.body, "r", "");
    expect(el.style.getPropertyValue("--lse-size-m")).toBe("");
    expect(el.style.getPropertyValue("--lse-pad-m")).toBe("");
    expect(el.classList.contains("lse-msize")).toBe(false);
    expect(el.classList.contains("lse-mpad")).toBe(false);
  });

  it("declares both variables in the clear-list", () => {
    for (const p of ["--lse-size-m", "--lse-pad-m"]) {
      expect(MANAGED_STYLE_PROPS).toContain(p);
    }
  });
});

describe("tokens.css ships the media rules", () => {
  // Generated in memory the same way site-bridge-tokens.test.ts does, so the committed
  // file cannot drift from what this asserts.
  const css = buildTokensCss();

  it("reads each variable inside a max-width media query, with !important", () => {
    const media = css.match(/@media[^{]*max-width[^{]*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(media).toContain(".lse-msize");
    expect(media).toContain("var(--lse-size-m)");
    expect(media).toContain(".lse-mpad");
    expect(media).toContain("var(--lse-pad-m)");
    // !important is load-bearing: it must beat the same element's inline
    // font-size: var(--lse-size). Without it the desktop value wins on phones too.
    expect(media.match(/!important/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
