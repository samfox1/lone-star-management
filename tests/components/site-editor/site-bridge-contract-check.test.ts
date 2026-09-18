// @vitest-environment jsdom
// The site-connection contract, run as code a site can point at itself.
/**
 * `checkContract` — the five §7 tests of CONNECTING.md, as CODE a site runs on itself.
 *
 * They were prose, so each site hand-wrote its own versions, and skeen's leaked editor
 * furniture onto every public heading for weeks anyway (2026-08-16). Not through
 * carelessness: skeen had FIVE "the public site carries no markers" tests, one per
 * component, and each asserted over the markers its own component emits. `<Text>` emits
 * from somewhere else, so nothing covered it. A rule that every site re-implements is a
 * rule every site re-implements slightly wrong.
 *
 * So it ships with the package, like `auditRegions`, and in the same shape: it returns
 * findings and a site asserts they are empty. One test, whole page, every marker.
 *
 * WHAT IT IS NOT: a test of any particular site. Everything below builds DOM by hand —
 * a compliant fake and a broken one per check — because the thing under test is the
 * CHECKER. A checker exercised only against a passing site is a checker nobody has
 * watched fail.
 */
import { describe, expect, it } from "vitest";
import { checkContract } from "@samfox1/site-bridge/contract";
import { CLAIMABLE_PROPS } from "@samfox1/site-bridge/styles";
import type { TemplateManifest } from "@samfox1/site-bridge/manifest";

/** Every property a region may claim, READ from the bridge rather than spelled here.
 *  `CLAIMABLE_PROPS` is itself derived from `{size, font}` + `TEXT_VARS`, so a seventh
 *  text family becomes claimable and arrives in the fixtures below in the same commit. */
const CLAIMS = Object.keys(CLAIMABLE_PROPS);
/** The element's inline style with every claimed variable present. The VALUES are
 *  irrelevant to rule 5 — it asks only whether the variable reached the element — so they
 *  are a placeholder rather than six invented plausible ones. */
const allVars = (except?: string) =>
  CLAIMS.filter((c) => c !== except)
    .map((c) => `${CLAIMABLE_PROPS[c]!.variable}: 1`)
    .join("; ");

const MANIFEST: TemplateManifest = {
  template: "starter",
  fields: [
    { key: "site_title", label: "Title", type: "text", target: { store: "site_content", key: "site_title" } },
  ],
  slots: [{ key: "shows", label: "Shows", accepts: "tour_date" }],
  styles: [
    { key: "page", label: "Page", base: "bg-paper text-ink", scope: "site" },
    { key: "title", label: "Title", base: "block size-[48px] lse-owns-[size]" },
  ],
  links: [{ key: "tickets", label: "Tickets" }],
  styleOptions: {
    textColors: [{ value: "text-ink", label: "Ink", hex: "#111111" }],
    bgColors: [{ value: "bg-paper", label: "Paper", hex: "#faf8f4" }],
  },
};

const dom = (html: string): Element => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
};

/** The same markup, handed over as the ELEMENT ITSELF rather than wrapped in a bare host.
 *  A site that renders one section, or that passes the region it is checking, gives
 *  `checkContract` a root that carries a marker — the branch `withAttr` exists for. Every
 *  other fixture in this file wraps its markup in an unmarked `<div>`, so that branch was
 *  unreachable in all 437 lines of it and could be deleted with the suite staying green. */
const asRoot = (html: string): Element => dom(html).firstElementChild!;

/** A site that does everything right: markers only in edit mode, every declared key
 *  present, the claimed region setting its variable and NOT the property. */
const EDITABLE = dom(`
  <main data-lse-style="page" style="--x:1">
    <h1 data-lse-style="title" data-lse-field="site_title" data-lse-text=""
        style="--lse-size: clamp(1.75rem,6.5vw,3rem)">Title</h1>
    <ul data-lse-slot="shows"><li data-lse-item="tour_date:1">A show</li></ul>
    <a data-lse-link="tickets" href="#">Tickets</a>
  </main>
`);
const PUBLIC = dom(`
  <main><h1>Title</h1><ul><li>A show</li></ul><a href="#">Tickets</a></main>
`);

const base = { manifest: MANIFEST, publicDom: PUBLIC, editableDom: EDITABLE };

describe("a compliant site", () => {
  it("reports nothing", () => {
    expect(checkContract(base)).toEqual([]);
  });
});

describe("1. no editor furniture on the public page", () => {
  it("catches a marker that survived to a fan", () => {
    // The exact leak: `data-lse-field` / `data-lse-text` on a public heading.
    const leaky = dom(`<main><h1 data-lse-field="site_title" data-lse-text="">Title</h1></main>`);
    const found = checkContract({ ...base, publicDom: leaky });
    expect(found.map((f) => f.check)).toContain("public-markers");
    expect(found.find((f) => f.check === "public-markers")!.detail).toContain("data-lse-field");
  });

  it("catches EVERY marker kind, not just the one it was written for", () => {
    for (const attr of [
      "data-lse-style", "data-lse-field", "data-lse-text",
      "data-lse-slot", "data-lse-item", "data-lse-link", "data-lse-style-window",
    ]) {
      const leaky = dom(`<main><span ${attr}="x">hi</span></main>`);
      const found = checkContract({ ...base, publicDom: leaky });
      expect(found.map((f) => f.check), attr).toContain("public-markers");
    }
  });

  it("CRITICAL: refuses to pass on a public page that rendered nothing", () => {
    // The vacuity trap this whole file exists to close. An empty public render satisfies
    // "no markers" perfectly, which is how a broken component looks exactly like a
    // compliant one. The EDITABLE render is the witness: if it has no markers either,
    // the check proved nothing and must say so.
    const found = checkContract({ ...base, publicDom: dom("<main></main>"), editableDom: dom("<main></main>") });
    expect(found.map((f) => f.check)).toContain("no-witness");
  });
});

describe("2. every declared key is marked", () => {
  it("names a style region the markup never marks", () => {
    const missing = dom(`<main data-lse-style="page"><h1 data-lse-field="site_title" data-lse-text=""></h1>
      <ul data-lse-slot="shows"></ul><a data-lse-link="tickets"></a></main>`);
    const found = checkContract({ ...base, editableDom: missing });
    const f = found.find((x) => x.check === "unmarked-key")!;
    expect(f.detail).toContain("title");
  });

  it("names a missing field, slot and link too — not just regions", () => {
    const bare = dom(`<main data-lse-style="page"><h1 data-lse-style="title"></h1></main>`);
    const detail = checkContract({ ...base, editableDom: bare })
      .filter((x) => x.check === "unmarked-key")
      .map((x) => x.detail)
      .join(" ");
    for (const key of ["site_title", "shows", "tickets"]) expect(detail, key).toContain(key);
  });

  it("respects a link that configures behaviour rather than powering an element", () => {
    // skeen's `booking` is where the contact form SENDS enquiries — a setting, not an
    // anchor, so there is no element to mark and demanding one would make the check a
    // nuisance rather than a guard. The manifest says so explicitly; silence is not
    // enough, because silence is exactly what a genuinely forgotten marker looks like.
    const withSetting: TemplateManifest = {
      ...MANIFEST,
      links: [...MANIFEST.links, { key: "booking", label: "Booking email", rendered: false }],
    };
    expect(checkContract({ ...base, manifest: withSetting })).toEqual([]);
  });

  it("still demands a marker for a link that does NOT opt out", () => {
    // The other half: `rendered: false` must be a deliberate declaration, not the default.
    const forgotten: TemplateManifest = {
      ...MANIFEST,
      links: [...MANIFEST.links, { key: "merch", label: "Merch button" }],
    };
    expect(
      checkContract({ ...base, manifest: forgotten }).map((f) => f.detail).join(" "),
    ).toContain("merch");
  });
});

describe("3. the self-audit", () => {
  it("carries auditRegions' findings through", () => {
    // Not re-implemented — delegated, so the two can never disagree about what
    // "declare what you set" means.
    const undeclared: TemplateManifest = {
      ...MANIFEST,
      styles: [{ key: "page", label: "Page", base: "bg-never-declared text-ink", scope: "site" }],
    };
    const found = checkContract({
      ...base,
      manifest: undeclared,
      // The region must still be MARKED, or this would report the wrong failure.
      editableDom: dom(`<main data-lse-style="page"></main>`),
    });
    expect(found.map((f) => f.check)).toContain("undeclared-value");
  });
});

describe("4. an empty payload invents nothing", () => {
  it("catches published content surviving into the empty render", () => {
    // skeen's actual bug: `data/hero` shipped the real Instagram/Spotify URLs and a
    // bundled bio as prop DEFAULTS, so a manager could delete a link, publish, and still
    // see it — indistinguishable from a broken binding.
    const found = checkContract({
      ...base,
      emptyDom: dom(`<main><a href="https://instagram.com/skeen">Instagram</a></main>`),
      publishedValues: ["https://instagram.com/skeen"],
    });
    const f = found.find((x) => x.check === "invented-content")!;
    expect(f.detail).toContain("instagram.com/skeen");
  });

  it("is silent when the empty render is genuinely empty", () => {
    expect(
      checkContract({
        ...base,
        emptyDom: dom(`<main><p>No shows yet.</p></main>`),
        publishedValues: ["https://instagram.com/skeen"],
      }),
    ).toEqual([]);
  });

  it("skips the check when the site does not supply an empty render", () => {
    // Optional, not silently assumed — but a site that supplies `publishedValues` and no
    // `emptyDom` has half-configured it, and that IS worth saying.
    expect(checkContract(base)).toEqual([]);
    expect(
      checkContract({ ...base, publishedValues: ["https://instagram.com/skeen"] }).map(
        (f) => f.check,
      ),
    ).toContain("no-empty-render");
  });
});

describe("5. a claimed property is a variable, never an inline value", () => {
  it("catches a claimed region that still got its property inlined", () => {
    // If this ever regresses, the site's own breakpoint rule is dead: an inline
    // font-size beats every media query it wrote.
    const inlined = dom(`
      <main data-lse-style="page">
        <h1 data-lse-style="title" data-lse-field="site_title" data-lse-text=""
            style="--lse-size: 3rem; font-size: var(--lse-size)">Title</h1>
        <ul data-lse-slot="shows"></ul><a data-lse-link="tickets"></a>
      </main>`);
    const found = checkContract({ ...base, editableDom: inlined });
    const f = found.find((x) => x.check === "claim-ignored")!;
    expect(f.detail).toContain("font-size");
    expect(f.detail).toContain("title");
  });

  it("catches a claim whose variable never arrived", () => {
    const noVar = dom(`
      <main data-lse-style="page">
        <h1 data-lse-style="title" data-lse-field="site_title" data-lse-text="">Title</h1>
        <ul data-lse-slot="shows"></ul><a data-lse-link="tickets"></a>
      </main>`);
    expect(checkContract({ ...base, editableDom: noVar }).map((f) => f.check)).toContain("claim-ignored");
  });

  /** The manifest whose title region claims EVERY claimable property. */
  const claimsEverything: TemplateManifest = {
    ...MANIFEST,
    styles: [
      { key: "page", label: "Page", base: "bg-paper text-ink", scope: "site" },
      { key: "title", label: "Title", base: `block lse-owns-[${CLAIMS.join(",")}]` },
    ],
  };
  const titlePage = (style: string) =>
    dom(`
      <main data-lse-style="page">
        <h1 data-lse-style="title" data-lse-field="site_title" data-lse-text="" style="${style}">Title</h1>
        <ul data-lse-slot="shows"></ul><a data-lse-link="tickets"></a>
      </main>`);

  it("covers EVERY claimable property, read from the bridge's own map", () => {
    /**
     * WHAT THIS USED TO BE. `lse-owns-[weight,align,leading,tracking,case,italic]`, typed
     * out, under a comment calling itself "the coupling" between this file and the
     * bridge's CLAIMABLE map. A literal string couples nothing: the seventh text family
     * would be claimable on every site and covered here by no fixture at all — the
     * hand-listed-set failure AGENTS.md rule 4 is written about.
     *
     * Both halves are derived now, so a new claimable property is exercised the moment it
     * exists, and a property REMOVED from the map stops being demanded here.
     */
    expect(CLAIMS.length).toBeGreaterThan(2); // the list is real, not an empty sweep
    expect(checkContract({ ...base, manifest: claimsEverything, editableDom: titlePage(allVars()) })).toEqual([]);
  });

  it("names EACH claim whose variable never arrived, one property at a time", () => {
    // A sweep rather than one spot check: the old version dropped every variable at once
    // and asserted the detail mentioned `--lse-weight`, which stays true even if five of
    // the six checks stopped reporting.
    for (const claim of CLAIMS) {
      const found = checkContract({
        ...base,
        manifest: claimsEverything,
        editableDom: titlePage(allVars(claim)),
      });
      const accused = found.filter((f) => f.check === "claim-ignored");
      // EXACTLY one, counted rather than searched: the other variables did arrive, and a
      // substring search would be fooled anyway (`--lse-font` is a prefix of
      // `--lse-fontstyle`).
      expect(accused.length, claim).toBe(1);
      expect(accused[0]!.detail, claim).toContain(CLAIMABLE_PROPS[claim]!.variable);
    }
  });

  it("reports a claim the bridge does not know as unsatisfiable", () => {
    const unknown: TemplateManifest = {
      ...MANIFEST,
      styles: [
        { key: "page", label: "Page", base: "bg-paper text-ink", scope: "site" },
        { key: "title", label: "Title", base: "block lse-owns-[levitation]" },
      ],
    };
    const found = checkContract({ ...base, manifest: unknown, editableDom: titlePage("") });
    expect(found.map((f) => f.check)).toContain("claim-ignored");
    expect(found.map((f) => f.detail).join(" ")).toContain("levitation");
  });

  it("says nothing about a region that claims nothing", () => {
    // Inlining is CORRECT for an unclaimed region — it is what keeps a site that opts
    // into nothing rendering exactly as it did.
    const unclaimed: TemplateManifest = {
      ...MANIFEST,
      styles: [{ key: "page", label: "Page", base: "bg-paper text-ink", scope: "site" }],
    };
    // Every OTHER declared key still marked, so the only thing this can report is rule 5.
    const inlined = dom(`
      <main data-lse-style="page" style="font-size: var(--lse-size)">
        <h1 data-lse-field="site_title" data-lse-text="">Title</h1>
        <ul data-lse-slot="shows"></ul><a data-lse-link="tickets"></a>
      </main>`);
    expect(checkContract({ ...base, manifest: unclaimed, editableDom: inlined })).toEqual([]);
  });
});


describe("a site whose ROOT element is itself a marked region", () => {
  /**
   * `withAttr` reads `root.hasAttribute?.(attr) ? [root, ...found] : found` — the root
   * counts as one of its own results, because a site whose whole page IS the region, or
   * one that hands the checker the section it is checking, marks the element it passes.
   * No fixture ever did that, so the `[root, ...]` half was dead in tests: deleting it
   * left every one of them green while a root-marked leak walked past rule 1, a
   * root-marked editable page read as "no markers at all", and a key marked only on the
   * root was reported as unmarked.
   */
  const COMPLIANT = `
    <main data-lse-style="page" style="--x:1">
      <h1 data-lse-style="title" data-lse-field="site_title" data-lse-text=""
          style="--lse-size: clamp(1.75rem,6.5vw,3rem)">Title</h1>
      <ul data-lse-slot="shows"><li data-lse-item="tour_date:1">A show</li></ul>
      <a data-lse-link="tickets" href="#">Tickets</a>
    </main>`;

  it("CRITICAL: a marker on the public page's own root is still a leak", () => {
    const leaky = asRoot(`<main data-lse-style="page"><h1>Title</h1></main>`);
    const found = checkContract({ ...base, publicDom: leaky });
    expect(found.map((f) => f.check)).toContain("public-markers");
    expect(found.find((f) => f.check === "public-markers")!.detail).toContain("data-lse-style");
  });

  it("counts a root-marked editable page as the witness", () => {
    // Its only marker is on the root. Read descendants alone and this page looks
    // unmarked — at which point the checker declares nothing was proved and every later
    // rule is skipped, on a site that is in fact marked correctly.
    const rooted = asRoot(`<main data-lse-style="page"></main>`);
    expect(checkContract({ ...base, editableDom: rooted }).map((f) => f.check)).not.toContain("no-witness");
  });

  it("accepts every declared key when one of them is marked on the root itself", () => {
    expect(checkContract({ ...base, editableDom: asRoot(COMPLIANT) })).toEqual([]);
  });
});

describe('the tokens.css check — the cheapest rule, and the most repeated failure', () => {
  it('CRITICAL: a site whose CSS never imports tokens.css is flagged', () => {
    // Without it every style class the editor applies arrives at runtime, Tailwind
    // compiles none of them, and every control except colour silently does nothing. Its
    // own header calls this "the drift bug of 2026-08-05, three times"; ftbk was the
    // fourth, and each time the symptom is a manager saying the sliders do nothing.
    const findings = checkContract({ ...base, mainCss: '@import "tailwindcss";' })
    expect(findings.map((f) => f.check)).toContain('tokens-not-compiled')
  })

  it('CRITICAL: a site that DOES import it passes', () => {
    // The other half: without this the check could pass by flagging everything.
    const findings = checkContract({
      ...base,
      mainCss: '@import "tailwindcss";\n@import "@samfox1/site-bridge/tokens.css";',
    })
    expect(findings.map((f) => f.check)).not.toContain('tokens-not-compiled')
  })

  it('a site that passes no CSS is not accused — the input is optional', () => {
    // Older connected sites call checkContract without it; silence must not become a
    // failure for them.
    expect(checkContract(base).map((f) => f.check)).not.toContain('tokens-not-compiled')
  })
})
