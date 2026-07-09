'use client'

import { Icon } from '@/components/ui/icons'
import { createClient } from '@/lib/supabase/client'
import { CreateModal } from '../create-modal'
import { useStorageUpload } from '../use-storage-upload'
import { FileDropField } from '../file-drop-field'
import { addContentAction } from '../actions'

/** Drop/pick an audio file → uploads to the gated audio bucket + inserts the song
 *  row (manual, no platform links ⇒ Unreleased by derivation). */
function SongUpload({ artistId, onDone }: { artistId: string; onDone: () => void }) {
  const { busy, error, progress, upload } = useStorageUpload({
    bucket: 'audio',
    artistId,
    category: 'audio',
    noun: 'song',
    rules: {
      allowedExt: ['mp3', 'm4a'],
      maxBytes: 30 * 1024 * 1024,
      allowedMime: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a'],
    },
    writeRow: async (path, file) => {
      const title = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Untitled song'
      const { error: rowErr } = await createClient()
        .from('tracks')
        .insert({ artist_id: artistId, title, source: 'manual', audio_path: path })
      return rowErr?.message ?? null
    },
    onSuccess: onDone, // close the modal only after the upload fully settles
  })
  return (
    <FileDropField
      accept="audio/mpeg,audio/mp4,.mp3,.m4a"
      label="Drop a song or click to upload"
      hint="MP3 or M4A · up to 30 MB"
      busy={busy}
      progress={progress}
      error={error}
      onFile={upload}
    />
  )
}

function SongPreview({ title }: { title?: string }) {
  return (
    <div className="w-32">
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-hairline bg-surface text-ink-faint">
        <Icon name="tracks" size={26} />
      </div>
      <div className="mt-2 truncate text-sm font-semibold">{title || 'New song'}</div>
    </div>
  )
}

/**
 * The "Add song" modal (same flow as the other add-music modals): Manual (just a
 * title) or Upload (drop an MP3/M4A — the row is created with the hosted audio in
 * one step). Either way the song starts UNRELEASED by derivation; a listen link
 * or a released release promotes it.
 */
export function SongAddButton({ artistId }: { artistId: string }) {
  return (
    <CreateModal
      kind="Song"
      title="Add song"
      triggerLabel="Song"
      fields={[{ name: 'title', placeholder: 'Song title', required: true }]}
      preview={(v) => <SongPreview title={v.title} />}
      submit={(fd) => addContentAction('track', artistId, fd)}
      upload={(close) => <SongUpload artistId={artistId} onDone={close} />}
    />
  )
}
