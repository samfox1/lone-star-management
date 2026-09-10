// @vitest-environment jsdom
// An override stores only what changed, so a styled region no longer freezes at that day's
//   design.
/**
 * DELTA OVERRIDES (0.24.0) — the end of the frozen region.
 *
 * A section override used to be the manager's WHOLE class string, replacing the base:
 * the day they styled a region, its layout froze at that day's design, later site
 * improvements never reached it, and rebase:styles existed to repair the drift by hand.
 * Three of the 2026-08-17 review's findings traced to this one semantic.
 *
 * A stored override is now a DELTA: the sentinel `lse-delta` plus only the tokens the
 * manager changed. Rendering keeps every base token whose FAMILY the delta does not
 * touch — layout, hook classes, claims — and swaps in the delta's families. Removals
 * are explicit: `lse-not-[case]` strips the base's family and applies nothing, which is
 * what a toggle turned OFF against a base that had it ON means.
 *
 * Legacy full-string rows (no sentinel) keep the old replace semantics forever; the
 * editor rewrites them as deltas the next time each is edited.
 */
import { describe, expect, it } from "vitest";
import { familyOf, mergeStyle, resolveRegionStyle } from "@samfox1/site-bridge";
import { createStyleApplier } from "@samfox1/site-bridge/frame";

const BASE =
  "tour-heading font-display size-[48px] sizesm-[28px] lse-owns-[size] font-black uppercase tracking-tight text-foreground";

describe("familyOf — one family id per owned token, either era", () => {
  it("maps the shapes a delta must distinguish", () => {
    const cases: [string, string | null][] = [
      ["size-[48px]", "size"],
      ["text-[clamp(1.75rem,6.5vw,3rem)]", "size"],
      ["text-4xl", "size"],
      ["sizesm-[18px]", "sizesm"],
      ["weight-[700]", "weight"],
      ["font-black", "weight"],
      ["font-display", "font"],
      ["fontfam-[Momo_Display,_serif]", "font"],
      ["align-[center]", "align"],
      ["text-center", "align"],
      ["lead-[1.25]", "leading"],
      ["!leading-none", "leading"],
      ["track-[-0.04em]", "tracking"],
      ["tracking-tight", "tracking"],
      ["case-[uppercase]", "case"],
      ["uppercase", "case"],
      ["fstyle-[italic]", "italic"],
      ["italic", "italic"],
      ["text-foreground", "textColor"],
      ["text-[#ffffffcc]", "textColor"],
      ["bg-black", "bgColor"],
      ["bg-[#112233]", "bgColor"],
      ["underline", "underline"],
      ["line-through", "strike"],
      ["pad-[24px]", "pad"],
      ["pady-[24px]", "pady"],
      ["gap-[12px]", "gap"],
      ["gapsm-[8px]", "gapsm"],
      ["just-[center]", "just"],
      ["maxw-[960px]", "maxw"],
      ["iconsize-[18px]", "iconsize"],
      ["hovercolor-[#c63a2a]", "hovercolor"],
      ["frost-[8px]", "frost"],
      ["textshadow-4", "textshadow"],
      ["textglow-3", "textglow"],
      ["textstroke-[1px]", "textstroke"],
      ["scalesm-[135]", "scalesm"],
      // NOT ours: layout, hook classes, site vocabulary — null means "never in a
      // delta, always kept from the base".
      ["grid", null],
      ["tour-heading", null],
      ["fx-glitch-mono", null],
      ["justify-center", null],
      ["md:grid-cols-2", null],
      ["lse-owns-[size]", null],
    ];
    for (const [token, fam] of cases) expect(familyOf(token), token).toBe(fam);
  });
});

describe("review findings — the two HIGH bugs, pinned before fixing", () => {
  it("F2: lse-not parses CAMELCASE family ids (textColor et al.)", () => {
    // The writer emits ids like textColor; the parser accepted [a-z]+ only, so the
    // removal shipped as a junk class, stripped nothing, and vanished on re-save.
    expect(familyOf("lse-not-[textColor]")).toBe("textColor");
    const { className, style } = resolveRegionStyle(
      "r",
      "grid text-foreground",
      "lse-delta lse-not-[textColor]",
    );
    expect(className.split(/\s+/)).toEqual(["grid"]);
    expect(style.color).toBeUndefined();
    expect(className).not.toContain("lse-not");
  });

  it("F1: the divider sides are a family, so a toggle-off can strip them", () => {
    // border-t had NO family: turning the Divider off diffed to nothing, the row was
    // deleted, and the line stayed on the live site.
    expect(familyOf("border-t")).toBe("divider");
    expect(familyOf("border-b")).toBe("divider");
    const { className } = resolveRegionStyle(
      "r",
      "flex border-t px-6",
      "lse-delta lse-not-[divider]",
    );
    expect(className.split(/\s+/)).toEqual(["flex", "px-6"]);
  });

  it("F6: a text-[…] payload that is neither hex nor a length stays the site's own", () => {
    // text-[var(--x)] classified as size — stripped by a size edit, which is backwards.
    expect(familyOf("text-[var(--x)]")).toBe(null);
    expect(familyOf("text-[#abc]")).toBe("textColor");
    expect(familyOf("text-[2rem]")).toBe("size");
  });

  it("membership, not position: a reordered sentinel still reads as a delta", () => {
    const { className } = resolveRegionStyle("r", "grid text-center", "align-[right] lse-delta");
    expect(className.split(/\s+/)).toEqual(["grid"]);
  });

  it("variant-prefixed base tokens are site design — never a family, always kept", () => {
    // A delta must not strip md:grid-cols-2 because someone edited alignment; deliberate.
    for (const t of ["md:text-6xl", "sm:pb-4", "hover:text-flash-1"]) {
      expect(familyOf(t), t).toBe(null);
    }
  });
});

describe("delta rendering", () => {
  it("CRITICAL: keeps every untouched base token — hook class, claim, layout", () => {
    // THE drift fix. A font pick must no longer take the whole region hostage.
    const { className, style } = resolveRegionStyle(
      "tour_heading",
      BASE,
      "lse-delta fontfam-[Inter,_sans-serif]",
    );
    const classes = className.split(/\s+/);
    expect(classes).toContain("tour-heading"); // the hook the old model destroyed
    expect(classes).toContain("font-black");
    expect(classes).toContain("uppercase");
    expect(classes).toContain("tracking-tight");
    expect(classes).toContain("text-foreground");
    expect(classes).not.toContain("font-display"); // same family as the delta's font
    expect(style["--lse-font"]).toBe("'Inter', sans-serif");
    // The claim still read from the base: size sets only its variable.
    expect(style["--lse-size"]).toBeTruthy();
    expect(style.fontSize).toBeUndefined();
  });

  it("swaps a family in both eras — a token delta replaces a class-era base token", () => {
    const { className, style } = resolveRegionStyle(
      "r",
      "grid text-center uppercase",
      "lse-delta align-[right]",
    );
    expect(className.split(/\s+/)).toEqual(["grid", "uppercase"]);
    expect(style.textAlign).toBe("var(--lse-align)");
  });

  it("lse-not strips the base's family and applies nothing", () => {
    const { className, style } = resolveRegionStyle(
      "r",
      "grid uppercase text-center",
      "lse-delta lse-not-[case]",
    );
    expect(className.split(/\s+/)).toEqual(["grid", "text-center"]);
    expect(style.textTransform).toBeUndefined();
  });

  it("the sentinel and lse-not never reach the rendered class list", () => {
    const { className } = resolveRegionStyle("r", "grid", "lse-delta lse-not-[case] align-[left]");
    expect(className).not.toContain("lse-delta");
    expect(className).not.toContain("lse-not");
  });

  it("an empty delta renders the base exactly", () => {
    const plain = resolveRegionStyle("r", BASE, "");
    const empty = resolveRegionStyle("r", BASE, "lse-delta");
    expect(empty.className).toBe(plain.className);
    expect(empty.style).toEqual(plain.style);
  });

  it("LEGACY full strings keep replace semantics untouched", () => {
    const { className } = resolveRegionStyle("r", BASE, "font-momo text-5xl");
    // No sentinel → the old model: override replaces base, wholesale.
    expect(className.split(/\s+/)).not.toContain("tour-heading");
  });

  it("mergeStyle exposes the same semantics to sites' own styleClass path", () => {
    expect(mergeStyle("r", "grid text-center", "lse-delta align-[right]"))
      .toBe("grid align-[right]");
  });

  it("the LIVE applier renders a delta over the registry base (the editor's preview path)", () => {
    document.body.innerHTML = `<section data-lse-style="footer" class="flex px-6 border-t"></section>`;
    const el = document.querySelector("section") as HTMLElement;
    const { applyStyleToDom: apply } = createStyleApplier({
      regionBase: () => "flex px-6 border-t",
    });
    apply(document.body, "footer", "lse-delta lse-not-[divider] pad-[40px]");
    const classes = (el.getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toContain("flex");
    expect(classes).toContain("px-6");
    expect(classes).not.toContain("border-t");
    expect(classes).not.toContain("lse-delta");
    expect(el.style.getPropertyValue("padding")).toBe("40px");
    // And removal restores the base wholesale.
    apply(document.body, "footer", "");
    expect((el.getAttribute("class") ?? "").split(/\s+/)).toContain("border-t");
  });

  it("item keys are untouched — they were always overlays", () => {
    const { className } = resolveRegionStyle("slot:x", "base-cls", "opacity-30");
    expect(className.split(/\s+/)).toContain("base-cls");
  });
});
