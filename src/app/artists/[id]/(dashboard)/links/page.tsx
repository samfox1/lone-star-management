import { redirect } from 'next/navigation'

/** Links became part of Connections (2026-09-13). Old bookmarks land on the new page. */
export default async function LinksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/artists/${id}/connections`)
}
