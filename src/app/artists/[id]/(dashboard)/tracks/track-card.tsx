'use client'

import { buttonClass, inputClass } from '@/components/ui/ui'
import { trackPlatforms, type TrackPlatformIds } from '@/lib/music'
import { GridCard } from '../grid-card'
import { deleteContentAction, setTrackReleaseAction, updateContentAction } from '../actions'
import { SaveForm } from '../save-form'
import { TrackAudioUploader } from '../track-audio-uploader'

/** A release the track can be assigned to (id + title, for the selector). */
export type ReleaseOption = { id: string; title: string }

export type Track = TrackPlatformIds & {
  id: string
  title: string
  cover_url: string | null
  stream_url: string | null
  source: string | null
  audio_path: string | null
  release_id: string | null
}

/**
 * The union-model badge row: one chip per platform the track lives on. `linked`
 * renders each chip as an outbound link — modal only; the grid tile sits inside
 * GridCard's trigger <button>, where a nested <a> would be invalid.
 */
function PlatformBadges({ track, linked = false }: { track: Track; linked?: boolean }) {
  const platforms = trackPlatforms(track)
  if (platforms.length === 0) return null
  const text = 'font-space text-[10px] uppercase tracking-[0.06em] text-ink-faint'
  return (
    <span className="inline-flex items-center gap-2">
      {platforms.map((p) =>
        linked && p.url ? (
          <a
            key={p.key}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${text} hover:text-ink-muted hover:underline`}
          >
            {p.label} ↗
          </a>
        ) : (
          <span key={p.key} className={text}>
            {p.label}
          </span>
        ),
      )}
    </span>
  )
}

/**
 * A track as a cover-grid tile; opens a modal to rename, assign it to a release,
 * attach hosted audio, open the source, or delete.
 */
export function TrackCard({
  track,
  artistId,
  releases,
}: {
  track: Track
  artistId: string
  releases: ReleaseOption[]
}) {
  const platforms = trackPlatforms(track)

  return (
    <GridCard
      deleteAction={deleteContentAction.bind(null, 'track', track.id, artistId)}
      deleteLabel="Delete track"
      deleteNoun="Track"
      tile={
        <>
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-surface">
            {track.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={track.cover_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="h-9 w-9 rounded-full bg-ink" />
            )}
          </div>
          <div className="mt-2.5 truncate text-sm font-semibold group-hover:text-accent">{track.title}</div>
          {platforms.length > 0 && (
            <div className="mt-0.5">
              <PlatformBadges track={track} />
            </div>
          )}
        </>
      }
    >
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-xl bg-surface">
          {track.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="h-7 w-7 rounded-full bg-ink" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <SaveForm
            action={updateContentAction.bind(null, 'track', track.id, artistId)}
            className="flex items-center gap-2"
          >
            <input name="title" defaultValue={track.title} required className={`${inputClass} flex-1`} />
            <button type="submit" className={buttonClass('ghost')}>
              Save
            </button>
          </SaveForm>
          {platforms.length > 0 && (
            <div className="mt-1.5">
              <PlatformBadges track={track} linked />
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <TrackAudioUploader artistId={artistId} trackId={track.id} hasAudio={!!track.audio_path} />
        {platforms.length === 0 && track.stream_url && (
          <a
            href={track.stream_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-space text-xs text-ink-muted hover:underline"
          >
            Open source ↗
          </a>
        )}
      </div>

      {releases.length > 0 && (
        <SaveForm
          action={setTrackReleaseAction.bind(null, track.id, artistId)}
          savedMessage="Release updated"
          className="mt-4 flex items-center gap-2"
        >
          <span className="font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Release</span>
          <select
            name="release_id"
            defaultValue={track.release_id ?? ''}
            className="min-w-0 flex-1 rounded-lg border border-hairline bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink-faint"
          >
            <option value="">— None —</option>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass('ghost')}>
            Save
          </button>
        </SaveForm>
      )}
    </GridCard>
  )
}
