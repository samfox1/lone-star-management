// @vitest-environment jsdom
/**
 * SIZE and FONT as CSS CUSTOM PROPERTIES — the migration CONNECTING.md §5 describes.
 *
 * A class-writing control beats the site's breakpoints: the class lands in the merged
 * string, and a section override REPLACES the base, so the `md:text-6xl` the site wrote
 * is simply gone. A variable inverts that — the editor supplies a value, the site writes
 * the rule that reads it and can still shrink it on a phone.
 *
 * Two halves are pinned here:
 *   - the TOKENS (`size-[Npx]`, `fontfam-[…]`) lift to `--lse-size` / `--lse-font`, and
 *     inline the property TOO, so a site that does nothing renders exactly as it does
 *     today;
 *   - the CLAIM (`lse-owns-[size]` in a region's BASE) suppresses that inline property,
 *     handing the site back sole authority over how the value behaves at each width.
 *
 * The claim is read from the BASE, never the merged string, because a section override
 * replaces the base — a claim that lived in the merged string would evaporate the moment
 * a manager styled the region, which is the exact failure shape this file exists to stop.
 */
import { describe, expect, it } from "vitest";
import { createStyleApplier } from "@samfox1/site-bridge/frame";
import {
  MANAGED_STYLE_PROPS,
  TEXT_SIZES,
  fontFamilyValue,
  resolveRegionStyle,
  sizeLength,
} from "@samfox1/site-bridge";

/** The ladder's own clamp for a desktop px, DERIVED from TEXT_SIZES rather than
 *  hand-listed — a future step added to the ladder must be covered here automatically
 *  (AGENTS.md rule 4). */
const ladder = new Map(
  TEXT_SIZES.map((o) => [
    Number(o.label.replace("px", "")),
    o.value.replace(/^text-\[/, "").replace(/\]$/, ""),
  ]),
);

describe("size-[Npx] → --lse-size", () => {
  it("lifts a ladder size to the ladder's own clamp, unchanged", () => {
    // Pixel-identical to what `text-[clamp(…)]` renders today: the migration must not
    // move a single already-styled headline.
    for (const [px, clamp] of ladder) {
      expect(sizeLength(px)).toBe(clamp);
    }
  });

  it("derives a fluid clamp for a size the ladder does not carry", () => {
    const v = sizeLength(50);
    expect(v).toMatch(/^clamp\(.+,.+vw,50px\)$/);
    // Fluid, not fixed — the whole point. A site's own base size is almost never a step.
    expect(v).not.toBe("50px");
  });

  it("sets the variable AND the property on an unclaimed region", () => {
    const { style, className } = resolveRegionStyle("hero", "grid", "size-[48px]");
    expect(style["--lse-size"]).toBe(ladder.get(48));
    expect(style.fontSize).toBe("var(--lse-size)");
    // The token is editor vocabulary; no site compiles it, so it must never survive as
    // a class.
    expect(className).not.toContain("size-[48px]");
  });

  it("sets ONLY the variable when the region's base claims size", () => {
    const { style } = resolveRegionStyle("hero", "grid lse-owns-[size]", "size-[48px]");
    expect(style["--lse-size"]).toBe(ladder.get(48));
    expect(style.fontSize).toBeUndefined();
  });

  it("honours the claim after an override has replaced the base", () => {
    // A section override REPLACES the base, so the claim exists nowhere in the string
    // the element renders. Read from the base argument or this returns to inline.
    const { style } = resolveRegionStyle(
      "hero",
      "grid lse-owns-[size]",
      "text-white size-[36px]",
    );
    expect(style.fontSize).toBeUndefined();
    expect(style["--lse-size"]).toBe(ladder.get(36));
  });

  it("keeps the claim marker out of the rendered class list", () => {
    const fromBase = resolveRegionStyle("hero", "grid lse-owns-[size]", "");
    expect(fromBase.className).toBe("grid");
    // Also when a stale claim rides an override — the class is not real CSS anywhere.
    const fromOverride = resolveRegionStyle("hero", "grid", "flex lse-owns-[size]");
    expect(fromOverride.className).toBe("flex");
  });

  it("claims are per-property: owning size does not release font", () => {
    const { style } = resolveRegionStyle(
      "hero",
      "grid lse-owns-[size]",
      "size-[48px] fontfam-[Momo_Display,serif]",
    );
    expect(style.fontSize).toBeUndefined();
    expect(style.fontFamily).toBe("var(--lse-font)");
  });
});

describe("fontfam-[…] → --lse-font", () => {
  it("decodes the underscore convention into a real font stack", () => {
    const { style } = resolveRegionStyle("hero", "grid", "fontfam-[Momo_Display,serif]");
    expect(style["--lse-font"]).toBe("'Momo Display', serif");
    expect(style.fontFamily).toBe("var(--lse-font)");
  });

  it("sets only the variable when the base claims font", () => {
    const { style } = resolveRegionStyle(
      "hero",
      "grid lse-owns-[font]",
      "fontfam-[Momo_Display,serif]",
    );
    expect(style["--lse-font"]).toBe("'Momo Display', serif");
    expect(style.fontFamily).toBeUndefined();
  });

  it("rejects a stack carrying anything but a family name", () => {
    // The family name is a CSS-injection sink: it reaches a style attribute verbatim.
    // A rejected token yields NO style and NO class — inert in both directions.
    for (const bad of [
      "fontfam-[url(evil.css)]",
      "fontfam-[a;color:red]",
      "fontfam-[a}body{display:none]",
      "fontfam-[expression(alert(1))]",
    ]) {
      const { style, className } = resolveRegionStyle("hero", "grid", `flex ${bad}`);
      expect(style["--lse-font"]).toBeUndefined();
      expect(style.fontFamily).toBeUndefined();
      // The override replaced the base, so `flex` is all that should remain — the
      // refused token neither styles nor survives as a class.
      expect(className).toBe("flex");
    }
  });

  it("quotes each family but never a generic keyword", () => {
    // `font-family: 'serif'` asks for a font actually NAMED serif and silently falls back
    // to the browser default — the one case where quoting everything is wrong.
    expect(fontFamilyValue("Momo_Display,_sans-serif")).toBe("'Momo Display', sans-serif");
    expect(fontFamilyValue("Inter,_system-ui,_monospace")).toBe("'Inter', system-ui, monospace");
  });

  it("refuses a token carrying its own quotes", () => {
    // The editor strips them before writing, and `cleanClassText` refuses to store one,
    // so a quoted token can only be something that did not come through either — it must
    // not reach a style attribute.
    expect(fontFamilyValue('"Momo_Display",_serif')).toBeNull();
  });

  it("refuses a stack long enough to be a payload rather than a name", () => {
    expect(fontFamilyValue("a".repeat(201))).toBeNull();
  });
});

describe("the live re-apply path", () => {
  /** The DOM half: a site already rendered, restyled through the frame bridge. The pure
   *  function above could be right while the applier still left a stale property behind. */
  const mount = (base: string) => {
    document.body.innerHTML = `<section data-lse-style="hero" class="${base}"></section>`;
    return document.querySelector("section") as HTMLElement;
  };

  it("clears size and font when the manager removes them", () => {
    const el = mount("grid");
    const { applyStyleToDom: apply } = createStyleApplier({ regionBase: () => "grid" });
    apply(document.body, "hero", "size-[48px] fontfam-[Momo_Display,serif]");
    expect(el.style.getPropertyValue("font-size")).toBe("var(--lse-size)");

    apply(document.body, "hero", "");
    expect(el.style.getPropertyValue("font-size")).toBe("");
    expect(el.style.getPropertyValue("font-family")).toBe("");
    expect(el.style.getPropertyValue("--lse-size")).toBe("");
    expect(el.style.getPropertyValue("--lse-font")).toBe("");
  });

  it("respects a claimed base live, not only at render", () => {
    const el = mount("grid lse-owns-[size]");
    const { applyStyleToDom: apply } = createStyleApplier({
      regionBase: () => "grid lse-owns-[size]",
    });
    apply(document.body, "hero", "size-[48px]");
    expect(el.style.getPropertyValue("--lse-size")).toBe(ladder.get(48));
    expect(el.style.getPropertyValue("font-size")).toBe("");
    expect(el.getAttribute("class")).not.toContain("lse-owns");
  });

  it("declares every property it writes, so a removal can clear it", () => {
    // A property written but missing from the clear-list is a value nothing can take
    // back — the failure mode MANAGED_STYLE_PROPS exists to prevent.
    for (const prop of ["font-size", "font-family", "--lse-size", "--lse-font"]) {
      expect(MANAGED_STYLE_PROPS).toContain(prop);
    }
  });
});
