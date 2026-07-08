'use client'

import { useState } from 'react'
import { trackAttrs } from '@/lib/events'

/** YouTube poster from a normalized embed URL; null for other providers. */
function youtubePoster(embedUrl: string): string | null {
  const m = embedUrl.match(/embed\/([\w-]{11})/)
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null
}

/**
 * Public-site video: a click-to-load facade. We can't see plays happening inside a
 * cross-origin YouTube iframe, so the tile starts as the poster + a play button;
 * clicking it fires a `video_click` (captured by SiteAnalytics, which runs ONLY on
 * the public site — never the dashboard) and swaps in the real iframe. Bonus: no
 * iframe until the fan actually wants it, which is faster. Non-YouTube embeds (no
 * poster) render the iframe directly. Only ever rendered for isSafeEmbedSrc URLs.
 */
export function VideoEmbed({ id, embedUrl, title }: { id: string; embedUrl: string; title: string }) {
  const [open, setOpen] = useState(false)
  const poster = youtubePoster(embedUrl)

  if (open || !poster) {
    return (
      <iframe
        src={open ? `${embedUrl}${embedUrl.includes('?') ? '&' : '?'}autoplay=1` : embedUrl}
        title={title}
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
      {...trackAttrs('video_click', { entity: { kind: 'video', id } })}
      aria-label={`Play ${title}`}
      className="group relative block h-full w-full"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={poster} alt="" className="h-full w-full object-cover transition group-hover:opacity-90" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition group-hover:bg-black/70">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>
    </button>
  )
}
