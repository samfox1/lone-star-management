'use client'
/* eslint-disable @next/next/no-img-element -- runtime Storage URLs, sized by the bucket's render endpoint; next/image would add a second resize. */

import { useState } from 'react'
import { recommendAlt, recommendSlug } from '@samfox1/site-bridge/alt'
import { modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { cx } from '@/lib/cx'
import { useDebouncedFieldSave } from '../../../editor/use-debounced-field-save'
import { renameMediaAction, setMediaAltAction } from '../../../actions'
import { GroupLabel, INPUT, SaveLine, SeeIt } from './rows'

export type AltPhoto = { id: string; url: string; alt: string; slug: string; caption: string | null }

/** Every photo on the site as a tile — the images page's grid — with its alt text and
 *  file name under it. Click the picture for a full-size look. Blank alt = the automatic
 *  one, shown as the placeholder. */
export function AltSection({ artistId, artistName, photos: initial }: { artistId: string; artistName: string; photos: AltPhoto[] }) {
  const [photos, setPhotos] = useState(initial)
  const [preview, setPreview] = useState<AltPhoto | null>(null)
  const altSave = useDebouncedFieldSave<string>({ persist: (id, val) => setMediaAltAction(artistId, id, val).then((r) => ({ ok: !r.error, error: r.error })) })
  const setAlt = (id: string, alt: string) => {
    setPhotos((l) => l.map((p) => (p.id === id ? { ...p, alt } : p)))
    altSave.save(id, alt)
  }
  const rename = async (p: AltPhoto, slug: string) => {
    if (!slug || slug === p.slug) return
    const r = await renameMediaAction(artistId, p.id, slug)
    if (r.storage_path) setPhotos((l) => l.map((x) => (x.id === p.id ? { ...x, slug: recommendSlug(slug), url: x.url.replace(/\/[^/]+(\?.*)?$/, `/${r.storage_path!.split('/').pop()}$1`) } : x)))
  }
  return (
    <div>
      <GroupLabel>
        {photos.length} {photos.length === 1 ? 'photo' : 'photos'} on the site
      </GroupLabel>
      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-hairline px-6 py-16 text-center">
          <div className="text-sm font-semibold text-ink">No photos on the site yet</div>
          <div className="font-space text-xs text-ink-muted">Place photos in the site editor first.</div>
        </div>
      ) : (
        <div className="grid gap-x-5 gap-y-8 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
          {photos.map((p) => {
            const preset = recommendAlt({ artist: artistName, caption: p.caption })
            return (
              <div key={p.id} className="space-y-2">
                <button type="button" onClick={() => setPreview(p)} aria-label={`Preview ${p.slug}`} className="group block w-full overflow-hidden rounded-2xl border border-hairline">
                  <img src={p.url} alt="" className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
                </button>
                <input aria-label={`Alt text for ${p.slug}`} value={p.alt} placeholder={preset} onChange={(e) => setAlt(p.id, e.target.value)} className={INPUT} />
                <input
                  aria-label={`File name for ${p.slug}`}
                  defaultValue={p.slug}
                  placeholder={recommendSlug(p.alt || preset)}
                  onBlur={(e) => rename(p, e.target.value.trim())}
                  className={cx(INPUT, 'font-space text-[11px]')}
                />
              </div>
            )
          })}
        </div>
      )}
      <SaveLine status={altSave.status} />
      <SeeIt>the first box is what Google Images reads and a screen reader says; the second is the picture&rsquo;s web address.</SeeIt>
      {preview && (
        <div role="dialog" aria-modal="true" aria-label={`Preview ${preview.slug}`} className={modalOverlayClass} onClick={(e) => e.target === e.currentTarget && setPreview(null)}>
          <div className={cx(modalCardClass, 'w-[720px] gap-3')}>
            <img src={preview.url} alt={preview.alt || recommendAlt({ artist: artistName, caption: preview.caption })} className="max-h-[70vh] w-full rounded-lg object-contain" />
            <div className="flex items-center justify-between font-space text-[10px] text-ink-faint">
              <span className="truncate">{preview.slug}</span>
              <button type="button" onClick={() => setPreview(null)} className="font-bold uppercase tracking-[0.1em] text-ink">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
