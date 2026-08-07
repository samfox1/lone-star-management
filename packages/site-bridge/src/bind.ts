/**
 * ONE BINDING for a site's registry (2026-08-07 deepening, candidate 2).
 *
 * The registry — region keys, labels, base classes — is site design and stays in the
 * site. But before this module, the package told each site to bind it TWICE: a
 * hand-written `regionProps` wrapper for the render side (the styles.ts docblock
 * literally printed the recipe) and a `regionBase` option into `mountFrameBridge` for
 * the frame side. Two homes for one fact, and the frame's just-fixed ordering hazard
 * was the demonstration of what a second, late binding costs.
 *
 * `bindSiteRegistry` is the whole site-side setup: bind once, next to the registry,
 * and every consumer — server render, edit-frame mount, windowed-item splits — reads
 * the same binding by construction.
 *
 *   // lib/styles.ts (a site)
 *   export const { regionProps, splitItemProps, mountFrameBridge } =
 *     bindSiteRegistry({ regionBase })
 *
 * The unbound 4-arg primitives stay exported from ./styles and ./frame for callers
 * that genuinely have no registry; this module is the interface sites are DOCUMENTED
 * against (SITE_INTEGRATION.md, the scaffold, skeen's migration step 2).
 */
import type { SiteStyles } from "./payload";
import {
  regionProps as rawRegionProps,
  splitItemProps as rawSplitItemProps,
} from "./styles";
import { mountFrameBridge as rawMount } from "./frame";

export type SiteRegistryBinding = {
  /** The site's lookup: region key → declared base classes ('' for unknown keys). */
  regionBase: (key: string) => string;
};

export function bindSiteRegistry(binding: SiteRegistryBinding): {
  regionBase: (key: string) => string;
  /** `regionProps` with `base` defaulting from THIS registry — the wrapper every site
   *  used to hand-write. An explicit `base` still wins (per-item regions). */
  regionProps: (
    styles: SiteStyles | undefined,
    key: string,
    editable?: boolean,
    base?: string,
  ) => ReturnType<typeof rawRegionProps>;
  /** Pass-through so the whole styled surface imports from one binding. */
  splitItemProps: typeof rawSplitItemProps;
  /** `mountFrameBridge` with the registry pre-bound into the style applier. */
  mountFrameBridge: (
    options: Omit<Parameters<typeof rawMount>[0], "regionBase">,
  ) => ReturnType<typeof rawMount>;
} {
  const { regionBase } = binding;
  return {
    regionBase,
    regionProps: (styles, key, editable = false, base = regionBase(key)) =>
      rawRegionProps(styles, key, editable, base),
    splitItemProps: rawSplitItemProps,
    mountFrameBridge: (options) => rawMount({ ...options, regionBase }),
  };
}
