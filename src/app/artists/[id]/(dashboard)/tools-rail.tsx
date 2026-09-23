'use client'

/**
 * Manager tools as ONE admin dashboard (Sam, 2026-08-28): a fixed side panel lists every
 * tool; the page beside it is the tool. Same language as the editor's inspector and the
 * assets rail — Space Mono, hairline border, accent-soft active row — so it reads as the
 * same app. Rendered by the dashboard layout on every tool route; nothing else changes:
 * the routes are what they were, the pages lose their copy-pasted "‹ Manager tools" links.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { TOOLS, tabFor, toolFor, type Tool } from './tools-registry'

export { TOOLS, tabFor, toolFor }

// FULL HEIGHT FROM THE TOP, UNDER THE HEADER (Sam, 2026-09-10). The rail used to start at
// top:71px — the header's height — so its border-right met the header's border-bottom.
// That held while scrolling, and broke the moment a Mac trackpad rubber-banded past the
// top: the STICKY header rides the bounce with the page, the FIXED rail does not, and
// the line came away from the bar by however far the page was pulled. Headless Chromium
// never bounces, which is why it could not be reproduced there.
//
// So the rail now runs the whole viewport, z-10, and the header (z-30, bg-paper) simply
// covers its top 71px — and, during a bounce, the gap ABOVE itself too, via a screen-tall
// `::before` hung off the header (layout.tsx). Without that cover the full-height line
// showed above the bar for the length of the bounce, which was the next screenshot. The line is continuous behind the bar at every scroll offset and
// through the bounce, and there is no longer a number here that has to match the
// header's height. The icon group centres on 50vh of the VIEWPORT, which is where it
// already sat (assets-rail.tsx does the same).
/**
 * The manager tools as a 84px icon rail — the ASSETS rail, one to one (Sam,
 * 2026-08-28: "mimic the side panel used on the assets page"). Icons stacked and
 * vertically centred, 10px mono labels, active = accent. Tool pages with sections (SEO /
 * GEO) put their sections in a pill row at the top of the page, not a second rail.
 */
/**
 * The rail is thin on a tabbed tool and widens on hover, the icons re-centre with it, and
 * nothing moves VERTICALLY (Sam, 2026-09-22, with a screenshot: "it should horizontally
 * center just not move vertical position").
 *
 *   HORIZONTAL MOVEMENT IS THE POINT. The icon column fills the nav, so each icon is
 *   centred at 26px while thin and 42px while hovered, sliding across with the width. An
 *   earlier attempt pinned the column to a fixed width to hold the icons still — that
 *   killed the slide but left them visibly off-centre in the widened rail, which is the
 *   screenshot above. Do not re-pin it.
 *
 *   VERTICAL MOVEMENT IS THE BUG. The labels must fade with `opacity-0`, never `hidden`.
 *   `hidden` drops them from the flow, so every row gets shorter, and this column is
 *   centred on 50vh via `-translate-y-1/2` — the whole stack slides up and down on hover.
 *   `opacity-0` keeps each label's height, which is what holds the icons on their lines.
 *
 *   The labels are only ever READ in the widened state, where the column is the full 84px
 *   and every one of them fits. That is why the thin width is free to be genuinely thin.
 */
const RAIL_W = 84
/** Thin state: the icon and its breathing room, nothing else. */
const RAIL_COLLAPSED_W = 52
/** The second panel, beside the rail when a tool has sub-tabs. Text only, so only as wide
 *  as a short tab name needs — 60px of it after the paddings, which holds "General" at
 *  13px Space Mono. Longer names `truncate`. */
const SUB_RAIL_W = 96

/**
 * One tools-rail row: py-2 (16) + the 20px icon + gap-1 (4) + the label's 12px line box.
 * Set on each row as its HEIGHT, not just assumed: left to its content the label took the
 * default 1.5 line-height (15px), rows came to ~55px, and the second panel sat ~13px above
 * the rail's first icon (review 2026-09-23).
 */
const RAIL_ITEM_H = 52
const RAIL_ITEM_GAP = 4
/**
 * How far above the middle the tools rail's FIRST row starts.
 *
 * That column is `mt-[50vh] -translate-y-1/2`, so it is centred on the viewport and its
 * top lands at `50vh - height/2`. The second panel used the same two classes, which centred
 * ITS column too — and with two tabs against nine tools that put the panel halfway down an
 * empty rail while the tools' first icon sat near the top (Sam, 2026-09-22, screenshot).
 * The panel now starts at the RAIL's offset instead of its own, so the two top icons line
 * up. Derived from TOOLS, so adding a tool moves both together.
 */
const RAIL_COLUMN_TOP = (TOOLS.length * RAIL_ITEM_H + (TOOLS.length - 1) * RAIL_ITEM_GAP) / 2

export function ToolsRail({ artistId, active, collapsed = false }: { artistId: string; active: string; collapsed?: boolean }) {
  return (
    <div className="hidden flex-none md:block" style={{ width: collapsed ? RAIL_COLLAPSED_W : RAIL_W }}>
      <nav
        aria-label="Manager tools"
        data-collapsed={collapsed ? 'true' : 'false'}
        // z-20 while thin: the hover-widened rail has to paint OVER the second panel, which
        // is fixed at the same level and starts where the thin rail ends. Header (z-30) wins.
        className={cx(
          'group fixed left-0 top-0 flex h-screen flex-col overflow-hidden border-r border-hairline bg-paper transition-[width] duration-150',
          collapsed ? 'z-20 w-[52px] hover:w-[84px]' : 'z-10 w-[84px]',
        )}
      >
        {/* Stretches to the nav, so the icons re-centre as it widens. Deliberately NOT a
            fixed width — see the note on RAIL_COLLAPSED_W. */}
        <div className="mt-[50vh] flex -translate-y-1/2 flex-col gap-1 px-1.5">
          {TOOLS.map((t) => {
            const on = t.seg === active
            return (
              <Link
                key={t.seg}
                href={`/artists/${artistId}/${t.seg}`}
                aria-current={on ? 'page' : undefined}
                style={{ height: RAIL_ITEM_H }}
                className={cx(
                  'flex flex-col items-center justify-center gap-1 rounded-lg py-2 transition-colors',
                  on ? 'text-accent' : 'text-ink-muted hover:bg-surface hover:text-ink',
                )}
              >
                <Icon name={t.icon} size={20} />
                <span
                  className={cx(
                    'max-w-[84px] truncate font-space text-[10px] leading-[12px] tracking-[0.02em] transition-opacity duration-150',
                    // opacity, NEVER `hidden`: the label keeps its height even while
                    // invisible, which is what stops the stack sliding vertically on hover.
                    collapsed && 'opacity-0 group-hover:opacity-100',
                  )}
                >
                  {t.short ?? t.label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

/**
 * The second panel: a tool's sub-tabs, beside the thin rail. Same language as the rail
 * (fixed, hairline, mono, accent when current) but TEXT ONLY — the rail beside it already
 * shows the tool's icon, and a second column of icons said nothing the first had not
 * (Sam, 2026-09-22: "I dont need icons on the right rail").
 */
export function SubRail({ artistId, tool, activeSeg }: { artistId: string; tool: Tool; activeSeg: string }) {
  return (
    <div className="hidden flex-none md:block" style={{ width: SUB_RAIL_W }}>
      <nav
        aria-label={tool.label}
        className="fixed top-0 z-10 flex h-screen flex-col border-r border-hairline bg-paper"
        style={{ left: RAIL_COLLAPSED_W, width: SUB_RAIL_W }}
      >
        {/* The RAIL's offset, not its own — see RAIL_COLUMN_TOP. No `-translate-y-1/2`:
            that would re-centre it on its own short height and undo the alignment. */}
        <div className="flex flex-col gap-1 px-2" style={{ marginTop: `calc(50vh - ${RAIL_COLUMN_TOP}px)` }}>
          {(tool.tabs ?? []).map((t) => {
            const on = t.seg === activeSeg
            return (
              <Link
                key={t.seg}
                href={`/artists/${artistId}/${t.seg}`}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'flex items-center rounded-lg px-2.5 py-2 transition-colors',
                  // Bold BLACK for the current tab (Sam, 2026-09-23; it was accent for a day).
                  // The rail beside it already lights the tool in accent, and a second blue
                  // read as two selections. Space Mono is monospaced, so the bold weight is
                  // the same width — the row cannot reflow or truncate just because it is
                  // selected.
                  on ? 'font-bold text-ink' : 'text-ink-muted hover:bg-surface hover:text-ink',
                )}
              >
                <span className="truncate font-space text-[13px] tracking-[0.02em]">{t.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

/** Wraps the dashboard's page: on a tool route, the rail plus the page; elsewhere the
 *  page alone. One place, so every tool gets the rail and no tool can forget it. A tool
 *  with sub-tabs collapses the rail and adds the second panel. */
export function ToolsShell({ artistId, children }: { artistId: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const tool = toolFor(pathname, artistId)
  if (!tool) return <>{children}</>
  const tab = tabFor(tool, pathname, artistId)
  return (
    <div className="flex gap-8">
      <ToolsRail artistId={artistId} active={tool.seg} collapsed={tab !== null} />
      {tab ? <SubRail artistId={artistId} tool={tool} activeSeg={tab.seg} /> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
