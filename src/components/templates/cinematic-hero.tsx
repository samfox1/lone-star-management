'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type HeroClip = { url: string }

function videoMime(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  if (ext === 'webm') return 'video/webm'
  if (ext === 'mov') return 'video/quicktime'
  if (ext === 'ogg' || ext === 'ogv') return 'video/ogg'
  return 'video/mp4'
}

/**
 * Fullscreen hero. If the artist has video clips it plays a muted montage
 * (unmuting on first interaction); otherwise it falls back to a static hero
 * image. The wordmark uses the glitch FX from effects.css.
 */
export function CinematicHero({
  name,
  clips,
  poster,
}: {
  name: string
  clips: HeroClip[]
  poster: string | null
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [index, setIndex] = useState(0)
  const [muted, setMuted] = useState(true)
  const unlockedRef = useRef(false)
  const hasVideo = clips.length > 0
  const clip = clips[index]

  const handleEnded = useCallback(() => {
    setIndex((i) => (i + 1) % clips.length)
  }, [clips.length])

  useEffect(() => {
    if (!hasVideo) return
    const unlock = () => {
      if (unlockedRef.current) return
      unlockedRef.current = true
      const v = videoRef.current
      if (!v) return
      v.muted = false
      setMuted(false)
      v.play().catch(() => {
        v.muted = true
        setMuted(true)
        v.play().catch(() => {})
      })
    }
    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'touchstart']
    events.forEach((e) => window.addEventListener(e, unlock, { once: true, passive: true }))
    return () => events.forEach((e) => window.removeEventListener(e, unlock))
  }, [hasVideo])

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted, index])

  return (
    <section id="home" className="relative h-[100svh] w-full overflow-hidden fx-scanlines">
      {hasVideo ? (
        <video
          ref={videoRef}
          key={clip.url}
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted={muted}
          playsInline
          onEnded={handleEnded}
          preload="auto"
          poster={poster ?? undefined}
        >
          <source src={clip.url} type={videoMime(clip.url)} />
        </video>
      ) : poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt={name} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 to-black" />
      )}

      <div className="fx-flash" aria-hidden />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40" />

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <h1
          data-text={name}
          className="fx-glitch font-display text-7xl font-black uppercase tracking-tight sm:text-8xl md:text-9xl"
        >
          {name}
        </h1>
        <p className="mt-4 max-w-md text-sm uppercase tracking-[0.3em] text-muted">
          DJ &amp; Producer
        </p>
        <a
          href="#shows"
          className="mt-10 border border-white/30 px-8 py-3 text-xs font-semibold uppercase tracking-widest transition hover:border-flash-1 hover:text-flash-1"
        >
          Upcoming Shows
        </a>
      </div>

      {hasVideo && (
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="absolute bottom-6 right-6 z-20 rounded-full border border-white/30 bg-black/40 px-4 py-2 text-xs font-semibold uppercase tracking-widest backdrop-blur transition hover:border-flash-2 hover:text-flash-2"
        >
          {muted ? 'Sound: Off' : 'Sound: On'}
        </button>
      )}
    </section>
  )
}
