'use client'

import { useCallback, useState } from 'react'
import { type EditorTour } from './inspector-types'
import { Icon } from '@/components/ui/icons'
import { FIELD, FieldRow, SaveLine } from './inspector-shared'
import { useDebouncedFieldSave } from './use-debounced-field-save'
import { EditorPanel } from './editor-panel'
import { setSupportUrlAction, updateContentAction } from '../actions'
import { useRouter } from 'next/navigation'

/**
 * ONE tour date, opened full-panel — its own details, and its supporting acts and where
 * each one links to.
 *
 * Sam, 2026-08-09: "I want to change the format of the links for the tour support. Those
 * should just be added on the tour dates section. There should be an edit button for the
 * specific tour show and in that should have the support section where you add the
 * supporting artist's website link."
 *
 * These URLs lived in the LINKS panel as a flat list of every act across every date,
 * each row captioned with which show it belonged to. That put a fact about a show
 * somewhere the show is not: to link the opener for one night, the manager left the
 * dates, scanned a list of names, and read the captions to find the right one. The act
 * names already belong to the date (`tour_dates.support`), so the links belong beside
 * them.
 *
 * The names themselves are still entered on the Tour page — this editor is placement,
 * like the rest of the inspector, not data entry.
 */
export function TourDateEditor({
  tour,
  label,
  urls: initialUrls,
  artistId,
  onBack,
}: {
  tour: EditorTour
  /** The show, named the way the row names it ("12 SEP 26 · The Chapel"). */
  label: string
  /** Current URL per act name, for THIS date only. */
  urls: Record<string, string>
  artistId: string
  onBack: () => void
}) {
  const [urls, setUrls] = useState<Record<string, string>>(initialUrls)
  const router = useRouter()

  // One debounced saver for BOTH kinds of field on this panel, dispatched by key: a
  // `detail:<field>` key writes the show's own column (and refreshes the dates section),
  // a bare act name writes that act's support URL. The pending value is what the
  // (unmount) flush persists, so neither kind needs a values ref.
  const { status, save, runNow } = useDebouncedFieldSave<string>({
    persist: (key, value) => {
      if (key.startsWith('detail:')) {
        const field = key.slice('detail:'.length)
        const fd = new FormData()
        fd.set(field, value)
        return updateContentAction('tour_date', tour.id, artistId, fd).then((res) => {
          if (!res?.error) router.refresh()
          return res
        })
      }
      return setSupportUrlAction(artistId, tour.id, key, value)
    },
  })

  /**
   * The acts themselves, editable here (Sam, 2026-08-10: "Allow to add supporting acts
   * (multiple need be) and their links in the side panel"). Owned as state because adds
   * and removes render immediately; the save posts the WHOLE array — that is the
   * column's write shape (`tour_dates.support` text[], read via getAll). Removing the
   * last act posts the blank SENTINEL: extractUpdate skips absent fields, so an empty
   * FormData would silently keep the old list (content-form.ts documents this).
   */
  const [acts, setActs] = useState<string[]>(tour.support)
  const [actDraft, setActDraft] = useState('')
  const [actError, setActError] = useState<string | null>(null)

  const saveActs = useCallback(
    (next: string[]) => {
      setActs(next)
      // A discrete write, not a debounce — the whole support[] array at once — through
      // the same serialized runner + status as the debounced fields.
      runNow('acts', async () => {
        const fd = new FormData()
        if (next.length === 0) fd.append('support', '')
        for (const name of next) fd.append('support', name)
        const res = await updateContentAction('tour_date', tour.id, artistId, fd)
        if (!res?.error) router.refresh()
        return res
      })
    },
    [artistId, tour.id, router, runNow],
  )

  function addAct() {
    const name = actDraft.trim()
    if (!name) return
    // support_urls is KEYED BY NAME, so two acts spelled the same would share one link
    // row and one remove button. Same normalization the key join uses.
    if (acts.some((a) => a.trim().toLowerCase() === name.toLowerCase())) {
      return setActError(`${name} is already on this show.`)
    }
    setActError(null)
    setActDraft('')
    saveActs([...acts, name])
  }

  /**
   * The show's own fields, editable in place (Sam, 2026-08-10: "you should be able to
   * edit some of the info right there and it updates in the tour dates section").
   * Saved through the SAME generic CRUD the Tour page uses — one write path — and
   * `router.refresh()` afterwards re-fetches the draft, whose new identity re-sends
   * init-data to the frame: that is what updates the window, not a special message.
   */
  const [details, setDetails] = useState<Record<string, string>>({
    date: tour.date ?? '',
    venue: tour.venue ?? '',
    city: tour.city ?? '',
    state: tour.state ?? '',
    country: tour.country ?? '',
    // The Tickets URL belongs with the show it sells (Sam, 2026-08-17) — same reasoning
    // that moved the support-act links here from the flat Links list.
    ticket_url: tour.ticketUrl ?? '',
  })

  function editDetail(field: string, value: string) {
    setDetails((d) => ({ ...d, [field]: value }))
    save(`detail:${field}`, value)
  }

  function edit(name: string, url: string) {
    setUrls((u) => ({ ...u, [name]: url }))
    save(name, url)
  }

  return (
    <EditorPanel label={label} onBack={onBack}>
      <div className="px-5 pt-4">
        <div className="pb-1">
          <FieldRow label="Date">
            <input type="date" aria-label="Date" value={details.date} onChange={(e) => editDetail('date', e.target.value)} className={FIELD} />
          </FieldRow>
          <FieldRow label="Venue">
            <input aria-label="Venue" value={details.venue} onChange={(e) => editDetail('venue', e.target.value)} className={FIELD} />
          </FieldRow>
          <FieldRow label="City">
            <input aria-label="City" value={details.city} onChange={(e) => editDetail('city', e.target.value)} className={FIELD} />
          </FieldRow>
          <FieldRow label="Tickets link">
            <input
              aria-label="Tickets link"
              type="url"
              value={details.ticket_url}
              onChange={(e) => editDetail('ticket_url', e.target.value)}
              placeholder="https://…"
              className={FIELD}
            />
          </FieldRow>
          <div className="grid grid-cols-2 gap-2">
            <FieldRow label="State">
              <input aria-label="State" value={details.state} onChange={(e) => editDetail('state', e.target.value)} placeholder="TX" className={FIELD} />
            </FieldRow>
            <FieldRow label="Country">
              <input aria-label="Country" value={details.country} onChange={(e) => editDetail('country', e.target.value)} className={FIELD} />
            </FieldRow>
          </div>
        </div>

        <h3 className="pt-3 font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Supporting acts</h3>
        {acts.length === 0 && (
          <p className="pt-2 text-[11px] leading-relaxed text-ink-faint">
            No supporting acts on this show yet.
          </p>
        )}
        {acts.length > 0 && (
          <div className="pt-1">
            {acts.map((name) => (
              <FieldRow
                key={name}
                icon="links"
                label={name}
                action={
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() => saveActs(acts.filter((a) => a !== name))}
                    className="rounded-md p-1 text-ink-faint hover:bg-danger-soft hover:text-accent-red"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                }
              >
                <input
                  aria-label={`Link for ${name}`}
                  type="url"
                  value={urls[name] ?? ''}
                  onChange={(e) => edit(name, e.target.value)}
                  placeholder="https://…  (blank = no link)"
                  className={FIELD}
                />
              </FieldRow>
            ))}
          </div>
        )}

        {/* Adding is a discrete action, not a debounce: a name is complete when the
            manager says so, and half-typed names must never save. */}
        <div className="flex items-end gap-2 pt-2">
          <label className="min-w-0 flex-1">
            <input
              aria-label="Add a supporting act"
              value={actDraft}
              onChange={(e) => setActDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addAct()}
              placeholder="Act name"
              className={FIELD}
            />
          </label>
          <button
            type="button"
            onClick={addAct}
            className="flex-none rounded-lg border border-hairline px-3 py-2 font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink hover:border-accent hover:text-accent"
          >
            Add act
          </button>
        </div>
        {actError && <p className="pt-1 text-[11px] text-accent-red">{actError}</p>}
      </div>
      <SaveLine status={status} />
    </EditorPanel>
  )
}
