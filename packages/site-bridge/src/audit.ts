/**
 * Does this site tell the EDITOR everything it sets?
 *
 * An editor control reads a region's class string and nothing else. A value living on a
 * child element, in a CSS var fallback, or in a class the site's palette never declared
 * leaves the control blank while the site is plainly styled — the manager sees "not set"
 * on something obviously coloured or sized. That has caused five separate bugs across
 * three sites (icon size, hover colour, icon colour, a footer background, two palettes),
 * each found by hand after someone noticed a control reading wrong (Sam, 2026-08-15:
 * "everything that is set on the site should be seen in the editor").
 *
 * It lives in the package so a site can check ITSELF, in its own test suite, against its
 * own registry — rather than an outside script that has to be pointed at hand-made dumps
 * and only runs when someone remembers.
 *
 * Deliberately NOT a re-description of the editor's controls: this asks the three
 * questions that were actually bugs, and nothing else. An effect that is simply off
 * (no shadow, no glow) is not a finding, and a first pass that flagged those buried the
 * four real answers in 250 lines of noise.
 */

/** A region as the manifest declares it. */
export type AuditRegion = {
  key: string;
  base?: string;
  /** 'icons' groups are held to the extra rules their controls need. */
  scope?: string;
};

export type AuditFinding = { key: string; problem: string };

/**
 * Is this `text-*` token a COLOUR? Everything else sharing the prefix — sizes, alignment,
 * wrapping — belongs to other controls, which DO show it.
 */
const NON_COLOR_TEXT =
  /^text-(xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)/;
const ARBITRARY_HEX = /^(text|bg|border)-\[#[0-9a-fA-F]{3,8}\]$/;

/**
 * BORDER COLOURS are deliberately out of scope. The section panel has no border-colour
 * control — it is offered on per-ITEM regions only — so a hairline like `border-ink/15`
 * is not something any picker was ever going to show, and flagging it put a finding on
 * every divider in every registry (2026-08-15). The rule reports what a control could
 * display and stay silent about, which is text and background.
 */
function colorChannel(token: string): "text" | "bg" | null {
  const bare = token.replace(/^!/, "");
  if (bare.startsWith("border-")) return null;
  if (ARBITRARY_HEX.test(bare)) return bare.startsWith("bg-") ? "bg" : "text";
  if (bare.startsWith("bg-") && !bare.startsWith("bg-[")) return "bg";
  if (bare.startsWith("text-") && !bare.startsWith("text-[") && !NON_COLOR_TEXT.test(bare)) return "text";
  return null;
}

/**
 * Every place this site sets something its own editor could not show.
 *
 * `palette` is the site's declared colours (styleOptions.textColors + bgColors values) —
 * a colour the design wears but the palette never names is invisible to the picker, which
 * can only recognise a declared class or an arbitrary hex.
 */
export function auditRegions(regions: AuditRegion[], palette: string[]): AuditFinding[] {
  const declared = new Set(palette);
  const findings: AuditFinding[] = [];

  for (const region of regions) {
    const tokens = (region.base ?? "").split(/\s+/).filter(Boolean);

    // 1. A colour the region WEARS that no picker can recognise.
    for (const token of tokens) {
      const bare = token.replace(/^!/, "");
      if (!colorChannel(bare) || ARBITRARY_HEX.test(bare) || declared.has(bare)) continue;
      findings.push({ key: region.key, problem: `wears ${bare}, which the palette never declares` });
    }

    // 2. An ICON GROUP that has not declared what its icons look like. Its controls write
    //    CSS vars the icons read, so with nothing declared every one of them opens blank.
    if (region.scope === "icons") {
      if (!tokens.some((t) => t.startsWith("iconsize-["))) findings.push({ key: region.key, problem: "icon group declares no iconsize-[…]" });
      if (!tokens.some((t) => t.startsWith("hovercolor-["))) findings.push({ key: region.key, problem: "icon group declares no hovercolor-[…]" });
      if (!tokens.some((t) => colorChannel(t) === "text")) findings.push({ key: region.key, problem: "icon group declares no icon colour" });
    }
  }
  return findings;
}
