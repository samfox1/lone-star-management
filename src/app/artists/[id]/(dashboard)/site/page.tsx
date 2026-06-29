import { createClient } from '@/lib/supabase/server'
import { MediaPanel, type MediaRow } from '../media-panel'
import { TEMPLATES } from '@/components/artist-template'
import { fieldsFor } from '@/lib/site-content-schema'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { requireArtist } from '../_data'
import { publishSiteAction, saveSiteContentAction, saveTemplateAction } from '../actions'

const selectClass =
  'rounded-lg border border-hairline bg-paper px-2.5 py-2 text-sm text-ink outline-none focus:border-ink-faint'

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
      <div className="flex items-center justify-between border-b border-hairline pb-3">
        <h1 className="text-[19px] font-bold tracking-[-0.01em]">Site</h1>
        <form action={publishSiteAction.bind(null, id)}>
          <button type="submit" className={buttonClass('ghost')}>
            Publish site
          </button>
        </form>
      </div>

      <div className="mt-6 space-y-8">
        <div>
          <h2 className="text-[15px] font-bold tracking-[-0.01em]">Template</h2>
          <form action={saveTemplateAction.bind(null, id)} className="mt-2 flex items-center gap-2">
            <select name="template" defaultValue={artist?.template ?? 'classic'} className={selectClass}>
              {TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonClass('ghost')}>
              Apply
            </button>
          </form>
        </div>

        {fields.length > 0 && (
          <div>
            <h2 className="text-[15px] font-bold tracking-[-0.01em]">Site text</h2>
            <p className="mt-1 font-space text-xs text-ink-faint">
              Leave blank to use the template default. Draft until you publish.
            </p>
            <form action={saveSiteContentAction.bind(null, id)} className="mt-3 space-y-3">
              {fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                    {f.label}
                  </span>
                  <input
                    name={f.key}
                    type={f.type === 'email' ? 'email' : 'text'}
                    defaultValue={content[f.key] ?? ''}
                    placeholder={f.default || 'Default'}
                    className={`mt-1.5 ${inputClass} w-full`}
                  />
                </label>
              ))}
              <button type="submit" className={buttonClass('ghost')}>
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
