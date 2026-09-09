'use client'

import type { ManifestPage } from '@/lib/site-editor/manifest'

/**
 * WHICH PAGE THE FRAME IS SHOWING, and how a manager moves it (SITE_PAGES_PLAN.md P2).
 *
 * A strip at the very top of the inspector, above the panels, because it scopes all of
 * them: every page-scoped category narrows to the page named here (D5, see
 * CATEGORY_IS_PAGE_SCOPED). It sits outside the panel chrome so it survives opening a
 * panel and backing out of one — the page a manager is on is not a property of the panel
 * they happen to have open.
 *
 * ITS OWN FILE, small and dumb, deliberately. The plan's closing paragraph names /edit as
 * where this design rots if it rots, and the same pressure applies on this side: the
 * inspector is already 1200 lines, and a switcher that grew branches inside it would be
 * the thing nobody wants to touch when page four arrives.
 *
 * THREE RULES, each a trap the plan named:
 *
 *  1. It renders `pages` VERBATIM — never filtered, never reordered, never guessed at.
 *     Availability is the SITE's to resolve (C4: skeen's /about exists exactly while the
 *     bio lives there), and the site re-announces when the SET of pages changes, not only
 *     when the page on screen does (skeen b3b38b8). A second opinion here is how the two
 *     sides drift.
 *
 *  2. It does NOT move its own marker on click. `onSelect` posts `set-page` and waits;
 *     the frame's `page-change` is what moves `current`. So an older frame that ignores
 *     the message leaves this strip truthfully on the page still showing, instead of
 *     latching the editor to a page it is not displaying.
 *
 *  3. `current: null` is a normal state — before the first `page-change`, and after the
 *     page a manager was on is evicted from the declaration. Nothing is marked then.
 *     Marking the first tab would be a guess, wrong on any site whose frame opens
 *     somewhere else.
 *
 * Under two pages it renders nothing: a control offering one choice is furniture, and
 * every site that predates this feature declares no pages at all.
 */
export function PageSwitcher({
  pages,
  current,
  onSelect,
}: {
  /** The site's declared pages, straight off the merged manifest. */
  pages: readonly ManifestPage[] | undefined
  /** The page the FRAME says it is showing, or null before it has said. */
  current: string | null
  /** Ask the frame to switch. Fires even for the page already showing — a frame that
   *  failed to render is one a manager re-clicks, and swallowing that would leave a
   *  full page reload as the only way back. */
  onSelect: (page: string) => void
}) {
  if (!pages || pages.length < 2) return null
  return (
    // No heading and no caption: three words in a row are self-evident, and the standing
    // rule is that the editor explains itself by being obvious (`no-instruction-copy`).
    <div role="tablist" aria-label="Page" className="flex flex-none gap-1 border-b border-hairline px-3 py-2">
      {pages.map((p) => {
        const selected = p.key === current
        return (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(p.key)}
            className={
              'rounded-lg px-2.5 py-1.5 font-space text-[11px] font-bold uppercase tracking-[0.06em] transition-colors ' +
              (selected
                ? 'bg-ink text-paper'
                : 'text-ink-muted hover:text-ink')
            }
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}
