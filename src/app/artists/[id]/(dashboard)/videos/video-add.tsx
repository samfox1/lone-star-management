'use client'

import { Icon } from '@/components/ui/icons'
import { CreateModal } from '../create-modal'
import { addVideoAction, resolveVideoUrlAction } from '../actions'

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
    />
  )
}
