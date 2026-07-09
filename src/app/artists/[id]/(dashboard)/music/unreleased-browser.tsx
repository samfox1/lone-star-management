'use client'

import type { ReactNode } from 'react'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { SectionToolbar } from '../section-toolbar'
import { SaveForm } from '../save-form'
import { CardGrid } from '../card-grid'
import { EmptyState } from '../empty-state'
import { OriginSection, groupByOrigin } from '../origin'
import { TrackCard, type Track, type ReleaseOption } from '../tracks/track-card'
import { ReleaseCard, type Release } from '../releases/release-card'

/** Group key for songs that aren't on any release. */
export const LOOSE = 'loose'

export type UnreleasedTrack = Track & {
  /** Release id when the song sits inside an UNRELEASED release, else LOOSE. */
  group: string
  /** The unreleased release's title (unused for LOOSE). */
  groupLabel: string
}

type AddAction = (formData: FormData) => Promise<{ error?: string }>

/**
 * Unreleased music: uploads + demos with no platform presence — dashboard-only,
 * never on the public site, so there is deliberately NO publish affordance here.
 * Unreleased RELEASES (a demo EP) render as manageable cards (edit type / DSP
 * links / delete — no on-site select, publish doesn't apply); their songs group
 * under the release title like the Released side, loose uploads last. Adding a
 * song lands here by derivation (manual, no links); it moves to Released by
 * joining a released release, getting a listen link, or its release gaining a
 * DSP link.
 */
export function UnreleasedBrowser({
  tracks,
  artistId,
  artistSlug,
  releases,
  unreleasedReleases = [],
  addAction,
  importPanel,
}: {
  tracks: UnreleasedTrack[]
  artistId: string
  artistSlug: string
  /** Options for the per-song "assign to release" selector (ALL releases). */
  releases: ReleaseOption[]
  /** The unreleased releases themselves, rendered as manageable cards. */
  unreleasedReleases?: Release[]
  addAction: AddAction
  /** Optional import UI (e.g. the Drive browser), shown via the toolbar's Import toggle. */
  importPanel?: ReactNode
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

  const empty = tracks.length === 0 && unreleasedReleases.length === 0

  return (
    <div className="space-y-5">
      <SectionToolbar
        count={tracks.length}
        singular="song"
        plural="songs"
        addLabel="Add song"
        importPanel={importPanel}
      >
        <SaveForm action={addAction} savedMessage="Song added" resetOnSuccess className="flex items-center gap-2">
          <input name="title" placeholder="Song title" required autoFocus className={`${inputClass} flex-1`} />
          <button type="submit" className={buttonClass('solid')}>
            Add
          </button>
        </SaveForm>
      </SectionToolbar>

      {empty ? (
        <EmptyState
          icon="tracks"
          title="No unreleased music"
          hint="Demos live here until they're on a platform. Add a song, then upload its audio."
        />
      ) : (
        <div className="space-y-8">
          {unreleasedReleases.length > 0 && (
            <CardGrid size="md" count={unreleasedReleases.length}>
              {unreleasedReleases.map((r) => (
                <ReleaseCard key={r.id} release={r} artistId={artistId} artistSlug={artistSlug} />
              ))}
            </CardGrid>
          )}
          {groups.length === 1 && groups[0].key === LOOSE
            ? // Only loose uploads — skip the group chrome.
              grid(groups[0].items)
            : groups.map((g) => (
                <OriginSection key={g.key} label={g.label} count={g.items.length}>
                  {grid(g.items)}
                </OriginSection>
              ))}
        </div>
      )}
    </div>
  )
}
