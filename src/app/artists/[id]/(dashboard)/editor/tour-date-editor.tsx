'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { type EditorTour } from './inspector-types'
import { FIELD, FieldRow, runSerialized, SaveLine, type SaveStatus } from './inspector-shared'
import { EditorPanel } from './editor-panel'
import { setSupportUrlAction } from '../actions'

/**
 * ONE tour date, opened full-panel — currently its supporting acts and where each one
 * links to.
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
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Set<string>>(new Set())
  // Latest values, so the unmount flush reads what is on screen without `urls` being an
  // effect dependency (the pattern the link and style tools already use).
  const urlsRef = useRef(urls)
  useEffect(() => {
    urlsRef.current = urls
  }, [urls])

  const persist = useCallback(
    (name: string, url: string) => {
      pending.current.delete(name)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, name, () => setSupportUrlAction(artistId, tour.id, name, url))
    },
    [artistId, tour.id],
  )

  // Closing the panel mid-debounce must not drop the edit — the manager typed it, so it
  // saves on the way out.
  useEffect(() => {
    const timersMap = timers.current
    const pendingSet = pending.current
    const tourId = tour.id
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingSet.forEach((name) => {
        void setSupportUrlAction(artistId, tourId, name, urlsRef.current[name] ?? '')
      })
    }
  }, [artistId, tour.id])

  function edit(name: string, url: string) {
    setUrls((u) => ({ ...u, [name]: url }))
    const existing = timers.current.get(name)
    if (existing) clearTimeout(existing)
    pending.current.add(name)
    timers.current.set(
      name,
      setTimeout(() => {
        timers.current.delete(name)
        persist(name, url)
      }, 500),
    )
  }

  return (
    <EditorPanel label={label} onBack={onBack}>
      <div className="px-5 pt-4">
        <h3 className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Supporting acts</h3>
        {tour.support.length === 0 ? (
          // SAY SO. A blank panel is indistinguishable from a broken one, and the acts
          // are entered elsewhere, so the manager needs telling where.
          <p className="pt-2 text-[11px] leading-relaxed text-ink-faint">
            No supporting acts on this show yet. Add them on the Tour page and they&apos;ll
            appear here to link.
          </p>
        ) : (
          <div className="pt-1">
            {tour.support.map((name) => (
              <FieldRow key={name} icon="links" label={name}>
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
      </div>
      <SaveLine status={status} />
    </EditorPanel>
  )
}
