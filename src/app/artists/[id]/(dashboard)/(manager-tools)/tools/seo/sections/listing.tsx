'use client'

import { useState } from 'react'
import { useDebouncedFieldSave } from '../../../../editor/use-debounced-field-save'
import { saveSeoFieldAction } from '../../../../actions'
import { MAX_TITLE } from '@samfox1/site-bridge/seo'
import { Body, FieldBlock, GroupLabel, INPUT, SaveLine, SeeIt, TEXTAREA } from './rows'

/** What Google shows: the page title (blue link) and the one-line description under it.
 *  `defaultTitle` is the title the site builds from the facts when this one is blank
 *  (the bridge's defaultSeoTitle, audit #1), so the preview shows what will go live. */
export function ListingSection({ artistId, name, defaultTitle, bio, siteUrl, initial }: { artistId: string; name: string; defaultTitle?: string; bio: string; siteUrl: string | null; initial: Record<string, string> }) {
  const [v, setV] = useState(initial)
  const save = useDebouncedFieldSave<string>({ persist: (k, val) => saveSeoFieldAction(artistId, k, val).then((r) => ({ ok: r.ok, error: r.error })) })
  const set = (k: string, val: string) => {
    setV((s) => ({ ...s, [k]: val }))
    save.save(k, val)
  }
  const fallback = defaultTitle || name
  const title = v.seo_title?.trim() || fallback
  const desc = (v.seo_description?.trim() || bio).replace(/\s+/g, ' ').slice(0, 160)
  return (
    <div>
      <GroupLabel>How it looks on Google</GroupLabel>
      <Body>
        <div className="rounded-lg bg-surface px-4 py-3">
          <div className="truncate font-space text-[11px] text-ink-faint">{siteUrl ?? 'your site'}</div>
          <div className="mt-0.5 truncate text-[16px] text-accent">{title}</div>
          <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-muted">{desc || 'Add a description or a bio.'}</div>
        </div>
      </Body>
      <GroupLabel>Words</GroupLabel>
      <Body>
        <FieldBlock label="Page title" hint={`${(v.seo_title ?? '').length} of ${MAX_TITLE} · blank = from Facts`}>
          <input aria-label="Page title" value={v.seo_title ?? ''} placeholder={fallback} onChange={(e) => set('seo_title', e.target.value)} className={INPUT} />
        </FieldBlock>
        <FieldBlock label="One-line description" hint={`${(v.seo_description ?? '').length} of 160 · blank = the bio`}>
          <textarea aria-label="One-line description" value={v.seo_description ?? ''} placeholder={bio.slice(0, 160) || 'What the artist does, in one line'} onChange={(e) => set('seo_description', e.target.value)} className={TEXTAREA} />
        </FieldBlock>
        <SaveLine status={save.status} />
      </Body>
      <SeeIt>search the artist&rsquo;s name on Google. Search Console → Performance counts how often it is shown and clicked.</SeeIt>
    </div>
  )
}
