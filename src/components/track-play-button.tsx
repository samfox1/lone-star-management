'use client'

import { useEffect, useRef, useState } from 'react'

// One track plays at a time across the page: starting one pauses the previous.
let current: HTMLAudioElement | null = null

/**
 * Inline gated-audio play button. Fetches a signed URL on first play (the raw
 * file isn't publicly reachable), then plays it in its own <audio>. The signed
 * URL is requested once and reused, and its TTL exceeds track length so seeking
 * doesn't outlive it.
 */
export function TrackPlayButton({ slug, trackId }: { slug: string; trackId: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  const loaded = useRef(false)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)

  // Don't leave the shared one-at-a-time ref pointing at an unmounted element.
  useEffect(() => {
    const audio = ref.current
    return () => {
      if (current === audio) current = null
    }
  }, [])

  async function toggle() {
    const audio = ref.current
    if (!audio) return
    if (playing) {
      audio.pause()
      return
    }
    if (!loaded.current) {
      setBusy(true)
      try {
        const res = await fetch(`/api/audio/${slug}/${trackId}`, { cache: 'no-store' })
        if (!res.ok) return
        const { url } = (await res.json()) as { url: string }
        audio.src = url
        loaded.current = true
      } finally {
        setBusy(false)
      }
    }
    if (current && current !== audio) current.pause()
    current = audio
    await audio.play().catch(() => {})
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {busy ? '…' : playing ? '❚❚ Pause' : '▶ Play'}
      </button>
      <audio
        ref={ref}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </>
  )
}
