'use client'

/**
 * The editable half of the SEO / GEO page: the words search shows, the facts the fact
 * sheet states, and where the bio lives. Each row saves as it is typed (debounced),
 * through the same gates the editor's Site tab uses — one rule set, two doors.
 */
import { useState } from 'react'
import { ABOUT_PLACEMENTS, type AboutPlacement } from '@samfox1/site-bridge/seo'
import { Field, Input, Textarea } from '@/components/ui/ui'
import { SaveLine } from '../../editor/inspector-shared'
import { useDebouncedFieldSave } from '../../editor/use-debounced-field-save'
import { saveArtistFactAction, saveSeoFieldAction } from '../../actions'
import type { ArtistFacts } from '../../editor/panels/site-tools'

const PLACEMENT_LABEL: Record<AboutPlacement, string> = {
  home: 'On the homepage',
  page: 'Its own page (/about)',
  hidden: 'Hidden (search still gets it)',
}

export function SeoWords({ artistId, name, initial }: { artistId: string; name: string; initial: Record<string, string> }) {
  const [v, setV] = useState(initial)
  const save = useDebouncedFieldSave<string>({
    persist: (key, value) => saveSeoFieldAction(artistId, key, value).then((r) => ({ ok: r.ok, error: r.error })),
  })
  const set = (key: string, value: string) => {
    setV((s) => ({ ...s, [key]: value }))
    save.save(key, value)
  }
  return (
    <div className="space-y-4">
      <Field label="Title">
        <Input aria-label="Title" value={v.seo_title ?? ''} placeholder={name} onChange={(e) => set('seo_title', e.target.value)} />
      </Field>
      <Field label="Description">
        <Textarea aria-label="Description" value={v.seo_description ?? ''} placeholder="Blank = the bio" onChange={(e) => set('seo_description', e.target.value)} />
      </Field>
      <SaveLine status={save.status} />
    </div>
  )
}

export function SeoFacts({ artistId, initial }: { artistId: string; initial: ArtistFacts }) {
  const [v, setV] = useState(initial)
  const save = useDebouncedFieldSave<string>({
    persist: (column, value) =>
      saveArtistFactAction(artistId, column as keyof ArtistFacts, value).then((r) => ({ ok: r.ok, error: r.error })),
  })
  const set = (column: keyof ArtistFacts, value: string) => {
    setV((s) => ({ ...s, [column]: value }))
    save.save(column, value)
  }
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Genre">
        <Input aria-label="Genre" value={v.genre} placeholder="House, Techno" onChange={(e) => set('genre', e.target.value)} />
      </Field>
      <Field label="Based in">
        <Input aria-label="Based in" value={v.location} placeholder="Chicago" onChange={(e) => set('location', e.target.value)} />
      </Field>
      <Field label="Type">
        <select aria-label="Type" value={v.schema_type || 'MusicGroup'} onChange={(e) => set('schema_type', e.target.value)} className="w-full rounded-lg border border-hairline bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-ink-faint">
          <option value="MusicGroup">Musician</option>
          <option value="Person">Visual artist</option>
        </select>
      </Field>
      <div className="sm:col-span-3">
        <SaveLine status={save.status} />
      </div>
    </div>
  )
}

export function SeoAbout({ artistId, initial }: { artistId: string; initial: Record<string, string> }) {
  const [v, setV] = useState(initial)
  const save = useDebouncedFieldSave<string>({
    persist: (key, value) => saveSeoFieldAction(artistId, key, value).then((r) => ({ ok: r.ok, error: r.error })),
  })
  const set = (key: string, value: string) => {
    setV((s) => ({ ...s, [key]: value }))
    save.save(key, value)
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Where the bio shows">
        <select aria-label="Where the bio shows" value={v.about_placement ?? ''} onChange={(e) => set('about_placement', e.target.value)} className="w-full rounded-lg border border-hairline bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-ink-faint">
          <option value="">Site default</option>
          {ABOUT_PLACEMENTS.map((p) => (
            <option key={p} value={p}>
              {PLACEMENT_LABEL[p]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Heading">
        <Input aria-label="Heading" value={v.about_heading ?? ''} placeholder="About" onChange={(e) => set('about_heading', e.target.value)} />
      </Field>
      <div className="sm:col-span-2">
        <SaveLine status={save.status} />
      </div>
    </div>
  )
}
