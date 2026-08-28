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
import { Icon, type IconName } from '@/components/ui/icons'

/** The registry: what the panel lists, in order. `seg` is the route segment under
 *  /artists/[id]/. Derive from this — never hand-list tools elsewhere. */
export const TOOLS: readonly { seg: string; icon: IconName; label: string; desc: string }[] = [
  { seg: 'tools', icon: 'grid', label: 'Overview', desc: 'Status, publish, quick links' },
  { seg: 'site', icon: 'site', label: 'Site & profile', desc: 'Template, site text, photos & video' },
  { seg: 'brand', icon: 'photo', label: 'Brand', desc: 'Logos, fonts & browser tab icon' },
  { seg: 'links', icon: 'links', label: 'Links', desc: 'Social & external links' },
  { seg: 'tools/seo', icon: 'search', label: 'SEO / GEO', desc: 'Search, social & AI answers' },
  { seg: 'epk', icon: 'epk', label: 'Press kit', desc: 'Shareable EPK one-pager' },
  { seg: 'subscribers', icon: 'list', label: 'Subscribers', desc: 'Emails from the site popup' },
  { seg: 'enquiries', icon: 'note', label: 'Enquiries', desc: 'Booking & contact messages' },
  { seg: 'tools/integrations', icon: 'integrations', label: 'Integrations', desc: 'Connected data sources' },
  { seg: 'settings', icon: 'settings', label: 'Settings', desc: 'Artist settings' },
]

/** The tool a pathname is on, or null when the pathname is not a tool route. Longest
 *  segment wins so `tools/seo` beats `tools`. */
export function toolFor(pathname: string, artistId: string): (typeof TOOLS)[number] | null {
  const base = `/artists/${artistId}/`
  if (!pathname.startsWith(base)) return null
  const rest = pathname.slice(base.length).replace(/\/+$/, '')
  const hits = TOOLS.filter((t) => rest === t.seg || rest.startsWith(`${t.seg}/`))
  return hits.sort((a, b) => b.seg.length - a.seg.length)[0] ?? null
}

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
export function ToolsShell({ artistId, children }: { artistId: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const tool = toolFor(pathname ?? '', artistId)
  if (!tool) return <>{children}</>
  return (
    <div className="flex gap-8">
      <ToolsRail artistId={artistId} active={tool.seg} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
