'use client'

import { useState } from 'react'
import { ABOUT_PLACEMENTS, type AboutPlacement, type ManifestAbout } from '@samfox1/site-bridge/seo'
import { useDebouncedFieldSave } from '../../../editor/use-debounced-field-save'
import { saveEditorFieldAction, saveSeoFieldAction } from '../../../actions'
import { Body, ControlRow, FieldBlock, GroupLabel, INPUT, SaveLine, SeeIt, SELECT, TEXTAREA } from './rows'
import { cx } from '@/lib/cx'

const PLACEMENT: Record<AboutPlacement, string> = { home: 'On the homepage', page: 'Its own page', hidden: 'Hidden from visitors' }

/** The one bio, edited here: it feeds the About page, the description and the fact sheet. */
export function AboutSection({
  artistId,
  initialBio,
  initial,
  about = null,
}: {
  artistId: string
  initialBio: string
  initial: Record<string, string>
  /**
   * What the connected site DECLARES about its bio, when the caller has it. The manifest
   * is announced at runtime over the bridge, so this page (server-rendered, no frame) has
   * none — hence the null default, and hence only `hidden` on offer here.
   *
   * Offering the whole registry was M9 of the 2026-09-03 review: on a site declaring only
   * `home`, "Its own page" saved happily, rendered nothing, and reported nothing. A
   * control that cannot take effect must not be shown (editor-adapts-to-site); the Site
   * panel in the editor, which does hold the manifest, is where the full choice lives.
   */
  about?: ManifestAbout | null
}) {
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
  // The SAME filter as the editor's Site panel (panels/site-tools.tsx), derived from the
  // registry: `hidden` is always renderable (the bridge's aboutPlacement allows it with no
  // declaration), home/page only when the site says it can render them.
  const placements: AboutPlacement[] = ABOUT_PLACEMENTS.filter((p) => p === 'hidden' || about?.placements.includes(p))
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
            <option value="">{about?.default ? `Site default (${PLACEMENT[about.default]})` : 'Site default'}</option>
            {placements.map((p) => (
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
      <SeeIt>AI answers quote visible words, so more here means more to quote. Open the site after publishing and read the bio back.</SeeIt>
    </div>
  )
}
