'use client'

import { setTrackFeaturedAction } from '../actions'
import { EditList, SHORT_ADD_FIELD, useListSave } from '../(manager-tools)/_ui/edit-list'

/**
 * A song's collaborators, the Featuring row of the song and single modals, as a click-to-edit
 * list (Sam, 2026-10-05, the lists mock; it was chips and a dialog). At rest each name is plain
 * text. Click one to rename it, with ✓ and a trash; a bare + at the end adds one.
 *
 * Every change sends the WHOLE list through one action (useListSave), optimistic first, put back
 * with the server's message if refused (the open field keeps what was typed). Enter never submits a
 * form around it, and Escape closes the field, not the card. Draft until Publish; the site
 * prints them as "feat. …".
 */
export function FeaturedChips({ artistId, trackId, names: initial }: { artistId: string; trackId: string; names: string[] }) {
  const { items: names, save, remove } = useListSave(initial, async (next) => {
    const res = await setTrackFeaturedAction(trackId, artistId, next)
    return { error: res.error, saved: res.names } // as stored: trimmed, deduped
  })

  /** The server drops a repeat (and a 21st name) silently, so say so here. */
  const problem = (name: string, index: number | null) => {
    if (!name) return 'Give them a name.'
    // The server keeps the first 20 and drops the rest without a word.
    if (index === null && names.length >= 20) return 'A song lists at most 20 names.'
    const taken = names.some((n, i) => i !== index && n.toLowerCase() === name.toLowerCase())
    return taken ? `${name} is already on the song.` : null
  }

  return (
    <EditList
      items={names}
      text={(n) => n}
      label="Collaborator"
      addLabel="Add collaborator"
      addFieldLabel="New collaborator"
      placeholder="Name"
      maxLength={120}
      addFieldClass={SHORT_ADD_FIELD}
      validate={problem}
      onSave={(i, name) => save(names.map((n, j) => (j === i ? name : n)))}
      onAdd={(name) => save([...names, name])}
      onRemove={(i) => void remove(i)}
      removeLabel={(n) => `Remove ${n}`}
      className="flex-1"
    />
  )
}
