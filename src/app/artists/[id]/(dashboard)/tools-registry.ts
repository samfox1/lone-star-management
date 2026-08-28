import type { IconName } from '@/components/ui/icons'

/**
 * The manager-tools registry. A PLAIN module on purpose: tools-rail.tsx is 'use client',
 * and a server page that imports a const from a client module gets a client-reference
 * stub, not the array ("TOOLS.filter is not a function", 2026-08-28). Anything that is
 * data, not a component, lives here.
 */
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

