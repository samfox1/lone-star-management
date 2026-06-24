import { createClient } from '@/lib/supabase/server'
import { MediaPanel, type MediaRow } from '../media-panel'
import { TEMPLATES } from '@/components/artist-template'
import { publishSiteAction, saveTemplateAction } from '../actions'

/**
 * Site section: template choice + media. (Profile text — name/bio/taglines — is
 * lifted into editable fields in the next step; for now it's set via scripts.)
 * "Publish site" publishes the profile + media together (publishSiteAction).
 */
export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('template')
    .eq('id', id)
    .single()
  const { data: media } = await supabase
    .from('media')
    .select('id, purpose, storage_path')
    .eq('artist_id', id)
    .order('sort_order')

  return (
    <section>
      <div className="flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Site
        </h1>
        <form action={publishSiteAction.bind(null, id)}>
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Publish site
          </button>
        </form>
      </div>

      <div className="mt-6 space-y-8">
        <div>
          <h2 className="text-sm font-medium text-zinc-500">Template</h2>
          <form
            action={saveTemplateAction.bind(null, id)}
            className="mt-2 flex items-center gap-2"
          >
            <select
              name="template"
              defaultValue={artist?.template ?? 'classic'}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            >
              {TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Apply
            </button>
          </form>
        </div>

        <MediaPanel artistId={id} media={(media ?? []) as MediaRow[]} />
      </div>
    </section>
  )
}
