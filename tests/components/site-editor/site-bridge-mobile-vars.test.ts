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
import { buildTokensCss } from "../../../scripts/generate-bridge-tokens";

describe("sizesm-[Npx] on an UNCLAIMED region", () => {
  it("sets the variable exactly and adds the marker class", () => {
    const { style, className } = resolveRegionStyle("r", "grid", "sizesm-[18px]");
    expect(style["--lse-size-m"]).toBe("18px");
    expect(className.split(/\s+/)).toContain("lse-msize");
    // The raw token never survives as a class.
    expect(className).not.toContain("sizesm-[18px]");
  });

  it("with the desktop token present, the two stay independent — see the discrete suite", () => {
    // History: 0.19 shipped this discretely; 0.20 fused the picks into one clamp; 0.21
    // went BACK — the fusion's interpolation zone let the phone pick reach desktop
    // widths. The full pinning lives in "the two picks are fully independent".
    const { style } = resolveRegionStyle("r", "grid", "size-[48px] sizesm-[18px]");
    expect(style["--lse-size-m"]).toBe("18px");
  });
});

describe("sizesm-[Npx] on a CLAIMED region", () => {
  it("claimed + both picks: variables only, never a marker class", () => {
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

/* ── ALL THE STYLES (0.22.0, Sam): every variable-backed family gets a phone twin,
 * derived from the SAME tables as the desktop forms so a family added later joins
 * automatically. Same discrete mechanics as sizesm: var + marker class for unclaimed,
 * var only for claimed. */
const SM_FAMILIES: [string, string, string, string][] = [
  // token, variable, marker class, claim ('' = unclaimable)
  ["weightsm-[700]", "--lse-weight-m", "lse-mweight", "weight"],
  ["alignsm-[center]", "--lse-align-m", "lse-malign", "align"],
  ["leadsm-[1.25]", "--lse-leading-m", "lse-mleading", "leading"],
  ["tracksm-[-0.04em]", "--lse-tracking-m", "lse-mtracking", "tracking"],
  ["casesm-[uppercase]", "--lse-case-m", "lse-mcase", "case"],
  ["fstylesm-[italic]", "--lse-fontstyle-m", "lse-mitalic", "italic"],
  ["gapsm-[12px]", "--lse-gap-m", "lse-mgap", ""],
  // Item scale, percent → ratio: the hero-logo case (Sam, 2026-08-17: "I tried to edit
  // the size of the SKEEN hero image and it changes when I edit desktop/mobile").
  ["scalesm-[135]", "--lse-scale-m", "lse-mscale", ""],
];

describe("every phone twin: var + marker unclaimed, var only when claimed", () => {
  for (const [token, variable, marker, claim] of SM_FAMILIES) {
    it(token, () => {
      const raw = token.match(/\[(.+)\]/)![1];
      const value = token.startsWith("scalesm-") ? String(Number(raw) / 100) : raw;
      const open = resolveRegionStyle("r", "grid", token);
      expect(open.style[variable]).toBe(value);
      expect(open.className.split(/\s+/)).toContain(marker);
      expect(open.className).not.toContain(token);
      // Desktop math untouched — the twin sets ONLY its -m variable.
      expect(Object.keys(open.style)).toEqual([variable]);

      if (claim) {
        const claimed = resolveRegionStyle("r", `grid lse-owns-[${claim}]`, token);
        expect(claimed.style[variable]).toBe(value);
        expect(claimed.className.split(/\s+/)).not.toContain(marker);
      }
    });
  }

  it("rejects junk payloads without leaving classes behind", () => {
    for (const bad of ["weightsm-[banana]", "alignsm-[up]", "leadsm-[99]", "tracksm-[4em]", "casesm-[blink]", "gapsm-[12em]"]) {
      const { style, className } = resolveRegionStyle("r", "grid", `flex ${bad}`);
      expect(Object.keys(style), bad).toEqual([]);
      expect(className, bad).toBe("flex");
    }
  });

  it("declares every -m variable in the clear-list", () => {
    for (const [, variable] of SM_FAMILIES) expect(MANAGED_STYLE_PROPS).toContain(variable);
  });

  it("tokens.css carries a media rule per family, all !important", () => {
    const css = buildTokensCss();
    const media = css.slice(css.indexOf("Mobile overrides"));
    for (const [, variable, marker] of SM_FAMILIES) {
      expect(media, marker).toContain(`.${marker}`);
      expect(media, variable).toContain(`var(${variable})`);
    }
  });
});

describe("item regions twin too — the hero logo is one", () => {
  it("a per-item overlay lifts scalesm on the ITEM path", () => {
    const { style, className } = resolveRegionStyle(
      "slot:hero_wordmark_1_image",
      "max-h-[45svh] w-auto",
      "opacity-30 scalesm-[135]",
    );
    expect(style["--lse-scale-m"]).toBe("1.35");
    expect(className.split(/\s+/)).toContain("lse-mscale");
    // The desktop scale untouched by the twin: opacity lifts as before, no `scale` set.
    expect(style.scale).toBeUndefined();
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

/* ── DISCRETE MODEL (0.21.0). Fusion (0.20.x) blended the two picks across a 390-1024px
 * interpolation zone — clever CSS, wrong mental model: any not-fullscreen laptop sat on
 * the slope, so the phone pick kept a hand in "desktop" (Sam hit it twice, live). The
 * two values are fully independent now: below the breakpoint the phone value, above it
 * the desktop value, no zone where they mix. Each slider edits exactly what its view
 * shows. */
describe("the two picks are fully independent", () => {
  it("both set, unclaimed: desktop inlines, phone rides the marker", () => {
    const { style, className } = resolveRegionStyle("r", "grid", "size-[48px] sizesm-[18px]");
    expect(style["--lse-size"]).toBe("clamp(1.75rem,6.5vw,3rem)");
    expect(style.fontSize).toBe("var(--lse-size)");
    expect(style["--lse-size-m"]).toBe("18px");
    expect(className.split(/\s+/)).toContain("lse-msize");
  });

  it("both set, claimed: variables only — the site's rules decide everything", () => {
    const { style, className } = resolveRegionStyle(
      "r",
      "grid lse-owns-[size]",
      "size-[48px] sizesm-[18px]",
    );
    expect(style["--lse-size"]).toBe("clamp(1.75rem,6.5vw,3rem)");
    expect(style["--lse-size-m"]).toBe("18px");
    expect(style.fontSize).toBeUndefined();
    expect(className.split(/\s+/)).not.toContain("lse-msize");
  });

  it("CRITICAL: the phone value appears NOWHERE in the desktop-width math", () => {
    // The property fusion could not deliver: --lse-size must not depend on the phone
    // pick at all. Desktop reads --lse-size; phone reads --lse-size-m; done.
    const alone = resolveRegionStyle("r", "grid", "size-[48px]");
    const withPhone = resolveRegionStyle("r", "grid", "size-[48px] sizesm-[176px]");
    expect(withPhone.style["--lse-size"]).toBe(alone.style["--lse-size"]);
  });
});
