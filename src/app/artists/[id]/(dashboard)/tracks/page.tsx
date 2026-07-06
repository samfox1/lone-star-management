import { redirect } from 'next/navigation'

/** Tracks folded into the Music tab. */
export default async function TracksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/artists/${id}/music`)
}
