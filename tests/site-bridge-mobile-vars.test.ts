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

  it("with the desktop token present, both picks FUSE — see the fusion suite below", () => {
    // 0.19 shipped this case as marker class + --lse-size-m; 0.20 supersedes it with
    // one fused clamp (Sam's refinement). The full pinning lives in the fusion
    // describe; this stub stays so the superseded behaviour has a tombstone.
    const { style } = resolveRegionStyle("r", "grid", "size-[48px] sizesm-[18px]");
    expect(style["--lse-size"]).toContain("clamp(18px");
  });
});

describe("sizesm-[Npx] on a CLAIMED region", () => {
  it("claimed + both picks: fused variable only, never a marker class", () => {
    const { style, className } = resolveRegionStyle(
      "r",
      "grid lse-owns-[size]",
      "size-[48px] sizesm-[18px]",
    );
    expect(style["--lse-size"]).toContain("clamp(18px");
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

/* ── FUSION (0.20.0, Sam's refinement): when BOTH ends are known, the two picks become
 * one clamp — desktop pick = ceiling, phone pick = floor, fluid between. No breakpoint,
 * no marker class, no !important, no snap at 640px. The fallback machinery above
 * survives only for a phone pick with no known ceiling. */
describe("fused clamp — both ends known", () => {
  it("fuses override tokens into one clamp on --lse-size", () => {
    const { style, className } = resolveRegionStyle("r", "grid", "size-[48px] sizesm-[18px]");
    const v = style["--lse-size"];
    // Floor is the phone pick, ceiling the desktop pick, slope fluid between them.
    expect(v).toMatch(/^clamp\(18px,calc\(18px \+ 30 \* \(100vw - 390px\) \/ 634\),48px\)$/);
    expect(style.fontSize).toBe("var(--lse-size)");
    // The whole point: no phone-only machinery left on the element.
    expect(style["--lse-size-m"]).toBeUndefined();
    expect(className.split(/\s+/)).not.toContain("lse-msize");
  });

  it("a claimed region fuses too, variable only", () => {
    const { style, className } = resolveRegionStyle(
      "r",
      "grid lse-owns-[size]",
      "size-[48px] sizesm-[18px]",
    );
    expect(style["--lse-size"]).toContain("clamp(18px");
    expect(style.fontSize).toBeUndefined();
    expect(className.split(/\s+/)).not.toContain("lse-msize");
  });

  it("CRITICAL: a phone-only pick borrows the ceiling from the BASE's size token", () => {
    // The site's initial build is the default max (Sam's framing). A claimed base
    // declares size-[48px]; the manager bumps only the phone end.
    const { style } = resolveRegionStyle(
      "r",
      "grid size-[48px] lse-owns-[size]",
      "text-white sizesm-[22px]",
    );
    expect(style["--lse-size"]).toContain("clamp(22px");
    expect(style["--lse-size"]).toContain("48px)");
    expect(style["--lse-size-m"]).toBeUndefined();
  });

  it("derives the ceiling from a base size CLASS — the initial build already set it", () => {
    // Sam, 2026-08-17: "the ceiling should already be there based off of the initial
    // build." Most bases declare size as a CLASS, not a token — the fluid clamp the
    // site shipped with, or a named Tailwind size. Its max IS the default ceiling.
    const clamp = resolveRegionStyle(
      "r",
      "grid text-[clamp(1.75rem,6.5vw,3rem)]",
      "sizesm-[18px]",
    );
    expect(clamp.style["--lse-size"]).toContain("clamp(18px");
    expect(clamp.style["--lse-size"]).toContain("48px)"); // 3rem
    expect(clamp.style["--lse-size-m"]).toBeUndefined();

    const named = resolveRegionStyle("r", "grid text-sm", "sizesm-[12px]");
    expect(named.style["--lse-size"]).toContain("clamp(12px");
    expect(named.style["--lse-size"]).toContain("14px)");
  });

  it("derives it from a LEGACY stored size class in the override too", () => {
    // Pre-0.16 rows store the clamp classes; their max is the manager's own ceiling.
    const { style } = resolveRegionStyle(
      "r",
      "grid",
      "text-[clamp(1.5rem,5.2vw,2.25rem)] sizesm-[16px]",
    );
    expect(style["--lse-size"]).toContain("clamp(16px");
    expect(style["--lse-size"]).toContain("36px)"); // 2.25rem
  });

  it("a phone pick with NO known ceiling keeps the fallback machinery", () => {
    const { style, className } = resolveRegionStyle("r", "grid", "sizesm-[18px]");
    expect(style["--lse-size-m"]).toBe("18px");
    expect(className.split(/\s+/)).toContain("lse-msize");
    expect(style["--lse-size"]).toBeUndefined();
  });

  it("CRITICAL: a phone pick larger than desktop NEVER moves desktop", () => {
    // The first cut celebrated 'the floor wins' — but a clamp floor wins at EVERY
    // width, so dragging mobile above desktop changed desktop too (Sam hit it live).
    // The clamp is ORDERED now: lo/hi sorted, the slope decides direction, and each
    // end only ever moves its own side.
    const { style } = resolveRegionStyle("r", "grid", "size-[16px] sizesm-[24px]");
    expect(style["--lse-size"]).toBe(
      "clamp(16px,calc(24px + -8 * (100vw - 390px) / 634),24px)",
    );
    // At ≥1024px the calc sits at/below 16px and the lower bound holds desktop at 16.
    // At 390px it reads exactly 24 — the phone pick.
  });

  it("CRITICAL: a desktop pick NEVER moves the phone end — the floor is the BUILD's", () => {
    // The other live leak: desktop-only picks emitted the ladder clamp, whose floor is
    // 70% OF THE PICK — raise desktop and the phone floor rose with it. The default
    // floor is the initial build's own (the base clamp's min), held until the manager
    // touches it in phone view.
    const base = "grid text-[clamp(1.75rem,6.5vw,3rem)]"; // build floor 28px, ceiling 48px
    const at60 = resolveRegionStyle("r", base, "size-[60px]");
    expect(at60.style["--lse-size"]).toBe(
      "clamp(28px,calc(28px + 32 * (100vw - 390px) / 634),60px)",
    );
    const at96 = resolveRegionStyle("r", base, "size-[96px]");
    // Desktop went 60 → 96; the phone end did not move an inch.
    expect(at96.style["--lse-size"]).toMatch(/^clamp\(28px,/);
  });

  it("a claimed base's own size token supplies the default floor the same way", () => {
    // skeen's claimed bases declare size-[48px]; its ladder floor (28px) is the build
    // default a desktop-only edit must hold.
    const { style } = resolveRegionStyle(
      "r",
      "grid size-[48px] lse-owns-[size]",
      "text-white size-[60px]",
    );
    expect(style["--lse-size"]).toMatch(/^clamp\(28px,.*60px\)$/);
    expect(style.fontSize).toBeUndefined();
  });

  it("a region with NO size of its own keeps the plain ladder clamp for desktop picks", () => {
    // Genuinely sizeless (inherited text): there is no build floor to hold, so the
    // ladder's own fluid clamp is still the honest rendering.
    const { style } = resolveRegionStyle("r", "grid", "size-[48px]");
    expect(style["--lse-size"]).toBe("clamp(1.75rem,6.5vw,3rem)");
  });
});
