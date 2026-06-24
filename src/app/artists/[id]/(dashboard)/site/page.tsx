import { createClient } from '@/lib/supabase/server'
import { MediaPanel, type MediaRow } from '../media-panel'
import { TEMPLATES } from '@/components/artist-template'
import { fieldsFor } from '@/lib/site-content-schema'
import { requireArtist } from '../_data'
import { publishSiteAction, saveSiteContentAction, saveTemplateAction } from '../actions'

const inputClass =
  'w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100'

/**
 * Site section: template choice, editable site text (template-declared fields),
 * and media. "Publish site" publishes the profile + site text + media together
 * (publishSiteAction). Site text is draft until then.
 */
export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const [{ data: media }, { data: contentRows }] = await Promise.all([
    supabase.from('media').select('id, purpose, storage_path').eq('artist_id', id).order('sort_order'),
    supabase.from('site_content').select('key, value').eq('artist_id', id),
  ])
  const content = Object.fromEntries(
    (contentRows ?? []).map((r) => [r.key as string, (r.value as string | null) ?? '']),
  )
  const fields = fieldsFor(artist.template)

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

        {fields.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-zinc-500">Site text</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Leave blank to use the template default. Draft until you publish.
            </p>
            <form action={saveSiteContentAction.bind(null, id)} className="mt-3 space-y-3">
              {fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    {f.label}
                  </span>
                  <input
                    name={f.key}
                    type={f.type === 'email' ? 'email' : 'text'}
                    defaultValue={content[f.key] ?? ''}
                    placeholder={f.default || 'Default'}
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
              ))}
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Save site text
              </button>
            </form>
          </div>
        )}

        <MediaPanel artistId={id} media={(media ?? []) as MediaRow[]} />
      </div>
    </section>
  )
}
