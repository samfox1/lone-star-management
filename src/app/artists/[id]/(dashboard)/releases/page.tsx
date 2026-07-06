import { redirect } from 'next/navigation'

/** Releases folded into the Music tab. */
export default async function ReleasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/artists/${id}/music?view=releases`)
}
