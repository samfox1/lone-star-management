import { redirect } from 'next/navigation'
import { DEFAULT_SEO_SECTION } from './sections'

/** /tools/seo is the folder; the first section is the page. */
export default async function SeoIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/artists/${id}/tools/seo/${DEFAULT_SEO_SECTION}`)
}
