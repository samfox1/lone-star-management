import Link from 'next/link'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { requireArtist } from '../_data'
import { INTEGRATIONS, type ArtistIdField } from '../integrations'
import { SyncPanel } from '../sync-panel'
import { SaveForm } from '../save-form'
import { saveSoundcloudUrlAction } from '../actions'

/**
 * "Connect your platforms" — the music-connect step. Links an artist's streaming profiles so
 * one Sync (refreshMusicAction) can pull their whole catalog, merged into union rows. Reuses
 * the same SyncPanel the Integrations hub uses for Spotify/Apple/Deezer; SoundCloud is a
 * save-only profile field (no catalog API to pull from). Reachable on its own and never gates
 * access — the future signup wizard will reuse this page.
 */
export default async function ConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  const music = INTEGRATIONS.filter((i) => i.section === 'music')

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-4">
      <div>
        <h1 className="text-[19px] font-bold tracking-[-0.01em]">Connect your platforms</h1>
        <p className="mt-1 font-space text-xs text-ink-faint">
          Link {artist.name}&apos;s streaming profiles, then hit Sync on the Music page to pull the
          whole catalog into one place. A song on multiple services becomes ONE row with each
          service&apos;s link filled in.
        </p>
      </div>

      <div>
        {/* Spotify / Apple / Deezer — the syncable sources, from the shared registry. */}
        {music.map((intg) => (
          <SyncPanel
            key={intg.key}
            title={intg.label}
            idName={intg.idField}
            idValue={(artist as Record<ArtistIdField, string | null>)[intg.idField] ?? ''}
            placeholder={intg.placeholder}
            hasId={!!(artist as Record<ArtistIdField, string | null>)[intg.idField]}
            pullLabel={intg.pullLabel}
            saveAction={intg.save.bind(null, id)}
            pullAction={intg.pull.bind(null, id)}
          />
        ))}

        {/* SoundCloud — profile link only. No catalog API, so it can't auto-sync. */}
        <section className="mb-4 rounded-xl border border-hairline bg-paper p-4">
          <h2 className="text-[15px] font-bold tracking-[-0.01em]">SoundCloud</h2>
          <SaveForm
            action={saveSoundcloudUrlAction.bind(null, id)}
            savedMessage="Saved"
            className="mt-3 flex items-center gap-2"
          >
            <input
              name="soundcloud_url"
              type="url"
              defaultValue={artist.soundcloud_url ?? ''}
              placeholder="https://soundcloud.com/your-profile"
              className={`${inputClass} flex-1`}
            />
            <button
              type="submit"
              className="rounded-md px-2 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              Save
            </button>
          </SaveForm>
          <p className="mt-2 font-space text-xs text-ink-faint">
            Profile link only — SoundCloud has no catalog API, so it can&apos;t auto-sync. Add
            per-song SoundCloud links on each track.
          </p>
        </section>
      </div>

      <Link href={`/artists/${id}/music`} className={buttonClass('solid')}>
        Done — go to Music
      </Link>
    </div>
  )
}
