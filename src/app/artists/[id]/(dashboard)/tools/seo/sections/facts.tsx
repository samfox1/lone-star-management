'use client'

import { useState } from 'react'
import { useDebouncedFieldSave } from '../../../editor/use-debounced-field-save'
import { saveArtistFactAction } from '../../../actions'
import type { ArtistFacts } from '../../../editor/panels/site-tools'
import { Body, ControlRow, GroupLabel, SaveLine, SeeIt, SELECT } from './rows'
import { cx } from '@/lib/cx'
import { FIELD_ON_TINT } from '../../../editor/inspector-shared'

const F = cx(FIELD_ON_TINT, 'w-[240px]')

/** The two facts search engines and AI assistants ask for most, plus the artist type. */
export function FactsSection({ artistId, initial }: { artistId: string; initial: ArtistFacts }) {
  const [v, setV] = useState(initial)
  const save = useDebouncedFieldSave<string>({ persist: (c, val) => saveArtistFactAction(artistId, c as keyof ArtistFacts, val).then((r) => ({ ok: r.ok, error: r.error })) })
  const set = (c: keyof ArtistFacts, val: string) => {
    setV((s) => ({ ...s, [c]: val }))
    save.save(c, val)
  }
  return (
    <div>
      <GroupLabel>Facts</GroupLabel>
      <Body>
        <ControlRow label="Genre">
          <input aria-label="Genre" value={v.genre} placeholder="House, Techno" onChange={(e) => set('genre', e.target.value)} className={F} />
        </ControlRow>
        <ControlRow label="Based in">
          <input aria-label="Based in" value={v.location} placeholder="Chicago" onChange={(e) => set('location', e.target.value)} className={F} />
        </ControlRow>
        <ControlRow label="Artist type">
          <select aria-label="Artist type" value={v.schema_type || 'MusicGroup'} onChange={(e) => set('schema_type', e.target.value)} className={SELECT}>
            <option value="MusicGroup">Musician</option>
            <option value="Person">Visual artist</option>
          </select>
        </ControlRow>
        <SaveLine status={save.status} />
      </Body>
      <SeeIt>these go into the site&rsquo;s fact sheet for Google. Ask ChatGPT or Perplexity what kind of music the artist makes and compare.</SeeIt>
    </div>
  )
}
