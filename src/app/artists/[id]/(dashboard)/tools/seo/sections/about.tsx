'use client'

import { useState } from 'react'
import { ABOUT_PLACEMENTS, type AboutPlacement } from '@samfox1/site-bridge/seo'
import { useDebouncedFieldSave } from '../../../editor/use-debounced-field-save'
import { saveEditorFieldAction, saveSeoFieldAction } from '../../../actions'
import { Body, ControlRow, FieldBlock, GroupLabel, INPUT, SaveLine, SeeIt, SELECT, TEXTAREA } from './rows'
import { cx } from '@/lib/cx'

const PLACEMENT: Record<AboutPlacement, string> = { home: 'On the homepage', page: 'Its own page', hidden: 'Hidden from visitors' }

/** The one bio, edited here: it feeds the About page, the description and the fact sheet. */
export function AboutSection({ artistId, initialBio, initial }: { artistId: string; initialBio: string; initial: Record<string, string> }) {
  const [bio, setBio] = useState(initialBio)
  const [v, setV] = useState(initial)
  const bioSave = useDebouncedFieldSave<string>({
    persist: (_k, val) => saveEditorFieldAction(artistId, 'artist_bio', val, { store: 'artist', column: 'bio' }).then((r) => ({ ok: r.ok, error: r.error })),
  })
  const seoSave = useDebouncedFieldSave<string>({ persist: (k, val) => saveSeoFieldAction(artistId, k, val).then((r) => ({ ok: r.ok, error: r.error })) })
  const set = (k: string, val: string) => {
    setV((s) => ({ ...s, [k]: val }))
    seoSave.save(k, val)
  }
  const words = bio.trim() ? bio.trim().split(/\s+/).length : 0
  return (
    <div>
      <GroupLabel>The bio</GroupLabel>
      <Body>
        <FieldBlock label="About the artist" hint={`${words} words · ${bio.length} characters`}>
          <textarea
            aria-label="About the artist"
            value={bio}
            onChange={(e) => {
              setBio(e.target.value)
              bioSave.save('artist_bio', e.target.value)
            }}
            className={cx(TEXTAREA, 'min-h-48')}
          />
        </FieldBlock>
        <SaveLine status={bioSave.status} />
      </Body>
      <GroupLabel>Where it shows</GroupLabel>
      <Body>
        <ControlRow label="Placement">
          <select aria-label="Placement" value={v.about_placement ?? ''} onChange={(e) => set('about_placement', e.target.value)} className={SELECT}>
            <option value="">Site default</option>
            {ABOUT_PLACEMENTS.map((p) => (
              <option key={p} value={p}>
                {PLACEMENT[p]}
              </option>
            ))}
          </select>
        </ControlRow>
        <ControlRow label="Heading">
          <input aria-label="Heading" value={v.about_heading ?? ''} placeholder="About" onChange={(e) => set('about_heading', e.target.value)} className={cx(INPUT, 'w-[200px]')} />
        </ControlRow>
        <SaveLine status={seoSave.status} />
      </Body>
      <SeeIt>AI answers quote visible words, so more here means more to quote. Open the site&rsquo;s /about page after publishing.</SeeIt>
    </div>
  )
}
