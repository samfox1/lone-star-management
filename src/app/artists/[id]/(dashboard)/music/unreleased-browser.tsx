'use client'

import { buttonClass, inputClass } from '@/components/ui/ui'
import { SectionToolbar } from '../section-toolbar'
import { SaveForm } from '../save-form'
import { CardGrid } from '../card-grid'
import { EmptyState } from '../empty-state'
import { OriginSection, groupByOrigin } from '../origin'
import { TrackCard, type Track, type ReleaseOption } from '../tracks/track-card'

/** Group key for tracks that aren't on any release. */
export const LOOSE = 'loose'

export type UnreleasedTrack = Track & {
  /** Release id when the track sits inside an UNRELEASED release, else LOOSE. */
  group: string
  /** The unreleased release's title (unused for LOOSE). */
  groupLabel: string
}

type AddAction = (formData: FormData) => Promise<{ error?: string }>

/**
 * Unreleased music: uploads + demos with no platform presence — dashboard-only,
 * never on the public site, so there is deliberately NO publish affordance here.
 * Tracks group under their (unreleased) release like the Released side; loose
 * uploads come last. Adding a track lands here by derivation (manual, no links);
 * it moves to Released by joining a released release or gaining a platform link.
 */
export function UnreleasedBrowser({
  tracks,
  artistId,
  releases,
  addAction,
}: {
  tracks: UnreleasedTrack[]
  artistId: string
  releases: ReleaseOption[]
  addAction: AddAction
}) {
  const releaseOrder = [...new Set(tracks.filter((t) => t.group !== LOOSE).map((t) => t.group))]
  const labels = new Map(tracks.map((t) => [t.group, t.groupLabel]))
  const groups = groupByOrigin(
    tracks,
    (t) => t.group,
    [...releaseOrder, LOOSE],
    (k) => (k === LOOSE ? 'Not on a release' : (labels.get(k) ?? k)),
  )

  const grid = (items: UnreleasedTrack[]) => (
    <CardGrid size="sm" count={items.length}>
      {items.map((t) => (
        <TrackCard key={t.id} artistId={artistId} track={t} releases={releases} />
      ))}
    </CardGrid>
  )

  return (
    <div className="space-y-5">
      <SectionToolbar count={tracks.length} singular="track" plural="tracks" addLabel="Add track">
        <SaveForm action={addAction} savedMessage="Track added" resetOnSuccess className="flex items-center gap-2">
          <input name="title" placeholder="Track title" required autoFocus className={`${inputClass} flex-1`} />
          <button type="submit" className={buttonClass('solid')}>
            Add
          </button>
        </SaveForm>
      </SectionToolbar>

      {tracks.length === 0 ? (
        <EmptyState
          icon="tracks"
          title="No unreleased music"
          hint="Demos live here until they're on a platform. Add a track, then upload its audio."
        />
      ) : groups.length === 1 && groups[0].key === LOOSE ? (
        // Only loose uploads — skip the group chrome.
        grid(groups[0].items)
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <OriginSection key={g.key} label={g.label} count={g.items.length}>
              {grid(g.items)}
            </OriginSection>
          ))}
        </div>
      )}
    </div>
  )
}
