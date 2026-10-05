'use client'

/**
 * Manager tools as ONE admin dashboard (Sam, 2026-08-28): a side panel lists every
 * tool; the page beside it is the tool. Same language as the editor's inspector and the
 * assets rail — Space Mono, hairline border, accent-soft active row — so it reads as the
 * same app. Rendered by the dashboard layout on every tool route; nothing else changes:
 * the routes are what they were, the pages lose their copy-pasted "‹ Manager tools" links.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { TOOLS, tabFor, toolFor, toolsFor, type Tool } from './tools-registry'
import { NAV_HOVER } from '../../nav-hover'

export { TOOLS, tabFor, toolFor, toolsFor }

// FULL HEIGHT FROM THE TOP, UNDER THE HEADER (Sam, 2026-09-10). The rail used to start at
// top:71px — the header's height — so its border-right met the header's border-bottom.
// That held while scrolling, and broke the moment a Mac trackpad rubber-banded past the
// top: the STICKY header rides the bounce with the page, the FIXED rail did not, and
// the line came away from the bar by however far the page was pulled. Headless Chromium
// never bounces, which is why it could not be reproduced there.
//
// So the rail runs the whole window height from the very top, z-10, and the header (z-30,
// bg-paper) simply covers its top 71px. There is no number here that has to match the
// header's height. The icon group centres on 50vh of the VIEWPORT (assets-rail.tsx does
// the same).
//
// RIDING THE BOUNCE (Sam, 2026-10-01: "I liked how the top nav bar had some wiggle room
// to it… allow the side panels to move with the scroll like that too"). A `fixed` box
// is pinned to the window, so it held still while the rubber band pulled the page and the
// header away from it. The panels are now `sticky top-0 h-screen`, the same as the header:
// positioned by the page's own scroll, so they move with its bounce and the bar and the
// rails travel as one frame. In a normal scroll a sticky box at top:0 sits exactly where
// the fixed one did.
//
// A sticky box can only stick inside its parent, and the in-flow slot starts below the
// header and <main>'s padding. So each panel sits in a LANE (RAIL_LANE) that is absolute
// against the dashboard root (`relative`, layout.tsx): it starts at the top of the page,
// ends at the bottom, and the sticky panel inside it can stay at the window top for the
// whole scroll. Being absolute, the lane is out of the flow, so it pushes nothing: the
// in-flow slot still holds the page's left edge, and the thin rail still widens OVER the
// page on hover. Positioned against the root, so the lane ignores <main>'s padding and
// starts at x=0 (or right of the thin rail, for the second panel), as the fixed panels did.
//
// Headless Chromium does not bounce, so the bounce itself can only be checked by hand on
// a trackpad. What was measured (2026-10-01) is that nothing else moved: every panel's box
// at every scroll offset, before and after, on a tabbed tool, a plain one and an assets page.
/**
 * The lane each side panel rides in (the tools rail, the second panel, the assets rail).
 *
 * `round(100%, 1px)`, not `bottom-0`: the root's height is often fractional (829.875px on
 * SEO/GEO), and Chrome rounds the page's scroll height to the NEAREST whole pixel (830).
 * A lane ending at 829.875 is then short by the difference, and at the very bottom of
 * the scroll the sticky panel was pushed up by it (measured: up to half a pixel). Rounded
 * the same way, the lane ends exactly where the page does, and never past it, so it adds
 * no scroll of its own.
 *
 * `bottom-0` stays as the FALLBACK: a browser without CSS round() drops that height as
 * invalid, and top + bottom size the lane. Where round() works, the height wins over bottom.
 */
export const RAIL_LANE = 'absolute top-0 bottom-0 h-[round(100%,1px)]'
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
/** The second panel's FLOOR, beside the rail when a tool has sub-tabs. Text only, and
 *  otherwise as wide as its longest label (Sam, 2026-09-23: "Tab icon" never wraps or
 *  truncates; the page shifts over instead). 96px still holds "General" with room. */
const SUB_RAIL_MIN = 'min-w-[96px]'

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
const railColumnTop = (count: number) => (count * RAIL_ITEM_H + (count - 1) * RAIL_ITEM_GAP) / 2

function ToolsRail({ artistId, active, collapsed = false, tools = TOOLS }: { artistId: string; active: string; collapsed?: boolean; tools?: readonly Tool[] }) {
  return (
    // Collapsed (a tabbed tool), this in-flow slot lies exactly under the rail and draws
    // the SAME line the whole height of the page (see ToolsShell: FULL-HEIGHT LINES).
    <div data-rail-slot="" className={cx('hidden flex-none md:block', collapsed && 'md:border-r md:border-hairline')} style={{ width: collapsed ? RAIL_COLLAPSED_W : RAIL_W }}>
      {/* The full-page lane the sticky rail rides in — see RIDING THE BOUNCE above. */}
      <div className={cx(RAIL_LANE, 'left-0')}>
        <nav
          aria-label="Manager tools"
          data-collapsed={collapsed ? 'true' : 'false'}
          // z-20 while thin: the hover-widened rail has to paint OVER the second panel, which
          // sits at the same level and starts where the thin rail ends. Header (z-30) wins.
          className={cx(
            'group sticky top-0 flex h-screen flex-col overflow-hidden border-r border-hairline bg-paper transition-[width] duration-150',
            collapsed ? 'z-20 w-[52px] hover:w-[84px]' : 'z-10 w-[84px]',
          )}
        >
          {/* Stretches to the nav, so the icons re-centre as it widens. Deliberately NOT a
              fixed width — see the note on RAIL_COLLAPSED_W. */}
          <div className="mt-[50vh] flex -translate-y-1/2 flex-col gap-1 px-1.5">
            {tools.map((t) => {
              const on = t.seg === active
              return (
                <Link
                  key={t.seg}
                  href={`/artists/${artistId}/${t.seg}`}
                  aria-current={on ? 'page' : undefined}
                  style={{ height: RAIL_ITEM_H }}
                  className={cx(
                    'flex flex-col items-center justify-center gap-1 rounded-lg py-2 transition-colors',
                    on ? 'text-accent' : `text-ink-muted ${NAV_HOVER}`,
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
    </div>
  )
}

/**
 * The second panel: a tool's sub-tabs, beside the thin rail. Same language as the rail
 * (sticky, hairline, mono, accent when current) but TEXT ONLY — the rail beside it already
 * shows the tool's icon, and a second column of icons said nothing the first had not
 * (Sam, 2026-09-22: "I dont need icons on the right rail").
 */
function SubRail({ artistId, tool, activeSeg, railCount }: { artistId: string; tool: Tool; activeSeg: string; railCount: number }) {
  const tabs = tool.tabs ?? []
  return (
    // THE WIDTH IS THE LONGEST LABEL (Sam, 2026-09-23). The panel hangs in an absolute
    // lane (RIDING THE BOUNCE, above), and an out-of-flow box pushes nothing, so the slot
    // it leaves in the page's flow is held open by an invisible copy of every label, laid
    // out exactly as the panel lays them out (same
    // paddings, same font, BOLD so the current tab's weight can never outgrow it). Both are
    // `w-max`, so they come to the same width and the page starts where the panel ends —
    // whichever tool, whichever labels. No number to keep in step with the copy.
    // The slot's own 1px line stands in for the panel's border in the sizing sum (the sizer
    // no longer carries a transparent one), so slot and panel are the same width, and the
    // line runs the whole height of the page (see ToolsShell: FULL-HEIGHT LINES).
    <div data-panel-slot="" className="hidden flex-none md:block md:border-r md:border-hairline">
      <div aria-hidden="true" className={cx('invisible flex w-max flex-col px-2', SUB_RAIL_MIN)}>
        {tabs.map((t) => (
          <span key={t.seg} className="whitespace-nowrap px-2.5 font-space text-[13px] font-bold tracking-[0.02em]">
            {t.label}
          </span>
        ))}
      </div>
      {/* Its full-page lane starts where the thin rail ends. */}
      <div className={RAIL_LANE} style={{ left: RAIL_COLLAPSED_W }}>
        <nav
          aria-label={tool.label}
          className={cx('sticky top-0 z-10 flex h-screen w-max flex-col border-r border-hairline bg-paper', SUB_RAIL_MIN)}
        >
          {/* The RAIL's offset, not its own — see RAIL_COLUMN_TOP. No `-translate-y-1/2`:
              that would re-centre it on its own short height and undo the alignment. */}
          <div className="flex flex-col gap-1 px-2" style={{ marginTop: `calc(50vh - ${railColumnTop(railCount)}px)` }}>
            {tabs.map((t) => {
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
                    // the same width — the row cannot reflow just because it is selected.
                    on ? 'font-bold text-ink' : `text-ink-muted ${NAV_HOVER}`,
                  )}
                >
                  {/* nowrap, never `truncate`: a label is read whole or the panel widens. */}
                  <span className="whitespace-nowrap font-space text-[13px] tracking-[0.02em]">{t.label}</span>
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    </div>
  )
}

/**
 * A tool's sub-tabs on a PHONE (visual check, 2026-09-23). Below md the rail and the second
 * panel are hidden, which left Brand's Colors / Fonts / Tab icon and Settings' Email with no
 * way in. This row sits above the page instead: the same links, text only, the current one
 * bold black like the panel's. It WRAPS, never scrolls sideways, and every label is nowrap,
 * so at 390px it takes a second line before it would ever widen the page.
 */
function SubTabStrip({ artistId, tool, activeSeg }: { artistId: string; tool: Tool; activeSeg: string }) {
  return (
    <nav aria-label={`${tool.label} tabs`} className="-mt-3 mb-5 flex flex-wrap gap-1 md:hidden">
      {(tool.tabs ?? []).map((t) => {
        const on = t.seg === activeSeg
        return (
          <Link
            key={t.seg}
            href={`/artists/${artistId}/${t.seg}`}
            aria-current={on ? 'page' : undefined}
            className={cx(
              'whitespace-nowrap rounded-lg px-2.5 py-2 font-space text-[13px] tracking-[0.02em] transition-colors',
              on ? 'bg-surface font-bold text-ink' : `text-ink-muted ${NAV_HOVER}`,
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * ONE PAGE WIDTH FOR EVERY TOOL (Batch 3, Sam 2026-10-02, prototypes/batch3_20261002.html
 * "Width": "I like all of your proposed ones"). Brand's frame, set HERE once: up to 1180px,
 * left-aligned beside the rail, and `pb-28` of room under the last row (a page's rising Publish
 * bar adds its own measured height on top, publish-riser.tsx). Six widths before this (768
 * centred, 800, 1000, 660, none…), each page carrying its own. Pages set no width of their own
 * now; one narrower only where reading is the job, centred in this frame: the AI test (660px)
 * and SEO › Profiles (800px), Sam 2026-10-05.
 *
 * On the page's own column, not a wrapper inside it: flex-1 grows to the cap and stops, so
 * the frame sits left with no extra element between the shell and the page.
 */
export const TOOL_FRAME = 'max-w-[1180px] pb-28'

/** Wraps the dashboard's page: on a tool route, the rail plus the page; elsewhere the
 *  page alone. One place, so every tool gets the rail and no tool can forget it. A tool
 *  with sub-tabs collapses the rail and adds the second panel. */
export function ToolsShell({ artistId, customSite = false, children }: { artistId: string; customSite?: boolean; children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const tool = toolFor(pathname, artistId)
  if (!tool) return <>{children}</>
  const tab = tabFor(tool, pathname, artistId)
  // The rail's list, not TOOLS: the Site tool leaves it for a custom-site artist, and the
  // second panel's offset has to count the rows that are actually there.
  const tools = toolsFor(customSite)
  if (!tab) {
    return (
      <div className="flex gap-8">
        <ToolsRail artistId={artistId} active={tool.seg} tools={tools} />
        <div data-tool-frame="" className={cx('min-w-0 flex-1', TOOL_FRAME)}>
          {children}
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-8">
      {/* ONE slot for both panels, 32px from the page (visual check, 2026-09-23: the
          mock's gap; it was ~92px). The panels sit at x=0 (their lanes are positioned
          against the dashboard root, not this slot), but this slot sits inside
          <main>'s px-7 (layout.tsx), so each placeholder started 28px right of its panel
          and the shell's gap-8 ran twice. `md:-ml-7` pulls the pair back under their
          panels, with no gap between them; the shell's one gap-8 is then the whole gap.
          The test reads main's padding from layout.tsx, so the two cannot drift apart. */}
      {/* FULL-HEIGHT LINES (Sam, 2026-09-29: "the column stops partway down the page"). The
          two panels are `h-screen` (fixed then, sticky now), so they end one window-height
          down wherever the page is captured whole (a full-page screenshot). The in-flow
          slots under them carry the same two lines, stretched the page's full height and,
          with `md:-mb-8`, over <main>'s bottom padding too. Inside the window the panels
          (bg-paper) cover them, so there is only ever one line. */}
      <div className="hidden flex-none md:-mb-8 md:-ml-7 md:flex">
        <ToolsRail artistId={artistId} active={tool.seg} collapsed tools={tools} />
        <SubRail artistId={artistId} tool={tool} activeSeg={tab.seg} railCount={tools.length} />
      </div>
      <div data-tool-frame="" className={cx('min-w-0 flex-1', TOOL_FRAME)}>
        <SubTabStrip artistId={artistId} tool={tool} activeSeg={tab.seg} />
        {children}
      </div>
    </div>
  )
}
