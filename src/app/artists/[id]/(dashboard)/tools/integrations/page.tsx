import { redirect } from 'next/navigation'

/** The Integrations hub became part of Connections (2026-09-13). Old links land there. */
export default async function IntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/artists/${id}/connections`)
}
