import { useState, useEffect, useRef, useCallback } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { type EditorVideo, type SiteVideoRole } from '../inspector-types'
import { CardThumb, EmptySlot, EditMenu, AddFirstLink, LibraryPicker } from '../inspector-grid'
import { runSerialized, SlotGroupLabel } from '../inspector-shared'
import { renameVideoAction } from '../../actions'

/** The label each background slot shows in the panel and the picker heading. */
const SLOT_LABELS: Record<SiteVideoRole, string> = {
  hero_landscape: 'Landscape · desktop',
  hero_portrait: 'Portrait · mobile',
  bio_background: 'Bio background',
}
const BAND_SLOTS = 2 // skeen's band is designed 2-up; show at least two slots.

/* ── Video tools: the site's video slots ─────────────────────────────────────────
 *
 * EVERY slot is filled by PICKING from the video library (added on the Videos/Assets
 * page). Grouped by where they live on the site:
 *  • Landing page — the hero background: a Landscape slot + a Portrait slot, each picks
 *    an UPLOADED video (assignHeroSlotAction sets its site_role; skeen reads it).
 *  • Videos band — the two YouTube embeds below the disco ball. Picking marks a YouTube
 *    video on-site; the picker offers only real YouTube videos (uploads are hero-only,
 *    Shorts aren't used). Removing a band video marks it off-site (stays in the library). */
export function VideoTools({
  videos,
  artistId,
  onToggleOnSite,
  onAssignHero,
}: {
  videos: EditorVideo[]
  artistId: string
  onToggleOnSite: (v: EditorVideo) => void
  onAssignHero: (role: SiteVideoRole, videoId: string | null) => void
}) {
  const [titles, setTitles] = useState<Record<string, string>>(() =>
    Object.fromEntries(videos.map((v) => [v.id, v.title])),
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // Which slot's picker is open: a background role, the band, or none.
  const [picking, setPicking] = useState<SiteVideoRole | 'band' | null>(null)
  // Which filled slot's Replace/Remove menu is open.
  const [editing, setEditing] = useState<{ type: 'slot'; role: SiteVideoRole } | { type: 'band'; video: EditorVideo } | null>(
    null,
  )
  // The band video being REPLACED, if any. It stays on the site until a replacement is
  // actually picked — so closing the picker without choosing leaves it in place.
  const [replacingBand, setReplacingBand] = useState<EditorVideo | null>(null)
  // A click anywhere outside an open Replace/Remove menu closes it (the menus tag
  // themselves with data-edit-menu; the edit button that opens one fires on click,
  // after this mousedown, so it never self-closes).
  useEffect(() => {
    if (!editing) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-edit-menu]')) setEditing(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [editing])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())

  const persist = useCallback(
    (id: string, title: string) => {
      pending.current.delete(id)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, id, () => renameVideoAction(id, artistId, title))
    },
    [artistId],
  )

  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((title, id) => {
        void renameVideoAction(id, artistId, title)
      })
    }
  }, [artistId])

  function edit(id: string, title: string) {
    setTitles((t) => ({ ...t, [id]: title }))
    pending.current.set(id, title)
    const existing = timers.current.get(id)
    if (existing) clearTimeout(existing)
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        persist(id, title)
      }, 500),
    )
  }

  const isYouTube = (v: EditorVideo) => v.provider === 'youtube' && !v.isShort
  const uploaded = videos.filter((v) => v.provider === 'uploaded')
  const bandSlots = videos.filter((v) => v.onSite && isYouTube(v))
  const bandLibrary = videos.filter((v) => !v.onSite && isYouTube(v))
  const addHref = `/artists/${artistId}/videos`

  function assignHero(role: SiteVideoRole, videoId: string | null) {
    setPicking(null)
    onAssignHero(role, videoId)
  }

  // A background slot as a card (preview on top, title + edit below). Clicking opens
  // the picker modal — see the render. Reused by both hero slots and the bio slot.
  function slotCard(role: SiteVideoRole) {
    const label = SLOT_LABELS[role]
    const placed = uploaded.find((v) => v.siteRole === role)
    return (
      <div key={role} className="space-y-1">
        <span className="font-space text-[10px] font-medium uppercase tracking-[0.06em] text-ink-faint">{label}</span>
        {placed ? (
          <div className="overflow-hidden rounded-lg border border-hairline">
            <CardThumb poster={placed.poster} previewUrl={placed.previewUrl} />
            <div className="px-2 py-1.5">
              {editing?.type === 'slot' && editing.role === role ? (
                <EditMenu
                  onReplace={() => {
                    setEditing(null)
                    setPicking(role)
                  }}
                  onRemove={() => {
                    setEditing(null)
                    assignHero(role, null)
                  }}
                />
              ) : (
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-xs">{placed.title || 'Untitled video'}</span>
                  <button
                    type="button"
                    aria-label={`Edit the ${label} slot`}
                    title="Replace or remove"
                    onClick={() => setEditing({ type: 'slot', role })}
                    className="flex-none rounded-md p-1 text-ink-faint hover:bg-surface hover:text-ink"
                  >
                    <Icon name="edit" size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <EmptySlot label="Pick a video" onClick={() => setPicking(role)} />
        )}
      </div>
    )
  }

  // The open background-slot picker (any role but 'band'), and whatever video sits in it.
  const slotRole = picking && picking !== 'band' ? picking : null
  const slotPlaced = slotRole ? uploaded.find((v) => v.siteRole === slotRole) : undefined

  return (
    <div className="space-y-3 px-5 py-4">
      {/* Landing page — the hero background, two slots side by side */}
      <SlotGroupLabel>Landing page</SlotGroupLabel>
      <div className="grid grid-cols-2 gap-2">
        {slotCard('hero_landscape')}
        {slotCard('hero_portrait')}
      </div>

      {/* Bio background — the clip that plays behind the bio section */}
      <SlotGroupLabel>Bio background</SlotGroupLabel>
      <div className="grid grid-cols-2 gap-2">{slotCard('bio_background')}</div>

      {slotRole && (
        <LibraryPicker
          title={SLOT_LABELS[slotRole]}
          // Only uploaded videos, and not one already in ANOTHER background slot.
          candidates={uploaded.filter((v) => !v.siteRole || v.id === slotPlaced?.id)}
          keyOf={(v) => v.id}
          labelOf={(v) => v.title || 'Untitled video'}
          renderThumb={(v) => <CardThumb poster={v.poster} previewUrl={v.previewUrl} />}
          empty={<AddFirstLink href={addHref} label="Add a video first" />}
          onPick={(v) => assignHero(slotRole, v.id)}
          onCancel={() => setPicking(null)}
        />
      )}

      {/* Videos band — two YouTube slots below the disco ball */}
      <SlotGroupLabel>Videos band</SlotGroupLabel>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: Math.max(BAND_SLOTS, bandSlots.length) }).map((_, i) => {
          const v = bandSlots[i]
          if (!v) return <EmptySlot key={`band-empty-${i}`} label="Pick a YouTube video" onClick={() => setPicking('band')} />
          return (
            <div key={v.id} className="overflow-hidden rounded-lg border border-hairline">
              <CardThumb poster={v.poster} previewUrl={v.previewUrl} />
              <div className="px-1.5 py-1">
                {editing?.type === 'band' && editing.video.id === v.id ? (
                  <EditMenu
                    onReplace={() => {
                      setEditing(null)
                      // Don't vacate yet — mark it as the one to swap out, and only take
                      // it off when a replacement is actually picked (see the picker).
                      setReplacingBand(v)
                      setPicking('band')
                    }}
                    onRemove={() => {
                      setEditing(null)
                      onToggleOnSite(v)
                    }}
                  />
                ) : (
                  <div className="flex items-center gap-0.5">
                    <input
                      aria-label={`Slot ${i + 1} title`}
                      value={titles[v.id] ?? ''}
                      onChange={(e) => edit(v.id, e.target.value)}
                      placeholder="Title"
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 font-space text-xs text-ink outline-none placeholder:font-space placeholder:text-ink-faint focus:border-hairline"
                    />
                    <button
                      type="button"
                      aria-label={`Edit video slot ${i + 1}`}
                      title="Replace or remove"
                      onClick={() => setEditing({ type: 'band', video: v })}
                      className="flex-none rounded-md p-1 text-ink-faint hover:bg-surface hover:text-ink"
                    >
                      <Icon name="edit" size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {picking === 'band' && (
        <LibraryPicker
          title={replacingBand ? 'Replace with' : 'YouTube video'}
          candidates={bandLibrary}
          keyOf={(v) => v.id}
          labelOf={(v) => v.title || 'Untitled video'}
          renderThumb={(v) => <CardThumb poster={v.poster} previewUrl={v.previewUrl} />}
          empty={<AddFirstLink href={addHref} label="Add a video first" />}
          onPick={(v) => {
            setPicking(null)
            // Replacing: take the old one off only now that a new one is chosen.
            if (replacingBand) onToggleOnSite(replacingBand)
            setReplacingBand(null)
            onToggleOnSite(v)
          }}
          onCancel={() => {
            setPicking(null)
            setReplacingBand(null) // closing without picking keeps the old video
          }}
        />
      )}

      {status !== 'idle' && (
        <div
          className={cx(
            'font-space text-[10px] uppercase tracking-[0.08em]',
            status === 'error' ? 'text-accent-red' : 'text-ink-faint',
          )}
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Failed'}
        </div>
      )}
    </div>
  )
}
