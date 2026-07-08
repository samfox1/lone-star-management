'use client'

import { useState } from 'react'
import { trackAttrs } from '@/lib/events'
import { videoRenderMode, publicVideoSrc } from '@/lib/video-render'

type EmbedVideo = {
  id: string
  title: string
  provider: string
  embed_url: string | null
  storage_path: string | null
}

/** YouTube poster from a normalized embed URL; null for other providers. */
function youtubePoster(embedUrl: string | null): string | null {
  const m = embedUrl?.match(/embed\/([\w-]{11})/)
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null
}

const PlayGlyph = () => (
  <span className="absolute inset-0 flex items-center justify-center">
    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition group-hover:bg-black/70">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z" />
      </svg>
    </span>
  </span>
)

/**
 * Public-site video. A click-to-load facade fires `video_click` (captured by
 * SiteAnalytics, which runs ONLY on the public site) then swaps in the real player:
 *   - uploaded → a self-hosted <video> (src built from the shape-checked storage path);
 *   - youtube → the embed iframe (poster tile until clicked, so no iframe until wanted);
 *   - other embeds with no poster → the iframe directly.
 * The provider decides the render mode — an uploaded video is never put in an iframe.
 */
export function VideoEmbed({ video }: { video: EmbedVideo }) {
  const [open, setOpen] = useState(false)
  const mode = videoRenderMode(video.provider)
  const poster = mode === 'iframe' ? youtubePoster(video.embed_url) : null

  if (open) {
    if (mode === 'video') {
      const src = publicVideoSrc(video)
      if (!src) return null
      return <video src={src} title={video.title} controls autoPlay playsInline className="h-full w-full bg-black" />
    }
    const embedUrl = video.embed_url!
    return (
      <iframe
        src={`${embedUrl}${embedUrl.includes('?') ? '&' : '?'}autoplay=1`}
        title={video.title}
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="h-full w-full border-0"
      />
    )
  }

  // A non-YouTube embed (no poster) renders its iframe directly — no facade.
  if (mode === 'iframe' && !poster) {
    if (!video.embed_url) return null
    return (
      <iframe
        src={video.embed_url}
        title={video.title}
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="h-full w-full border-0"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      {...trackAttrs('video_click', { entity: { kind: 'video', id: video.id } })}
      aria-label={`Play ${video.title}`}
      className="group relative block h-full w-full"
    >
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="h-full w-full object-cover transition group-hover:opacity-90" />
      ) : (
        <span className="block h-full w-full bg-ink" />
      )}
      <PlayGlyph />
    </button>
  )
}
