'use client'

import { useState } from 'react'

export type WorkTab = { key: string; label: string; embedUrl: string; platform: string; link?: string }

/** Tabbed player embeds (Releases / Sets …), derived from the artist's backend
 *  data (Spotify catalog from spotify_artist_id, SoundCloud from a link). */
export function CinematicWork({ tabs }: { tabs: WorkTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key)
  const current = tabs.find((t) => t.key === active)

  return (
    <section id="work" className="mx-auto w-full max-w-4xl px-6 py-24">
      <h2 className="font-display text-4xl font-black uppercase tracking-tight md:text-5xl">Work</h2>

      {tabs.length === 0 ? (
        <p className="mt-8 text-muted">Coming soon.</p>
      ) : (
        <>
          <div className="mt-8 flex gap-2 border-b border-border">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActive(tab.key)}
                className={`px-5 py-3 text-xs font-semibold uppercase tracking-widest transition ${
                  active === tab.key
                    ? 'border-b-2 border-flash-1 text-foreground'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {current && (
            <div className="mt-8 flex flex-col gap-2">
              <iframe
                src={current.embedUrl}
                title={current.label}
                loading="lazy"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                className="aspect-video w-full border border-border bg-black"
              />
              {current.link && (
                <a
                  href={current.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-end text-sm text-muted transition hover:text-flash-2"
                >
                  {current.platform} →
                </a>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
