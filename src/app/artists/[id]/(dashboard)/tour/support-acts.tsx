'use client'

import type { SupportAct } from '@/lib/content'
import { setSupportActsAction } from '../actions'
import { EditList, SHORT_ADD_FIELD, useListSave } from '../(manager-tools)/_ui/edit-list'

/** The lineup's website line: mono, like every other URL in the modal. */
const WEBSITE_TEXT = 'font-space text-[13px] leading-6 text-ink'

/**
 * A tour date's LINEUP as a click-to-edit list (Sam, 2026-10-05, the lists mock: "Looks great,
 * lets do it"). At rest each act is its name alone. Click one: its name and its website open
 * in place as two underlines, with ✓ and a trash. The website lives only there, never as a
 * standing mark on the row. A bare + at the end opens the same two lines empty.
 *
 * SELF-SAVING when the date exists: every add / edit / remove sends the WHOLE lineup through
 * one action (useListSave), optimistic first, put back (with the server's message) if refused,
 * and the open field keeps what was typed. Without a `tourDateId` (the Add card, before the row
 * exists) it only reports the lineup through `onChange`; the card writes it once the row has an id.
 * Enter never submits a form around it, and Escape closes the field, not the card. Draft until
 * Publish.
 */
export function SupportActs({
  artistId,
  tourDateId,
  acts: initial,
  onChange,
}: {
  artistId: string
  tourDateId?: string
  acts: SupportAct[]
  onChange?: (acts: SupportAct[]) => void
}) {
  const { items: acts, save, remove } = useListSave(initial, async (next) => {
    if (!tourDateId) {
      onChange?.(next)
      return
    }
    const res = await setSupportActsAction(artistId, tourDateId, next)
    return { error: res.error, saved: res.acts } // as stored: trimmed, deduped, URLs normalised
  })

  /** The server collapses a repeat name silently (the name keys its link), so say so here. */
  const problem = (name: string, index: number | null) => {
    if (!name) return 'Give the act a name.'
    const taken = acts.some((a, i) => i !== index && a.name.toLowerCase() === name.toLowerCase())
    return taken ? `${name} is already on the lineup.` : null
  }

  return (
    <EditList
      items={acts}
      text={(a) => a.name}
      title={(a) => a.url ?? undefined}
      label="Act"
      addLabel="Add act"
      addFieldLabel="New act"
      placeholder="Name"
      maxLength={120}
      addFieldClass={SHORT_ADD_FIELD}
      detail={{ text: (a) => a.url ?? '', label: 'Website', maxLength: 500, inputMode: 'url', textClass: WEBSITE_TEXT }}
      validate={problem}
      onSave={(i, name, url) => save(acts.map((a, j) => (j === i ? { name, url: url || null } : a)))}
      onAdd={(name, url) => save([...acts, { name, url: url || null }])}
      onRemove={(i) => void remove(i)}
      removeLabel={(a) => `Remove ${a.name}`}
      className="flex-1"
    />
  )
}
