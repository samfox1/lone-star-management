import { redirect } from 'next/navigation'

/** Settings folded into the Manager tools hub. */
export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/artists/${id}/tools`)
}
