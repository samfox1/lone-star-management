import type { SeoTestAction } from '@/lib/seo-tests/types'

/**
 * THE SEO / GEO TOOL'S TABS (Sam, 2026-09-29): Details · Facts · Answers · AI test. Four tabs on
 * the thin rail's second panel, exactly like Brand and Settings: tools-registry.ts builds its
 * `tabs` from SEO_TABS below, so the rail, the routes and the tests all derive from this one list.
 *
 * `seg` is the route under /artists/[id]/tools/seo; Details is the tool's own route (''), as
 * every tabbed tool's first tab is, so the tool opens on it. Each tab has its own folder with a
 * page.tsx (tools/seo/page.tsx is Details); tools-rail.test.tsx fails a tab without one. The
 * Overview tab is gone (2026-09-29): its job, what needs doing and what changed, moved into the
 * AI test.
 */
export const SEO_SECTIONS = [
  { seg: '', label: 'Details' },
  { seg: 'facts', label: 'Facts' },
  { seg: 'answers', label: 'Answers' },
  { seg: 'test', label: 'AI test' },
] as const

export type SeoSection = (typeof SEO_SECTIONS)[number]['seg']

/** The tool's route under /artists/[id]/ (TOOLS' `seg`). */
export const SEO_BASE = 'tools/seo'

export function isSeoSection(s: string): s is SeoSection {
  return SEO_SECTIONS.some((x) => x.seg === s)
}

/** A tab's route under /artists/[id]/: `tools/seo` for Details, `tools/seo/test` for the AI test. */
export function seoTabSeg(seg: SeoSection): string {
  return seg ? `${SEO_BASE}/${seg}` : SEO_BASE
}

/** The tabs as the tools rail lists them (a ToolTab each). */
export const SEO_TABS: readonly { seg: string; label: string }[] = SEO_SECTIONS.map((s) => ({ seg: seoTabSeg(s.seg), label: s.label }))

/**
 * WHERE THE OLD ROUTES WENT. Nothing that worked was dropped: each old route now redirects to
 * its new home, to the row that holds it ([section]/page.tsx).
 *   Search listing → Details          Share image → Details, #share
 *   Alt tags       → Details, #alt    Facts       → Facts
 *   About (bio + where it shows) → Facts, #bio
 *   AI visibility  → Answers          Test        → AI test (the 24 plain-language tests)
 * `listing` was a tab of its own from 2026-09-28 until 2026-09-29, when it became Details, the
 * tool's own route. `facts` and `test` keep their names, so only the five below need a redirect.
 */
export const MOVED_SEO_SECTIONS: Readonly<Record<string, { to: SeoSection; hash?: string }>> = {
  listing: { to: '' },
  logo: { to: '', hash: 'share' },
  alt: { to: '', hash: 'alt' },
  about: { to: 'facts', hash: 'bio' },
  ai: { to: 'answers' },
}

type EditTarget = Extract<SeoTestAction, { kind: 'edit' }>['target']

/**
 * Where a test's pencil goes (SeoTestAction `edit`), as a path under /artists/[id]/. A Record
 * over the engine's own target union, so a target added to types.ts is a compile error here
 * until it has a home. The anchors (#share, #alt, #bio) are ids the Details and Facts pages
 * carry on the rows that hold those settings.
 */
export const SEO_EDIT_TARGETS: Readonly<Record<EditTarget, string>> = {
  listing: seoTabSeg(''),
  share: `${seoTabSeg('')}#share`,
  alt: `${seoTabSeg('')}#alt`,
  facts: seoTabSeg('facts'),
  bio: `${seoTabSeg('facts')}#bio`,
  answers: seoTabSeg('answers'),
  connections: 'connections',
  tour: 'tour',
  music: 'music',
}
