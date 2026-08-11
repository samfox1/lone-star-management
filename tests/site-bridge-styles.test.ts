// @vitest-environment jsdom
// PORTED from skeen's lib/styles.test.ts (SITE_BRIDGE_PLAN.md phase 1 slice 2) — the tests move
// with the code they pin. skeen keeps its copies until its phase-2 migration deletes
// them WITH its mirrored modules; the double coverage in the window is deliberate.
// Registry-dependent cases use TEST_REGIONS below — the package takes a site's
// registry by injection, so the tests inject one too.

import { describe, expect, it } from "vitest";
import { createStyleApplier } from "@samfox1/site-bridge/frame";
import {
  MANAGED_STYLE_PROPS,
  bindSiteRegistry,
  isItemKey,
  itemRegion,
  mergeStyle,
  resolveRegionStyle,
  resolveStyle,
  slotRegion,
  splitItemOverlay,
  splitItemProps,
  styleClass,
} from "@samfox1/site-bridge";

// The package's OWN binding (bindSiteRegistry) — this block used to hand-write the
// wrapper the old docblock prescribed; after the 2026-08-07 deepening the binding IS
// package interface, so the test exercises the export a real site uses. WORK_BASE is
// skeen's real work_section base, kept so the ported assertions read unchanged.
const WORK_BASE = "relative z-0 bg-background text-foreground";
const REGION = { workSection: "work_section" } as const;
const TEST_BASES: Record<string, string> = { [REGION.workSection]: WORK_BASE };
const bound = bindSiteRegistry({ regionBase: (key) => TEST_BASES[key] ?? "" });
const { regionBase, regionProps } = bound;
import { TEXT_SIZES } from "@samfox1/site-bridge";

describe("regionBase injection (the registry inversion)", () => {
  // The registry-CONTENT tests (skeen's declared bases, key uniqueness) stayed in
  // skeen — they pin its design. What the package owes is the WRAPPER shape: a site's
  // two-line binding gives back exactly the old regionProps behaviour.
  it("a site's wrapper defaults base from its own registry; unknown keys get ''", () => {
    expect(regionBase(REGION.workSection)).toBe(WORK_BASE);
    expect(regionBase("not_a_region")).toBe("");
  });
});

describe("regionProps", () => {
  it("public render: base classes, NO marker", () => {
    expect(regionProps({}, REGION.workSection)).toEqual({
      className: "relative z-0 bg-background text-foreground",
    });
    expect(regionProps({}, REGION.workSection, false)).not.toHaveProperty(
      "data-lse-style",
    );
  });

  it("edit mode: emits the data-lse-style marker alongside the class", () => {
    expect(regionProps({}, REGION.workSection, true)).toEqual({
      className: "relative z-0 bg-background text-foreground",
      "data-lse-style": "work_section",
    });
  });

  it("an override REPLACES the base classes (marker still present in edit mode)", () => {
    const styles = { work_section: "bg-black text-white" };
    expect(regionProps(styles, REGION.workSection, true)).toEqual({
      className: "bg-black text-white",
      "data-lse-style": "work_section",
    });
  });

  it("supports per-item regions via an explicit base", () => {
    const key = itemRegion("videos", "abc-123");
    expect(key).toBe("videos:abc-123");
    expect(regionProps({}, key, true, "rounded")).toEqual({
      className: "rounded",
      "data-lse-style": "videos:abc-123",
    });
  });
});

describe("styleClass (still the primitive under regionProps)", () => {
  it("override wins, blank falls back to base", () => {
    expect(styleClass({ k: "a" }, "k", "base")).toBe("a");
    expect(styleClass({ k: "  " }, "k", "base")).toBe("base");
    expect(styleClass(undefined, "k", "base")).toBe("base");
  });
});

describe("per-item overlays vs section overrides", () => {
  it("tells items from sections by the colon convention", () => {
    expect(isItemKey(slotRegion("polaroid_1_photo"))).toBe(true);
    expect(slotRegion("polaroid_1_photo")).toBe("slot:polaroid_1_photo");
    expect(isItemKey(itemRegion("videos", "abc"))).toBe(true);
    expect(isItemKey(REGION.workSection)).toBe(false);
  });

  it("an item overlay ADDS to the base — the editor sends only what changed", () => {
    // Replacing here would strip the photo's own layout and drop it out of the wall.
    expect(
      mergeStyle(
        "slot:polaroid_1_photo",
        "h-full w-full object-cover",
        "scale-110",
      ),
    ).toBe("h-full w-full object-cover scale-110");
    expect(mergeStyle("work_section", "bg-background", "bg-black")).toBe(
      "bg-black",
    );
    expect(mergeStyle("slot:polaroid_1_photo", "h-full", "")).toBe("h-full");
  });
});

describe("resolveStyle — colours Tailwind cannot compile", () => {
  it("lifts an arbitrary hex out of the class string and into inline style", () => {
    expect(resolveStyle("border-[4px] border-[#123abc]")).toEqual({
      // The width is lifted too: the whole item vocabulary is inline now — a class
      // could be uncompiled by this build, or outranked by a same-property base class.
      className: "",
      style: {
        borderWidth: "4px",
        borderStyle: "solid",
        borderColor: "#123abc",
      },
    });
    expect(resolveStyle("text-[#fff] bg-[#000000]").style).toEqual({
      color: "#fff",
      backgroundColor: "#000000",
    });
  });

  it("leaves the site's own compiled tokens alone", () => {
    expect(resolveStyle("bg-flash-1 font-momo uppercase")).toEqual({
      className: "bg-flash-1 font-momo uppercase",
      style: {},
    });
  });

  it("lifts speed-[Nx] into playbackRate — a DOM property, never a class", () => {
    expect(resolveStyle("speed-[1.5x] opacity-50")).toEqual({
      className: "",
      style: { opacity: "0.5" },
      playbackRate: 1.5,
    });
    // No token → no property; the consumer resets to 1.
    expect(resolveStyle("scale-110")).not.toHaveProperty("playbackRate");
    // A malformed speed isn't a speed token at all, so it stays an (inert) class.
    expect(resolveStyle("speed-[fast]").className).toBe("speed-[fast]");
    // A well-formed but unplayable rate is no rate at all, and stays an inert class
    // rather than silently becoming one. WebKit throws NotSupportedError outside
    // ~0.0625-16x and both consumers assign playbackRate unguarded.
    for (const dead of ["speed-[0x]", "speed-[50x]", "speed-[0.01x]"])
      expect(resolveStyle(dead)).toEqual({ className: dead, style: {} });
    // The bounds themselves are playable and must survive.
    expect(resolveStyle("speed-[16x]").playbackRate).toBe(16);
  });
});

describe("resolveRegionStyle — PROVENANCE decides what may lift", () => {
  // Mirrors lone-star's resolveRegionStyle. The item vocabulary lifts only out of the
  // MANAGER's overlay; base classes belong to the site and are never touched. Skeen
  // learned this on 2026-08-04, after lifting from the merged string turned Hero's
  // transient `opacity-0` fade class into inline opacity 0 that React could never undo.

  it("never lifts a base class, even one in the item vocabulary", () => {
    // `opacity-0` and `rounded-full` are exactly the tokens an overlay WOULD lift.
    // Coming from the site's own base they stay classes, so variants still work.
    const resolved = resolveRegionStyle(
      "slot:polaroid_1_photo",
      "opacity-0 rounded-full hover:opacity-100",
      "",
    );
    expect(resolved.className).toBe("opacity-0 rounded-full hover:opacity-100");
    expect(resolved.style).toEqual({});
  });

  it("lifts the overlay, and appends it to the base as classes", () => {
    const resolved = resolveRegionStyle(
      "slot:polaroid_1_photo",
      "h-full w-full object-cover",
      "scale-110 rounded-[6px] font-alt",
    );
    // The base survives verbatim; unowned overlay tokens stay classes beside it.
    expect(resolved.className).toBe("h-full w-full object-cover font-alt");
    expect(resolved.style).toEqual({ scale: "1.1", borderRadius: "6px" });
  });

  it("a SECTION region lifts colours only — its vocabulary is compiled classes", () => {
    // The reachable half of the divergence: skeen used to inline these, lone-star's
    // preview kept them classes, so preview and published page disagreed.
    const resolved = resolveRegionStyle(
      "work_section",
      "bg-background",
      "rounded-full opacity-50 bg-[#123abc]",
    );
    expect(resolved.className).toBe("rounded-full opacity-50");
    expect(resolved.style).toEqual({ backgroundColor: "#123abc" });
  });

  it("a section override still REPLACES, and a blank one still restores the base", () => {
    expect(
      resolveRegionStyle("work_section", "bg-background", "bg-black").className,
    ).toBe("bg-black");
    expect(
      resolveRegionStyle("work_section", "bg-background", "").className,
    ).toBe("bg-background");
  });

  it("speed lifts from an overlay but not from a section string", () => {
    expect(
      resolveRegionStyle(
        "slot:hero_landscape",
        "absolute inset-0",
        "speed-[1.5x]",
      ).playbackRate,
    ).toBe(1.5);
    expect(
      resolveRegionStyle("hero_video", "absolute inset-0", "speed-[1.5x]"),
    ).not.toHaveProperty("playbackRate");
  });
});

describe("resolveRegionStyle — legacy FIXED sizes render as their fluid twins", () => {
  // Sam's screenshot, 2026-08-05: four of the five polaroid captions ran off their cards
  // on a phone. The fifth fit. The difference was WHEN each was styled: caption 1's row
  // held a clamp, captions 2-5 held `text-4xl`/`text-5xl`/`text-6xl` — sizes stored
  // before the scale went fluid. A fixed size is the same rem at every width, so a choice
  // made against the desktop preview overflows a phone with no way to fix it short of
  // shrinking it for everyone.
  //
  // The rows are the manager's data and re-picking every size by hand is not a fix, so
  // the TRANSLATION happens at render: a legacy fixed size in an override becomes the
  // clamp whose MAX is that exact size. Desktop renders identically — the clamp's max is
  // the size the manager chose — and the phone finally gets the smaller end.
  //
  // At render rather than in the database: it also covers the PUBLISHED styles snapshot
  // (already carrying the legacy tokens, and not rewritten until the next publish), and
  // any row an older editor writes tomorrow.

  it("CRITICAL: a stored text-5xl renders as the clamp that maxes at 3rem", () => {
    // Caption 2's real row, verbatim from the live database.
    const resolved = resolveRegionStyle(
      "polaroid_2_caption",
      "text-[clamp(0.78rem,1.9vw,0.875rem)] font-semibold",
      "font-sorg-font text-5xl tracking-[-0.04em]",
    );
    expect(resolved.className).toContain("text-[clamp(1.75rem,6.5vw,3rem)]");
    expect(resolved.className).not.toContain("text-5xl");
    // The rest of the manager's string survives untouched.
    expect(resolved.className).toContain("font-sorg-font");
    expect(resolved.className).toContain("tracking-[-0.04em]");
  });

  it("every legacy step maps to a clamp whose MAX is that exact size", () => {
    // Desktop must not move. The pairs are (fixed rem, clamp max rem) — equal by
    // construction, asserted so a retuned scale cannot quietly break the promise.
    const FIXED_REM: Record<string, number> = {
      "text-xs": 0.75, "text-sm": 0.875, "text-base": 1, "text-lg": 1.125,
      "text-xl": 1.25, "text-2xl": 1.5, "text-3xl": 1.875, "text-4xl": 2.25,
      "text-5xl": 3, "text-6xl": 3.75, "text-7xl": 4.5, "text-8xl": 6,
      "text-9xl": 8,
    };
    for (const [fixed, rem] of Object.entries(FIXED_REM)) {
      const out = resolveRegionStyle("footer", "text-center", `${fixed}`).className;
      const m = /text-\[clamp\([^,]+,[^,]+,([\d.]+)rem\)\]/.exec(out);
      expect(m, `${fixed} translated`).not.toBeNull();
      expect(Number(m![1]), fixed).toBe(rem);
    }
  });

  it("…and every translated clamp is one the site ADVERTISES, so it is compiled", () => {
    // A translation to a class outside TEXT_SIZES would recreate the original bug —
    // fluid in name, no CSS in the build.
    const advertised = new Set(TEXT_SIZES.map((s) => s.value));
    for (const fixed of ["text-xs", "text-4xl", "text-9xl"]) {
      const out = resolveRegionStyle("footer", "", fixed).className;
      const clamp = out.split(/\s+/).find((t) => t.startsWith("text-["));
      expect(advertised.has(clamp!), `${fixed} → ${clamp}`).toBe(true);
    }
  });

  it("a fluid size already stored passes through untouched", () => {
    const out = resolveRegionStyle(
      "polaroid_1_caption",
      "",
      "font-sorg-font text-[clamp(1.5rem,5.2vw,2.25rem)]",
    ).className;
    expect(out).toContain("text-[clamp(1.5rem,5.2vw,2.25rem)]");
  });

  it("does not touch look-alike tokens that are not sizes", () => {
    // `text-center` and a colour share the prefix; translating either would corrupt the
    // string. And the site's own BASE is never translated — only the override is stored
    // data; the base is code that says what it means.
    const out = resolveRegionStyle(
      "footer",
      "",
      "text-center text-flash-1 sm:text-5xl",
    ).className;
    expect(out).toContain("text-center");
    expect(out).toContain("text-flash-1");
    // A size behind a variant translates too — same failure, one breakpoint later.
    expect(out).toContain("sm:text-[clamp(1.75rem,6.5vw,3rem)]");
  });

  it("translates inside an ITEM overlay as well", () => {
    // Overlays append rather than replace, but a legacy size is just as fixed there.
    const out = resolveRegionStyle("slot:polaroid_1_photo", "h-full", "text-4xl").className;
    expect(out).toContain("text-[clamp(1.5rem,5.2vw,2.25rem)]");
    expect(out).not.toContain("text-4xl");
  });
});

describe("regionProps — the manager's colour reaches the PUBLIC render", () => {
  it("emits inline style for an item's hex, with no marker off edit mode", () => {
    const styles = {
      "slot:polaroid_1_photo": "scale-110 border-[4px] border-[#123abc]",
    };
    expect(
      regionProps(
        styles,
        "slot:polaroid_1_photo",
        false,
        "h-full w-full object-cover",
      ),
    ).toEqual({
      // The whole owned vocabulary is inline now — only the base stays classes.
      className: "h-full w-full object-cover",
      style: {
        scale: "1.1",
        borderWidth: "4px",
        borderStyle: "solid",
        borderColor: "#123abc",
      },
    });
  });

  it("adds NO style prop when there is no colour — no empty style attributes site-wide", () => {
    expect(regionProps({}, REGION.workSection)).not.toHaveProperty("style");
  });
});

describe("splitItemOverlay — window vs item", () => {
  it("routes corners, border (with its colour) and shadow to the window; the rest stays", () => {
    expect(
      splitItemOverlay(
        "scale-110 opacity-55 rounded-full border-[4px] border-[#123abc] shadow-xl",
      ),
    ).toEqual({
      window: "rounded-full border-[4px] border-[#123abc] shadow-xl",
      inner: "scale-110 opacity-55",
    });
  });

  it("prefix-matches whole utilities, not substrings", () => {
    // `border` alone is a real utility; something like `borderish-x` must not match.
    expect(splitItemOverlay("border borderish-x shadow rounded")).toEqual({
      window: "border shadow rounded",
      inner: "borderish-x",
    });
  });

  it("splits an empty overlay into two empty halves", () => {
    expect(splitItemOverlay("")).toEqual({ window: "", inner: "" });
  });
});

describe("splitItemProps — the polaroid photo's two elements", () => {
  const KEY = "slot:polaroid_1_photo";
  const styles = { [KEY]: "scale-110 rounded-full border-[#123abc] shadow-xl" };

  it("overlays each half onto its own base, colour as inline style on the window", () => {
    const { window: win, inner } = splitItemProps(
      styles,
      KEY,
      false,
      "h-full object-cover",
      "relative overflow-hidden",
    );
    expect(inner).toEqual({
      className: "h-full object-cover",
      style: { scale: "1.1" },
    });
    expect(win).toEqual({
      className: "relative overflow-hidden",
      style: {
        borderRadius: "9999px",
        boxShadow:
          "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
        borderColor: "#123abc",
      },
    });
  });

  it("marks the item with STYLE_ATTR and the window with WINDOW_ATTR — edit mode only", () => {
    const edit = splitItemProps(styles, KEY, true, "b", "w");
    expect(edit.inner["data-lse-style"]).toBe(KEY);
    expect(edit.window["data-lse-style-window"]).toBe(KEY);
    // Never two STYLE_ATTRs for one key: the editor's select/highlight expect exactly one.
    expect(edit.window["data-lse-style"]).toBeUndefined();
    const publicSite = splitItemProps(styles, KEY, false, "b", "w");
    expect(publicSite.inner["data-lse-style"]).toBeUndefined();
    expect(publicSite.window["data-lse-style-window"]).toBeUndefined();
  });

  it("with no stored overlay, both elements keep exactly their base", () => {
    const { window: win, inner } = splitItemProps(
      {},
      KEY,
      false,
      "h-full",
      "relative",
    );
    expect(inner).toEqual({ className: "h-full" });
    expect(win).toEqual({ className: "relative" });
  });
});

describe("resolveStyle — every owned token has an inline meaning", () => {
  it("lifts each length, corner and shadow step", () => {
    expect(resolveStyle("rounded-[12px]")).toEqual({
      className: "",
      style: { borderRadius: "12px" },
    });
    expect(resolveStyle("border-[3px]").style).toEqual({
      borderWidth: "3px",
      borderStyle: "solid",
    });
    expect(resolveStyle("rounded-full").style).toEqual({
      borderRadius: "9999px",
    });
    // Every shadow step resolves — only shadow-xl was pinned before.
    for (const step of [
      "shadow-sm",
      "shadow",
      "shadow-md",
      "shadow-lg",
      "shadow-xl",
      "shadow-2xl",
    ])
      expect(resolveStyle(step).style.boxShadow).toBeTruthy();
  });

  it("clears every property it can set, so removing a control removes its effect", () => {
    // MANAGED_STYLE_PROPS is the bridge's clear list. Anything resolveStyle can WRITE
    // and the list can't CLEAR would stick to the preview forever.
    const everything = resolveStyle(
      "scale-110 opacity-25 border-[3px] rounded-[8px] shadow-lg border-[#123abc] text-[#ffffff] bg-[#000000]",
    );
    const kebab = (p: string) =>
      p.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    for (const prop of Object.keys(everything.style))
      expect(MANAGED_STYLE_PROPS).toContain(kebab(prop));
  });
});

describe('slice-1 visual effects (2026-08-10)', () => {
  it('CRITICAL: filter families COMPOSE into one value — assignment would keep only the last', () => {
    // Six families share the one `filter` property. This is the composition bug the
    // feature was designed around; a per-token Object.assign passes every single-filter
    // test and silently drops all but one the moment a manager stacks two.
    const r = resolveStyle('bw-50 contrast-120 soften-[4px]')
    expect(r.style.filter).toBe('grayscale(50%) contrast(120%) blur(4px)')
    expect(r.className).toBe('')
  })

  it('tilt and size never fight — rotate and scale are separate CSS properties', () => {
    const r = resolveStyle('scale-110 tilt-[-6deg]')
    expect(r.style.scale).toBe('1.1')
    expect(r.style.rotate).toBe('-6deg')
  })

  it('crop fit lifts to objectFit / objectPosition', () => {
    const r = resolveStyle('fit-cover fit-top')
    expect(r.style.objectFit).toBe('cover')
    expect(r.style.objectPosition).toBe('top')
  })

  it('CRITICAL: text shadow and stroke lift in SECTION context too', () => {
    // The section path lifts colours only — its vocabulary is the site's own compiled
    // classes. These tokens are editor-invented: no site compiles `textshadow-soft`, so
    // left as a class it would be a silent no-op on every text region.
    // A section override REPLACES the base (D-B), and the editor seeds it from the
    // base — so a real stored string carries the site's classes plus the effect.
    const r = resolveRegionStyle('hero_title', 'font-serif text-4xl', 'font-serif text-4xl textshadow-6 textstroke-[1.5px]')
    expect(r.style.textShadow).toBe('0 6px 12px rgb(0 0 0 / 0.78)') // the strengthened curve
    expect(r.style.WebkitTextStroke).toBe('1.5px currentColor')
    expect(r.className).toContain('font-serif') // the site's classes stay CLASSES
    expect(r.className).not.toContain('textshadow') // the effect lifts out
  })

  it('the glow follows the text colour (currentColor, never a baked hex)', () => {
    expect(resolveStyle('textglow-4').style.textShadow).toContain('currentColor')
    // The one-day 0.5.0 token still resolves, as glow 5 — stored strings keep their look.
    expect(resolveStyle('textshadow-glow').style.textShadow).toContain('currentColor')
  })

  it('CRITICAL: shadow and glow COMPOSE — text-shadow takes a list', () => {
    // Sam split them into two sliders (2026-08-10); both write the ONE property, so
    // like the filters they collect into a comma list. Assignment would keep only the
    // slider the manager touched second.
    const r = resolveStyle('textshadow-4 textglow-2')
    expect(r.style.textShadow).toContain('rgb(0 0 0')
    expect(r.style.textShadow).toContain('currentColor')
    expect(r.style.textShadow).toContain(', ')
  })

  it('sections compose them too — these families lift on every text region', () => {
    const r = resolveRegionStyle('hero_title', '', 'font-serif textshadow-2 textglow-6')
    expect(r.style.textShadow?.split(',').length).toBeGreaterThanOrEqual(3) // 1 shadow + 2 glow layers
    expect(r.className).toBe('font-serif')
  })

  it('every new managed property is in the DOM clear-list — removal must remove the effect', () => {
    for (const prop of ['filter', 'rotate', 'object-fit', 'object-position', 'text-shadow', '-webkit-text-stroke']) {
      expect(MANAGED_STYLE_PROPS as readonly string[], prop).toContain(prop)
    }
  })

  it('an out-of-range or misspelled token stays a class, exactly like every family', () => {
    expect(resolveStyle('bw-fifty').className).toBe('bw-fifty')
    expect(resolveStyle('tilt-[200deg]').className).toBe('tilt-[200deg]')
  })
})

describe('slice-2 visual effects (2026-08-11)', () => {
  it('CRITICAL: underline and strikethrough COEXIST — one property, composed', () => {
    const r = resolveStyle('underline line-through')
    expect(r.style.textDecorationLine).toBe('underline line-through')
    expect(r.className).toBe('')
  })

  it('CRITICAL: gradient text clips to the glyphs and clears both fills', () => {
    // Without color:transparent AND WebkitTextFillColor the gradient paints the box
    // behind the letters instead of the letters.
    const r = resolveStyle('textgrad-[#ff0055_#00ccff]')
    expect(r.style.backgroundImage).toBe('linear-gradient(135deg, #ff0055, #00ccff)')
    expect(r.style.WebkitBackgroundClip).toBe('text')
    expect(r.style.color).toBe('transparent')
    expect(r.style.WebkitTextFillColor).toBe('transparent')
  })

  it('a region background gradient lifts in SECTION context', () => {
    const r = resolveRegionStyle('masthead', '', 'flex bggrad-[#0b1210_#5f7a5f]')
    expect(r.style.backgroundImage).toContain('linear-gradient')
    expect(r.className).toBe('flex')
  })

  it('frost and padding lift in section context too', () => {
    const r = resolveRegionStyle('masthead', '', 'frost-[8px] pad-[24px]')
    expect(r.style.backdropFilter).toBe('blur(8px)')
    expect(r.style.WebkitBackdropFilter).toBe('blur(8px)')
    expect(r.style.padding).toBe('24px')
  })

  it('shapes and feather are ITEM lifts, with both mask spellings', () => {
    const r = resolveStyle('shape-arch feather-30')
    expect(r.style.clipPath).toBe('inset(0 round 999px 999px 0 0)')
    expect(r.style.maskImage).toContain('70%')
    expect(r.style.WebkitMaskImage).toBe(r.style.maskImage)
  })

  it('a malformed gradient stays a class rather than half-applying', () => {
    expect(resolveStyle('textgrad-[red_blue]').className).toBe('textgrad-[red_blue]')
    expect(resolveStyle('bggrad-[#abc]').className).toBe('bggrad-[#abc]')
  })

  it('the widened ladders resolve at their new extremes', () => {
    expect(resolveStyle('textshadow-12').style.textShadow).toContain('12px')
    expect(resolveStyle('textglow-12').style.textShadow).toContain('currentColor')
    expect(resolveStyle('tilt-[15deg]').style.rotate).toBe('15deg')
    expect(resolveStyle('brightness-175').style.filter).toBe('brightness(175%)')
    expect(resolveStyle('soften-[16px]').style.filter).toBe('blur(16px)')
    expect(resolveStyle('textstroke-[6px]').style.WebkitTextStroke).toBe('6px currentColor')
  })
})

describe('decoration dressing (2026-08-11)', () => {
  it('CRITICAL: colour, thickness and offset lift — in section context', () => {
    const r = resolveRegionStyle('hero_name', '', 'underline decocolor-[#9c4221] decothick-[3px] underoffset-[6px]')
    expect(r.style.textDecorationLine).toBe('underline')
    expect(r.style.textDecorationColor).toBe('#9c4221')
    expect(r.style.textDecorationThickness).toBe('3px')
    expect(r.style.textUnderlineOffset).toBe('6px')
  })

  it('the centred ladders lift below Auto — negative offset, sub-pixel thickness', () => {
    // Sam (2026-08-11): both sliders start in the MIDDLE, like Size and Tilt. Left of
    // centre is a real value, not a dead zone: a negative offset pulls the line up
    // into the word, a fractional thickness draws a hairline. If the parser stays
    // integer-only these tokens silently no-op on every deployed site.
    expect(resolveStyle('underoffset-[-6px]').style.textUnderlineOffset).toBe('-6px')
    expect(resolveStyle('decothick-[0.5px]').style.textDecorationThickness).toBe('0.5px')
    const r = resolveRegionStyle('hero_name', '', 'underline decothick-[1.25px] underoffset-[-2px]')
    expect(r.style.textDecorationThickness).toBe('1.25px')
    expect(r.style.textUnderlineOffset).toBe('-2px')
  })

  it('CRITICAL: strikethrough reaches a real ELEMENT through the live applier', () => {
    // The whole chain the editor drives — createStyleApplier → resolve → inline write —
    // against an actual DOM node, because Sam reported the line not painting and every
    // string-level test was green (2026-08-11).
    const el = document.createElement('h1')
    el.setAttribute('data-lse-style', 'hero_name')
    document.body.appendChild(el)
    const applier = createStyleApplier({ regionBase: () => 'font-serif' })
    applier.applyStyleToDom(document, 'hero_name', 'font-serif line-through decocolor-[#ff0000]')
    expect(el.style.getPropertyValue('text-decoration-line')).toBe('line-through')
    expect(el.style.getPropertyValue('text-decoration-color')).toBe('rgb(255, 0, 0)') // jsdom normalizes hex
    expect(el.getAttribute('class')).toContain('font-serif')
    el.remove()
  })
})
