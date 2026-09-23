import type { IconName } from '@/components/ui/icons'

/**
 * The manager-tools registry. A PLAIN module on purpose: tools-rail.tsx is 'use client',
 * and a server page that imports a const from a client module gets a client-reference
 * stub, not the array ("TOOLS.filter is not a function", 2026-08-28). Anything that is
 * data, not a component, lives here.
 */
/** A tool's sub-tab: a route under the tool, shown in the second panel. Text only — the
 *  rail beside it already carries the icon for the whole tool (Sam, 2026-09-22). */
export type ToolTab = { seg: string; label: string }

export type Tool = {
  seg: string
  icon: IconName
  label: string
  short?: string
  desc: string
  tabs?: readonly ToolTab[]
  /** Only meaningful while the artist's site is one of OUR templates. `toolsFor(true)`
   *  drops it once a custom site is connected (Sam, 2026-09-23: "remove it for now"). */
  templateOnly?: true
}

/** The registry: what the panel lists, in order. `seg` is the route segment under
 *  /artists/[id]/. Derive from this — never hand-list tools elsewhere.
 *
 *  A tool with `tabs` (Sam, 2026-09-22: "when the user clicks on settings, the furthest
 *  left panel turns to just the icons, and then a new side panel is to the right with the
 *  settings sub tabs") collapses the tools rail to icons and opens a second panel listing
 *  the tabs. The first tab's seg is the tool's own route. */
/*  Icons chosen by Sam on 2026-09-23 from the picker (prototypes/icon_picker_20260923.html):
 *  Iconoir, Heroicons, Lucide and Phosphor glyphs, all redrawn through the site's own
 *  <Icon> wrapper (24 grid, 1.6 stroke). Notices in LICENSES/icons.md. */
export const TOOLS: readonly Tool[] = [
  { seg: 'tools', icon: 'home', label: 'Overview', desc: 'Status, publish, quick links' },
  { seg: 'site', icon: 'internet', label: 'Site & profile', short: 'Site', desc: 'Template, site text, photos & video', templateOnly: true },
  { seg: 'brand', icon: 'sparkles', label: 'Brand', desc: 'Logos, fonts & browser tab icon' },
  { seg: 'connections', icon: 'plug', label: 'Connections', desc: 'Profiles & connected services' },
  { seg: 'tools/seo', icon: 'compass', label: 'SEO / GEO', short: 'SEO/GEO', desc: 'Search, social & AI answers' },
  { seg: 'epk', icon: 'package', label: 'Press kit', desc: 'Shareable EPK one-pager' },
  { seg: 'subscribers', icon: 'userGroup', label: 'Subscribers', desc: 'Emails from the site popup' },
  { seg: 'enquiries', icon: 'mailbox', label: 'Enquiries', desc: 'Booking & contact messages' },
  {
    seg: 'settings',
    icon: 'settings',
    label: 'Settings',
    desc: 'Artist settings',
    tabs: [
      { seg: 'settings', label: 'General' },
      // Who receives each kind of enquiry. Moved off the Enquiries page (Sam, 2026-09-22:
      // "I want the enquiries to take up the whole space") to sit beside the booking address.
      { seg: 'settings/email', label: 'Email' },
    ],
  },
]

/**
 * The tools this artist's rail shows. A bridge-connected custom site ignores the template
 * picker, the template's text fields and the media panel that make up the Site page, and
 * the editor owns everything it did — so that tool goes. Filtered here, from the registry,
 * so the rail, its offset maths and the tests all read the same list.
 */
export function toolsFor(customSite: boolean): readonly Tool[] {
  return customSite ? TOOLS.filter((t) => !t.templateOnly) : TOOLS
}

/** The tool a pathname is on, or null when the pathname is not a tool route. Longest
 *  segment wins so `tools/seo` beats `tools`. */
export function toolFor(pathname: string, artistId: string): Tool | null {
  const base = `/artists/${artistId}/`
  if (!pathname.startsWith(base)) return null
  const rest = pathname.slice(base.length).replace(/\/+$/, '')
  const hits = TOOLS.filter((t) => rest === t.seg || rest.startsWith(`${t.seg}/`))
  return hits.sort((a, b) => b.seg.length - a.seg.length)[0] ?? null
}

/** The tab a pathname is on within `tool`, longest segment first; the first tab when the
 *  path is the tool's own route. null when the tool has no tabs. */
export function tabFor(tool: Tool, pathname: string, artistId: string): ToolTab | null {
  if (!tool.tabs?.length) return null
  const base = `/artists/${artistId}/`
  if (!pathname.startsWith(base)) return tool.tabs[0]
  const rest = pathname.slice(base.length).replace(/\/+$/, '')
  const hits = tool.tabs.filter((t) => rest === t.seg || rest.startsWith(`${t.seg}/`))
  return hits.sort((a, b) => b.seg.length - a.seg.length)[0] ?? tool.tabs[0]
}
