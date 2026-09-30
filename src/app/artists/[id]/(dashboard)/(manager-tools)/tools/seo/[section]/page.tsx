import { notFound, redirect } from 'next/navigation'
import { MOVED_SEO_SECTIONS, seoTabSeg } from '../sections'

/**
 * THE OLD SECTION ROUTES, redirected to their new homes (sections.ts MOVED_SEO_SECTIONS), so a
 * bookmark or an old link lands on the row that now holds the setting (/listing lands on
 * Details, the tool's own page). The other tabs are static folders, which Next matches before
 * this dynamic one; anything else is a 404.
 */
export default async function MovedSeoSection({ params }: { params: Promise<{ id: string; section: string }> }) {
  const { id, section } = await params
  const moved = Object.hasOwn(MOVED_SEO_SECTIONS, section) ? MOVED_SEO_SECTIONS[section] : undefined
  if (!moved) notFound()
  redirect(`/artists/${id}/${seoTabSeg(moved.to)}${moved.hash ? `#${moved.hash}` : ''}`)
}
