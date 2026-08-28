'use client'

/**
 * Manager tools as ONE admin dashboard (Sam, 2026-08-28): a fixed side panel lists every
 * tool; the page beside it is the tool. Same language as the editor's inspector and the
 * assets rail — Space Mono, hairline border, accent-soft active row — so it reads as the
 * same app. Rendered by the dashboard layout on every tool route; nothing else changes:
 * the routes are what they were, the pages lose their copy-pasted "‹ Manager tools" links.
 */
import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { TOOLS, toolFor } from './tools-registry'

export { TOOLS, toolFor }
import { SEO_SECTIONS } from './tools/seo/sections'

// 71px = the dashboard header's rendered height (assets-rail.tsx says the same).
export function ToolsRail({ artistId, active, collapsed = false, onPick }: { artistId: string; active: string; collapsed?: boolean; onPick?: (seg: string) => void }) {
  return (
    // COLLAPSED (a tool with its own sections is open — Sam, 2026-08-28): the panel slides
    // off to the left, leaving a 10px edge; hovering that edge slides it back OVER the
    // section panel, and it hides again when the pointer leaves. Expanded: it holds its
    // own column, as before.
    <div className={cx('hidden md:block', collapsed ? 'w-0' : 'w-[232px] flex-none')} data-collapsed={collapsed || undefined}>
      <nav
        aria-label="Manager tools"
        className={cx(
          'group/tools fixed left-0 top-[71px] z-20 flex h-[calc(100vh-71px)] w-[232px] flex-col overflow-y-auto border-r border-hairline bg-paper font-space transition-transform duration-200 [scrollbar-width:none]',
          collapsed && '-translate-x-[222px] overflow-visible shadow-none hover:translate-x-0 hover:shadow-xl',
        )}
      >
        {/* The tab that says "there is a panel here" while collapsed (Sam, 2026-08-28). */}
        {collapsed && (
          <span aria-hidden className="absolute right-0 top-1/2 flex h-12 w-[10px] -translate-y-1/2 items-center justify-center bg-surface text-ink-faint">
            <Icon name="chevronRight" size={10} />
          </span>
        )}
        {/* One flat list, no group captions (Sam, 2026-08-28). */}
        <div className="flex flex-col gap-0.5 px-3 pt-4">
          {TOOLS.map((t) => {
            const on = t.seg === active
            return (
              <Link
                key={t.seg}
                href={`/artists/${artistId}/${t.seg}`}
                aria-current={on ? 'page' : undefined}
                onClick={() => onPick?.(t.seg)}
                className={cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-[12px] transition-colors',
                  on ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface hover:text-ink',
                )}
              >
                <Icon name={t.icon} size={16} />
                <span className="truncate">{t.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

/** Wraps the dashboard's page: on a tool route, the panel plus the page; elsewhere the
 *  page alone. One place, so every tool gets the panel and no tool can forget it. */
/** The SEO / GEO editor's sub-sections: a second panel to the right of the tools panel
 *  (Sam, 2026-08-28). Same language, one step narrower. */
export function SeoSubRail({ artistId, pathname }: { artistId: string; pathname: string }) {
  const base = `/artists/${artistId}/tools/seo`
  const active = pathname.slice(base.length).replace(/^\//, '').split('/')[0] || SEO_SECTIONS[0].seg
  return (
    // Takes the tools panel's place (left: 0); the collapsed tools panel peeks 10px at its
    // left edge and slides over it on hover.
    <div className="hidden w-[232px] flex-none md:block">
      <nav
        aria-label="SEO / GEO sections"
        className="fixed left-0 top-[71px] z-10 flex h-[calc(100vh-71px)] w-[232px] flex-col border-r border-hairline bg-paper pl-[10px] font-space"
      >
        <div className="flex flex-col gap-0.5 px-3 pt-4">
          {SEO_SECTIONS.map((s) => {
            const on = s.seg === active
            return (
              <Link
                key={s.seg}
                href={`${base}/${s.seg}`}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-[12px] transition-colors',
                  on ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-paper hover:text-ink',
                )}
              >
                <Icon name={s.icon} size={15} />
                <span className="truncate">{s.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

/** Tools whose page has its own section panel — the tools panel steps aside for them. */
const HAS_SECTIONS = new Set(['tools/seo'])

export function ToolsShell({ artistId, children }: { artistId: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const tool = toolFor(pathname, artistId)
  // Collapse the moment such a tool is CLICKED, not when its route finishes loading
  // (Sam, 2026-08-28). The pick is remembered WITH the pathname it was made on, so it
  // only counts until navigation completes — no effect, no setState-in-effect.
  const [picked, setPicked] = useState<{ seg: string; from: string } | null>(null)
  if (!tool) return <>{children}</>
  const pending = picked && picked.from === pathname ? picked.seg : null
  const sub = HAS_SECTIONS.has(pending ?? tool.seg)
  return (
    <div className="flex gap-8">
      <ToolsRail artistId={artistId} active={tool.seg} collapsed={sub} onPick={(seg) => setPicked({ seg, from: pathname })} />
      {sub && <SeoSubRail artistId={artistId} pathname={pathname} />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
