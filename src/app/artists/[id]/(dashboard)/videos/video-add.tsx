'use client'

import { Icon } from '@/components/ui/icons'
import { createClient } from '@/lib/supabase/client'
import { CreateModal } from '../create-modal'
import { useStorageUpload } from '../use-storage-upload'
import { FileDropField } from '../file-drop-field'
import { addVideoAction, resolveVideoUrlAction } from '../actions'

/** Drop/pick a video file → uploads to the videos bucket + inserts an off-site
 *  (draft) `uploaded` video row. The manager then selects + publishes it like any video. */
function VideoUpload({ artistId, onDone }: { artistId: string; onDone: () => void }) {
  const { busy, error, progress, upload } = useStorageUpload({
    bucket: 'videos',
    artistId,
    category: 'videos',
    noun: 'video',
    resumable: true, // large files: real progress + resume on a dropped connection
    rules: {
      allowedExt: ['mp4', 'mov', 'webm'],
      maxBytes: 500 * 1024 * 1024,
      allowedMime: ['video/mp4', 'video/quicktime', 'video/webm'],
    },
    writeRow: async (path, file) => {
      const title = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Untitled video'
      const { error: rowErr } = await createClient()
        .from('videos')
        .insert({ artist_id: artistId, title, provider: 'uploaded', storage_path: path, source: 'manual', visible: false })
      return rowErr?.message ?? null
    },
    onSuccess: onDone, // close the modal only after the upload fully settles
  })
  return (
    <FileDropField
      accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
      label="Drop a video or click to upload"
      hint="MP4, MOV or WebM · up to 500 MB"
      busy={busy}
      progress={progress}
      error={error}
      onFile={upload}
    />
  )
}

function VideoPreview({ thumbnail, title }: { thumbnail?: string; title?: string }) {
  return (
    <div className="w-40">
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-ink text-white/70">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon name="videos" size={20} />
        )}
      </div>
      <div className="mt-2 truncate text-sm font-semibold">{title || 'New video'}</div>
    </div>
  )
}

/** The Videos "Add" button: Auto (paste link → oEmbed detect) or Manual, two-pane. */
export function VideoAddButton({ artistId }: { artistId: string }) {
  return (
    <CreateModal
      kind="Video"
      title="Add video"
      auto={{
        placeholder: 'Paste a YouTube link',
        resolve: async (url) => {
          const r = await resolveVideoUrlAction(url)
          if (!r.ok) return { error: r.error }
          return { values: { title: r.title, embed_url: url, _thumbnail: r.thumbnail ?? '' } }
        },
      }}
      fields={[
        { name: 'title', placeholder: 'Title', required: true },
        { name: 'embed_url', placeholder: 'YouTube URL', type: 'url', required: true },
      ]}
      preview={(v) => <VideoPreview thumbnail={v._thumbnail} title={v.title} />}
      submit={(fd) => addVideoAction(artistId, fd)}
      upload={(close) => <VideoUpload artistId={artistId} onDone={close} />}
    />
  )
}
