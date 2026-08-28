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

// 71px = the dashboard header's rendered height (assets-rail.tsx says the same).
/**
 * The manager tools as a 76px icon rail — the ASSETS rail, one to one (Sam,
 * 2026-08-28: "mimic the side panel used on the assets page"). Icons stacked and
 * vertically centred, 10px mono labels, active = accent. Tool pages with sections (SEO /
 * GEO) put their sections in a pill row at the top of the page, not a second rail.
 */
export function ToolsRail({ artistId, active }: { artistId: string; active: string }) {
  return (
    <div className="hidden w-[76px] flex-none md:block">
      <nav
        aria-label="Manager tools"
        className="fixed left-0 top-[71px] flex h-[calc(100vh-71px)] w-[76px] flex-col border-r border-hairline bg-paper"
      >
        <div className="mt-[calc(50vh-71px)] flex -translate-y-1/2 flex-col gap-1 px-1.5">
          {TOOLS.map((t) => {
            const on = t.seg === active
            return (
              <Link
                key={t.seg}
                href={`/artists/${artistId}/${t.seg}`}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'flex flex-col items-center gap-1 rounded-lg py-2 transition-colors',
                  on ? 'text-accent' : 'text-ink-muted hover:bg-surface hover:text-ink',
                )}
              >
                <Icon name={t.icon} size={20} />
                <span className="max-w-[68px] truncate font-space text-[10px] tracking-[0.02em]">{t.short ?? t.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

/** Wraps the dashboard's page: on a tool route, the rail plus the page; elsewhere the
 *  page alone. One place, so every tool gets the rail and no tool can forget it. */
export function ToolsShell({ artistId, children }: { artistId: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const tool = toolFor(pathname, artistId)
  if (!tool) return <>{children}</>
  return (
    <div className="flex gap-8">
      <ToolsRail artistId={artistId} active={tool.seg} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
