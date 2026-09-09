/**
 * The five tests of CONNECTING.md §7, as code a site runs against ITSELF.
 *
 * They were prose, so every site hand-wrote its own versions — and skeen, which had five
 * separate "the public site carries no markers" tests, still shipped `data-lse-field` and
 * `data-lse-text` on every public heading for weeks (2026-08-16). Each of those tests
 * asserted over the markers its OWN component emits; the leak came from a component none
 * of them rendered. A rule each site re-implements is a rule each site re-implements
 * slightly wrong, and the gaps are invisible by construction.
 *
 * Same shape as `auditRegions`, deliberately: it returns findings and the site asserts
 * they are empty, so it needs no test runner, no framework, and no opinion about how the
 * site renders. Hand it DOM and its manifest.
 *
 *     it('passes the connection contract', () => {
 *       expect(checkContract({
 *         manifest: EDIT_LIST,
 *         publicDom: render(<SiteBody site={site} />).container,
 *         editableDom: render(<SiteBody site={site} editable />).container,
 *         emptyDom: render(<SiteBody site={null} />).container,
 *         publishedValues: [site.config.instagram, site.bio[0]],
 *       })).toEqual([])
 *     })
 *
 * Every check that can be satisfied by a page rendering NOTHING carries a witness, because
 * that is the shape all of these failures take: an empty render passes "no markers"
 * perfectly, and looks exactly like a compliant one.
 */
import { auditRegions } from "./audit";
import {
  FIELD_ATTR,
  ITEM_ATTR,
  LINK_ATTR,
  SLOT_ATTR,
  STYLE_ATTR,
  TEXT_ATTR,
  WINDOW_ATTR,
} from "./markers";
import type { AuditRegion } from "./audit";

/**
 * What the check needs a manifest to have — STRUCTURAL, not `TemplateManifest`.
 *
 * A connected site legitimately keeps its own edit-list type (skeen's `EditList` carries
 * targetless fields, because a custom site's field key IS its site_content key). Demanding
 * the exact package type would make the check uncallable by the sites it exists for, which
 * is how a guard ends up commented out. It reads four lists and a palette; that is all it
 * asks for.
 */
export type ContractManifest = {
  styles: readonly AuditRegion[];
  fields: readonly { key: string; page?: string }[];
  slots: readonly { key: string; page?: string }[];
  links: readonly { key: string; rendered?: boolean; page?: string }[];
  /** The site's declared pages, in declaration order. Read only to NAME the pages in a
   *  duplicate-key finding — an untagged region belongs to the first, so the message can
   *  say "on home and on merch" rather than "on nothing and on merch". Absent = a
   *  single-page site, where a repeat is still a repeat. */
  pages?: readonly { key: string }[];
  styleOptions?: {
    textColors?: readonly { value: string }[];
    bgColors?: readonly { value: string }[];
  };
};

/** Every attribute the editor puts on a page. A fan must see none of them. */
export const MARKER_ATTRS = [
  STYLE_ATTR,
  WINDOW_ATTR,
  FIELD_ATTR,
  TEXT_ATTR,
  SLOT_ATTR,
  ITEM_ATTR,
  LINK_ATTR,
] as const;

export type ContractFinding = {
  /** Which of the five rules failed — stable, so a site can filter or expect one. */
  check:
    | "public-markers"
    | "no-witness"
    | "unmarked-key"
    | "undeclared-value"
    | "invented-content"
    | "no-empty-render"
    | "claim-ignored"
    /** The site's CSS never imports tokens.css, so nothing the editor applies as a class
     *  is compiled — every non-colour control silently does nothing. */
    | "tokens-not-compiled"
    /** One key declared twice in one list. Region keys are ONE FLAT NAMESPACE across every
     *  page (SITE_PAGES_PLAN.md D3), so two pages naming the same region share one stored
     *  row — restyle one and the other changes, silently. */
    | "duplicate-key";
  detail: string;
};

export type ContractInput = {
  manifest: ContractManifest;
  /** The page as a fan sees it. */
  publicDom: Element;
  /** The same page in edit mode — the witness for every "carries nothing" check. */
  editableDom: Element;
  /** The page with NO published payload. Optional; required to check rule 4. */
  emptyDom?: Element;
  /**
   * Strings that exist only because they were PUBLISHED — a bio, a social URL, a venue.
   * None may appear in `emptyDom`. This is rule 4 made checkable: "renders empty states"
   * is not something a package can recognise, but "does not show content nobody
   * published" is exactly what went wrong.
   */
  publishedValues?: string[];
  /**
   * The site's main stylesheet, as text.
   *
   * Optional, and the single most valuable thing a connecting site can pass. Everything
   * the editor applies that is not a colour is a Tailwind CLASS, and those classes arrive
   * from the DATABASE at runtime — the scanner never sees them, so nothing is compiled and
   * every one of them silently no-ops. `tokens.css` is this package's own vocabulary as
   * `@source inline(...)` directives, and importing it is what makes them real.
   *
   * Its header has called this "the drift bug of 2026-08-05, three times"; ftbk was the
   * fourth, and the symptom each time is a manager reporting that the sliders do nothing.
   * A comment in a file nobody opens was not enough, so it is a check.
   */
  mainCss?: string;
};

/** `lse-owns-[size]` / `lse-owns-[size,font]` in a base → the properties claimed. */
const CLAIM_TOKEN = /^lse-owns-\[([a-z,]+)\]$/;

/** A claimed property → the variable that must be set, and the property that must NOT be
 *  inlined over it. Inline beats every media query the site wrote, so an inlined value on
 *  a claimed region silently kills the site's own responsiveness. */
const CLAIMABLE: Record<string, { variable: string; property: string }> = {
  size: { variable: "--lse-size", property: "font-size" },
  font: { variable: "--lse-font", property: "font-family" },
  // The second wave (2026-08-17) — one row per TEXT_VARS family in styles.ts. The
  // contract-check test couples the two lists: a claim the checker does not know is
  // reported as unsatisfiable, which is how the coupling stays honest.
  weight: { variable: "--lse-weight", property: "font-weight" },
  align: { variable: "--lse-align", property: "text-align" },
  leading: { variable: "--lse-leading", property: "line-height" },
  tracking: { variable: "--lse-tracking", property: "letter-spacing" },
  case: { variable: "--lse-case", property: "text-transform" },
  italic: { variable: "--lse-fontstyle", property: "font-style" },
};

const attrSelector = (attr: string) => `[${attr}]`;

/** Elements carrying `attr`, including the root itself — a site whose whole page IS the
 *  region would otherwise read as unmarked. */
function withAttr(root: Element, attr: string): Element[] {
  const found = Array.from(root.querySelectorAll(attrSelector(attr)));
  return root.hasAttribute?.(attr) ? [root, ...found] : found;
}

function hasKey(root: Element, attr: string, key: string): boolean {
  return withAttr(root, attr).some((el) => el.getAttribute(attr) === key);
}

export function checkContract(input: ContractInput): ContractFinding[] {
  const { manifest, publicDom, editableDom, emptyDom, publishedValues } = input;
  const findings: ContractFinding[] = [];

  /* 0. The editor's vocabulary must be COMPILED. Cheapest possible check, biggest
   *    recurring failure: without this import every non-colour control silently does
   *    nothing on the live site, and nothing anywhere says why. */
  if (input.mainCss !== undefined && !input.mainCss.includes("@samfox1/site-bridge/tokens.css")) {
    findings.push({
      check: "tokens-not-compiled",
      detail:
        'the site\'s CSS does not import "@samfox1/site-bridge/tokens.css" — every style class the editor applies arrives at runtime, so Tailwind compiles none of them and every control except colour silently does nothing',
    });
  }

  /* 1. No editor furniture on the public page. */
  for (const attr of MARKER_ATTRS) {
    const leaked = withAttr(publicDom, attr);
    if (leaked.length) {
      findings.push({
        check: "public-markers",
        detail: `${attr} survives to the public page on <${leaked[0]!.tagName.toLowerCase()}> (${leaked.length} element${leaked.length > 1 ? "s" : ""})`,
      });
    }
  }

  /* The WITNESS for the check above, and for every "renders nothing" trap after it. A
   * page that renders nothing carries no markers, which is a pass that means nothing. */
  const markedInEditor = MARKER_ATTRS.some((attr) => withAttr(editableDom, attr).length > 0);
  if (!markedInEditor) {
    findings.push({
      check: "no-witness",
      detail:
        "the editable render carries no markers either, so nothing above was actually proved — check that editableDom really is the page in edit mode",
    });
  }

  /* 2. Every declared key is marked somewhere in the markup. A control that changes
   *    nothing, with no error anywhere, is the most common way to break the connection. */
  if (markedInEditor) {
    const declared: [string, string, string][] = [
      ...manifest.styles.map((r) => [STYLE_ATTR, r.key, "style region"] as [string, string, string]),
      ...manifest.fields.map((f) => [FIELD_ATTR, f.key, "field"] as [string, string, string]),
      ...manifest.slots.map((s) => [SLOT_ATTR, s.key, "slot"] as [string, string, string]),
      // A link that CONFIGURES something (a booking address the contact form sends to)
      // powers no element, so there is nothing to mark. It must say so — see
      // ManifestLinkRegion.rendered — because an unmarked link is otherwise
      // indistinguishable from a forgotten one.
      ...manifest.links
        .filter((l) => l.rendered !== false)
        .map((l) => [LINK_ATTR, l.key, "link"] as [string, string, string]),
    ];
    for (const [attr, key, kind] of declared) {
      if (!hasKey(editableDom, attr, key)) {
        findings.push({
          check: "unmarked-key",
          detail: `the manifest declares the ${kind} "${key}" but no element carries ${attr}="${key}" — its control will change nothing`,
        });
      }
    }
  }

  /* 2b. NO KEY IS DECLARED TWICE IN ONE LIST (SITE_PAGES_PLAN.md A6).
   *
   *     `page` is a TAG, never part of the key (D3) — `site_styles` rows are keyed by the
   *     bare key, and a prefix syntax would have cost a migration of every stored
   *     override. The price is this collision, and nothing else catches it: the DB's
   *     unique constraint makes the two SHARE a row rather than conflict, `applyStyleToDom`
   *     dresses every element matching the key, and the editor's merge resolves it
   *     first-wins. What a manager sees is the merch heading changing when they restyle
   *     the About one, with nothing anywhere saying why.
   *
   *     PER LIST, deliberately: a field `usb` and a link `usb` are rows in different
   *     tables, and a site may well name a style region after the field it dresses —
   *     skeen does. Flagging that would make the check unusable on the site it was
   *     written for. */
  const lists: [string, readonly { key: string; page?: string }[]][] = [
    ["style region", manifest.styles],
    ["field", manifest.fields],
    ["slot", manifest.slots],
    ["link", manifest.links],
  ];
  for (const [kind, entries] of lists) {
    const seen = new Map<string, string | undefined>();
    for (const entry of entries ?? []) {
      if (!seen.has(entry.key)) {
        seen.set(entry.key, entry.page);
        continue;
      }
      const first = seen.get(entry.key);
      // Both pages named, because the fix is to rename one of them and the reader has to
      // know which two are fighting. An untagged entry belongs to the first declared page
      // (the bridge's own rule), so it is described that way rather than as "no page".
      const where = (p: string | undefined) => p ?? manifest.pages?.[0]?.key ?? "the only page";
      findings.push({
        check: "duplicate-key",
        detail: `the ${kind} "${entry.key}" is declared twice — on ${where(first)} and on ${where(entry.page)}. Region keys are one flat namespace across pages, so both share a single stored row: restyling one changes the other.`,
      });
    }
  }

  /* 3. The self-audit: does the site tell the editor everything it sets? Delegated, never
   *    re-implemented, so the two cannot drift on what "declare what you set" means. */
  const palette = [
    ...(manifest.styleOptions?.textColors ?? []),
    ...(manifest.styleOptions?.bgColors ?? []),
  ].map((o) => o.value);
  for (const f of auditRegions(manifest.styles, palette)) {
    findings.push({ check: "undeclared-value", detail: `${f.key}: ${f.problem}` });
  }

  /* 4. An empty payload renders empty states, never invented content. */
  const wanted = (publishedValues ?? []).filter((v) => typeof v === "string" && v.trim().length > 2);
  if (wanted.length && !emptyDom) {
    findings.push({
      check: "no-empty-render",
      detail: "publishedValues were given but no emptyDom, so rule 4 was never checked",
    });
  } else if (wanted.length && emptyDom) {
    const html = emptyDom.innerHTML;
    for (const value of wanted) {
      if (html.includes(value)) {
        findings.push({
          check: "invented-content",
          detail: `"${value}" appears with nothing published — a fallback the editor cannot edit is indistinguishable from a broken binding`,
        });
      }
    }
  }

  /* 5. A claimed property arrives as a VARIABLE and is never inlined over. */
  for (const region of manifest.styles) {
    const claims = new Set<string>();
    for (const token of (region.base ?? "").split(/\s+/)) {
      const m = token.match(CLAIM_TOKEN);
      if (m) for (const p of m[1]!.split(",")) claims.add(p);
    }
    if (!claims.size) continue;
    const el = withAttr(editableDom, STYLE_ATTR).find(
      (e) => e.getAttribute(STYLE_ATTR) === region.key,
    ) as HTMLElement | undefined;
    // A missing element is already reported as an unmarked key; saying it twice helps
    // nobody.
    if (!el?.style) continue;
    for (const prop of claims) {
      const spec = CLAIMABLE[prop];
      if (!spec) {
        findings.push({
          check: "claim-ignored",
          detail: `${region.key} claims "${prop}", which nothing supplies — claimable properties are ${Object.keys(CLAIMABLE).join(", ")}`,
        });
        continue;
      }
      if (!el.style.getPropertyValue(spec.variable)) {
        findings.push({
          check: "claim-ignored",
          detail: `${region.key} claims ${prop} but ${spec.variable} never reached the element — declare the value in its base (e.g. size-[48px])`,
        });
      }
      if (el.style.getPropertyValue(spec.property)) {
        findings.push({
          check: "claim-ignored",
          detail: `${region.key} claims ${prop}, yet ${spec.property} is set inline — an inline value beats every media query the site wrote, which is the authority the claim exists to keep`,
        });
      }
    }
  }

  return findings;
}
