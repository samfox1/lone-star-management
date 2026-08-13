import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { type EditorVideo, type ItemEdit, type SiteVideoRole } from '../inspector-types'
import { type ManifestVideoSlot } from '@/lib/site-editor/manifest'
import { CardThumb, EmptySlot, AddFirstLink, LibraryPicker, useScrollIntoFocus } from '../inspector-grid'

/**
 * A video card that shows WHERE a frame click landed: ring + scroll-into-view when it is
 * the focused region, `aria-current` carrying the state for assistive tech and tests.
 * The Videos panel had no focus affordance at all — a routed select opened the panel
 * and visibly selected nothing (Sam, 2026-08-06).
 */
function FocusableCard({ focused, label, children }: { focused: boolean; label: string; children: React.ReactNode }) {
  const ref = useScrollIntoFocus<HTMLDivElement>(focused)
  return (
    <div
      ref={ref}
      aria-current={focused ? 'true' : undefined}
      aria-label={label}
      className={cx('overflow-hidden rounded-lg border', focused ? 'border-accent ring-2 ring-accent' : 'border-hairline')}
    >
      {children}
    </div>
  )
}
import { SlotGroupLabel, SaveLine, NoSlots } from '../inspector-shared'
import { useDebouncedFieldSave } from '../use-debounced-field-save'
import { renameVideoAction } from '../../actions'

/* ── Video tools: the site's video slots ─────────────────────────────────────────
 *
 * EVERY slot is filled by PICKING from the video library (added on the Videos/Assets
 * page). Grouped by where they live on the site:
 *  • Landing page — the hero background: a Landscape slot + a Portrait slot, each picks
 *    an UPLOADED video (assignHeroSlotAction sets its site_role; skeen reads it).
 *  • Videos band — the two YouTube embeds below the disco ball. Picking marks a YouTube
 *    video on-site; the picker offers only real YouTube videos (uploads are hero-only,
 *    Shorts aren't used). Removing a band video marks it off-site (stays in the library).
 *
 * A filled slot's Edit button hands the WHOLE panel to that video (`onEditItem`) — the
 * same full-panel item editor images get: Replace / Remove plus the visual controls
 * (size, transparency, border + colour, corners, shadow). The pickers here only fill
 * EMPTY slots; replace/remove for a filled slot live in the item editor. */
export function VideoTools({
  videos,
  videoSlots,
  artistId,
  onToggleOnSite,
  onAssignHero,
  onEditItem,
  focusedKey,
}: {
  videos: EditorVideo[]
  /** The slots THIS site renders — declared, not hardcoded (phase 4). A site that
   *  declares none shows no video slots (Juniper no longer inherits skeen's). */
  videoSlots: ManifestVideoSlot[]
  artistId: string
  onToggleOnSite: (v: EditorVideo) => void
  onAssignHero: (role: SiteVideoRole, videoId: string | null) => void
  /** Open one video in the full-panel editor (a tile's Edit button). */
  onEditItem: (item: ItemEdit) => void
  /** The selected region's stable key (`item:video:<id>` when a frame click selected a
   *  video — the hero background or an embed tile). Rings + scrolls to its card. */
  focusedKey?: string | null
}) {
  const focusedVideoId = focusedKey?.startsWith('item:video:')
    ? focusedKey.slice('item:video:'.length)
    : null
  const [titles, setTitles] = useState<Record<string, string>>(() =>
    Object.fromEntries(videos.map((v) => [v.id, v.title])),
  )
  // Which EMPTY slot's picker is open: a background role, the band, or none.
  const [picking, setPicking] = useState<SiteVideoRole | 'band' | null>(null)
  const { status, save } = useDebouncedFieldSave<string>({
    persist: (id, title) => renameVideoAction(id, artistId, title),
  })

  function edit(id: string, title: string) {
    setTitles((t) => ({ ...t, [id]: title }))
    save(id, title)
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

  // A background slot as a card (preview on top, title + edit below). An empty slot
  // opens the picker; a filled one's Edit opens the full-panel item editor. The label
  // comes from the DECLARATION now, not a hardcoded table.
  function slotCard(role: SiteVideoRole, label: string) {
    const placed = uploaded.find((v) => v.siteRole === role)
    return (
      <div key={role} className="space-y-1">
        <span className="font-space text-[10px] font-medium uppercase tracking-[0.06em] text-ink-faint">{label}</span>
        {placed ? (
          <FocusableCard focused={placed.id === focusedVideoId} label={label}>
            <CardThumb poster={placed.poster} previewUrl={placed.previewUrl} />
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-xs">{placed.title || 'Untitled video'}</span>
                <button
                  type="button"
                  aria-label={`Edit the ${label} slot`}
                  title="Customize this video"
                  onClick={() => onEditItem({ type: 'videoSlot', role, label })}
                  className="flex-none rounded-md p-1 text-ink-faint hover:bg-surface hover:text-ink"
                >
                  <Icon name="edit" size={13} />
                </button>
              </div>
            </div>
          </FocusableCard>
        ) : (
          <EmptySlot label="Pick a video" onClick={() => setPicking(role)} />
        )}
      </div>
    )
  }

  // The open background-slot picker (any role but 'band'), and whatever video sits in it.
  const slotRole = picking && picking !== 'band' ? picking : null
  const slotPlaced = slotRole ? uploaded.find((v) => v.siteRole === slotRole) : undefined

  // The label a hero slot declares for a role (for the picker heading).
  const labelForRole = (role: string) =>
    videoSlots.find((s) => s.kind === 'hero' && s.role === role)?.label ?? role

  // One YouTube band slot.
  function bandCard(i: number) {
    const v = bandSlots[i]
    if (!v) return <EmptySlot key={`band-empty-${i}`} label="Pick a YouTube video" onClick={() => setPicking('band')} />
    return (
      <FocusableCard key={v.id} focused={v.id === focusedVideoId} label={`Video slot ${i + 1}`}>
        <CardThumb poster={v.poster} previewUrl={v.previewUrl} />
        <div className="px-1.5 py-1">
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
              title="Customize this video"
              onClick={() => onEditItem({ type: 'bandVideo', id: v.id, label: `Video slot ${i + 1}` })}
              className="flex-none rounded-md p-1 text-ink-faint hover:bg-surface hover:text-ink"
            >
              <Icon name="edit" size={14} />
            </button>
          </div>
        </div>
      </FocusableCard>
    )
  }

  // Declared groups, in first-appearance order — the panel MIRRORS what the site
  // renders instead of a hardcoded skeen layout (phase 4). No declared slots → nothing.
  const groups: string[] = []
  for (const s of videoSlots) if (!groups.includes(s.group)) groups.push(s.group)

  return (
    <div className="space-y-3 px-5 py-4">
      {videoSlots.length === 0 && <NoSlots noun="video" />}
      {groups.map((group) => {
        const slots = videoSlots.filter((s) => s.group === group)
        return (
          <div key={group} className="space-y-2">
            <SlotGroupLabel>{group}</SlotGroupLabel>
            <div className="grid grid-cols-2 gap-2">
              {slots.flatMap((slot) =>
                slot.kind === 'hero'
                  ? [slotCard(slot.role as SiteVideoRole, slot.label)]
                  : Array.from({ length: Math.max(slot.count, bandSlots.length) }).map((_, i) => bandCard(i)),
              )}
            </div>
          </div>
        )
      })}

      {slotRole && (
        <LibraryPicker
          title={labelForRole(slotRole)}
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

      {picking === 'band' && (
        <LibraryPicker
          title="YouTube video"
          candidates={bandLibrary}
          keyOf={(v) => v.id}
          labelOf={(v) => v.title || 'Untitled video'}
          renderThumb={(v) => <CardThumb poster={v.poster} previewUrl={v.previewUrl} />}
          empty={<AddFirstLink href={addHref} label="Add a video first" />}
          onPick={(v) => {
            setPicking(null)
            onToggleOnSite(v)
          }}
          onCancel={() => setPicking(null)}
        />
      )}

      <SaveLine status={status} />
    </div>
  )
}
