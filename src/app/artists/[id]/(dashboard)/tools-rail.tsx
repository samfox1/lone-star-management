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
import { TOOLS, toolFor } from './tools-registry'

export { TOOLS, toolFor }
import { SEO_SECTIONS } from './tools/seo/sections'

// 71px = the dashboard header's rendered height (assets-rail.tsx says the same).
export function ToolsRail({ artistId, active }: { artistId: string; active: string }) {
  return (
    <div className="hidden w-[232px] flex-none md:block">
      <nav
        aria-label="Manager tools"
        className="fixed left-0 top-[71px] flex h-[calc(100vh-71px)] w-[232px] flex-col overflow-y-auto border-r border-hairline bg-paper font-space [scrollbar-width:none]"
      >
        {/* One flat list, no group captions (Sam, 2026-08-28). */}
        <div className="flex flex-col gap-0.5 px-3 pt-4">
          {TOOLS.map((t) => {
            const on = t.seg === active
            return (
              <Link
                key={t.seg}
                href={`/artists/${artistId}/${t.seg}`}
                aria-current={on ? 'page' : undefined}
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
    <div className="hidden w-[200px] flex-none md:block">
      <nav
        aria-label="SEO / GEO sections"
        className="fixed left-[232px] top-[71px] flex h-[calc(100vh-71px)] w-[200px] flex-col border-r border-hairline bg-surface font-space"
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

export function ToolsShell({ artistId, children }: { artistId: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const tool = toolFor(pathname, artistId)
  if (!tool) return <>{children}</>
  const sub = tool.seg === 'tools/seo'
  return (
    <div className="flex gap-8">
      <ToolsRail artistId={artistId} active={tool.seg} />
      {sub && <SeoSubRail artistId={artistId} pathname={pathname} />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
