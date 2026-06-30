'use client'

import { useState } from 'react'
import Link from 'next/link'
import { requestArtist } from './actions'
import { compactNumber } from '@/lib/format'
import { Icon } from '@/components/ui/icons'
import { Avatar, Button, Field, initials, Input, StatusDot, Textarea } from '@/components/ui/ui'
import { StatsPanel, type RosterTotals } from './stats-panel'

export type ArtistStat = { views: number; plays: number; linkClicks: number }
type Artist = { id: string; name: string; slug: string }
type Pending = { id: string; name: string; handle: string | null }

export function RosterView({
  artists,
  pending,
  stats,
  totals,
  top,
  subtitle,
}: {
  artists: Artist[]
  pending: Pending[]
  stats: Record<string, ArtistStat>
  totals: RosterTotals
  top: { name: string; views: number } | null
  subtitle: string
}) {
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)

  function openModal() {
    setError(null)
    setOpen(true)
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await requestArtist(new FormData(e.currentTarget))
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const needle = q.trim().toLowerCase()
  const hit = (name: string, handle: string | null) =>
    !needle || name.toLowerCase().includes(needle) || (handle ?? '').toLowerCase().includes(needle)
  const fArtists = artists.filter((a) => hit(a.name, a.slug))
  const fPending = pending.filter((p) => hit(p.name, p.handle))
  const empty = fArtists.length === 0 && fPending.length === 0

  const hovered = hover ? artists.find((a) => a.id === hover.id) : null
  const hStat = hover ? stats[hover.id] : undefined

  function track(id: string) {
    return {
      onMouseEnter: (e: React.MouseEvent) => setHover({ id, x: e.clientX, y: e.clientY }),
      onMouseMove: (e: React.MouseEvent) =>
        setHover((h) => (h && h.id === id ? { ...h, x: e.clientX, y: e.clientY } : h)),
      onMouseLeave: () => setHover((h) => (h && h.id === id ? null : h)),
    }
  }

  return (
    <div className="relative flex min-h-full">
      <div className="min-w-0 flex-1 px-7 py-6">
        {/* toolbar */}
        <div className="flex items-center gap-3.5">
          <div>
            <h1 className="text-[19px] font-bold tracking-[-0.01em]">Your artists</h1>
            <p className="mt-0.5 font-space text-xs text-ink-muted">{subtitle}</p>
          </div>
          <div className="flex-1" />
          <label className="hidden items-center gap-2 rounded-lg border border-hairline px-3 py-2 focus-within:border-ink-faint sm:flex">
            <Icon name="search" size={16} className="text-ink-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search artists…"
              className="w-36 bg-transparent font-space text-xs text-ink outline-none placeholder:text-ink-faint"
            />
          </label>
          <div className="inline-flex gap-0.5 rounded-lg bg-track p-0.5">
            <button
              onClick={() => setView('grid')}
              title="Grid view"
              className={`rounded-md px-2.5 py-1.5 ${view === 'grid' ? 'bg-paper text-ink shadow-sm' : 'text-ink-muted'}`}
            >
              <Icon name="grid" size={17} />
            </button>
            <button
              onClick={() => setView('list')}
              title="List view"
              className={`rounded-md px-2.5 py-1.5 ${view === 'list' ? 'bg-paper text-ink shadow-sm' : 'text-ink-muted'}`}
            >
              <Icon name="list" size={17} />
            </button>
          </div>
          <Button onClick={openModal}>
            <Icon name="plus" size={16} /> Request artist
          </Button>
        </div>

        {/* roster */}
        {empty ? (
          <p className="mt-8 rounded-xl border border-dashed border-hairline px-4 py-10 text-center font-space text-sm text-ink-muted">
            {needle ? 'No artists match your search.' : 'No artists yet — request one to get started.'}
          </p>
        ) : view === 'list' ? (
          <div className="mt-5 flex flex-col">
            {fArtists.map((a) => {
              const s = stats[a.id]
              return (
                <Link
                  key={a.id}
                  href={`/artists/${a.id}`}
                  {...track(a.id)}
                  className="group flex items-center gap-4 rounded-xl px-3 py-4 transition-colors hover:bg-surface-hover"
                >
                  <Avatar initials={initials(a.name)} />
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold">{a.name}</div>
                    <div className="font-space text-xs text-ink-muted">/{a.slug}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-7">
                    <div className="text-right">
                      <div className="font-space text-sm font-bold tabular-nums">
                        {s?.views ? compactNumber(s.views) : '—'}
                      </div>
                      <div className="font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                        views · 30d
                      </div>
                    </div>
                    <Icon
                      name="chevronRight"
                      size={18}
                      className="text-ink-faint group-hover:text-accent"
                    />
                  </div>
                </Link>
              )
            })}
            {fPending.map((p) => (
              <div key={p.id} className="flex items-center gap-4 px-3 py-4">
                <Avatar initials={initials(p.name)} pending />
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{p.name}</div>
                  {p.handle && <div className="font-space text-xs text-ink-muted">/{p.handle}</div>}
                </div>
                <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-hairline px-2.5 py-1 font-space text-[10px] uppercase tracking-[0.05em] text-ink-muted">
                  <StatusDot tone="pending" /> Site in progress
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {fArtists.map((a) => {
              const s = stats[a.id]
              return (
                <Link
                  key={a.id}
                  href={`/artists/${a.id}`}
                  {...track(a.id)}
                  className="group rounded-2xl border border-hairline px-5 py-5 transition-colors hover:bg-surface-hover"
                >
                  <div className="flex items-center gap-3">
                    <Avatar initials={initials(a.name)} />
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold">{a.name}</div>
                      <div className="font-space text-xs text-ink-muted">/{a.slug}</div>
                    </div>
                    <span className="ml-auto inline-flex items-center gap-1.5 font-space text-[10px] uppercase tracking-[0.07em] text-ink-muted">
                      <StatusDot tone="live" /> Live
                    </span>
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <div className="font-space text-[22px] font-bold tabular-nums tracking-[-0.02em]">
                        {s?.views ? compactNumber(s.views) : '—'}
                      </div>
                      <div className="mt-1 font-space text-[10px] uppercase tracking-[0.07em] text-ink-faint">
                        views · 30 days
                      </div>
                    </div>
                    <Icon
                      name="chevronRight"
                      size={18}
                      className="text-ink-faint group-hover:text-accent"
                    />
                  </div>
                </Link>
              )
            })}
            {fPending.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-2xl border border-hairline px-5 py-5"
              >
                <Avatar initials={initials(p.name)} pending />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">{p.name}</div>
                  {p.handle && <div className="font-space text-xs text-ink-muted">/{p.handle}</div>}
                </div>
                <span className="inline-flex items-center gap-1.5 font-space text-[10px] uppercase tracking-[0.07em] text-ink-muted">
                  <StatusDot tone="pending" /> In progress
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <StatsPanel totals={totals} top={top} />

      {/* hover stats popover (desktop pointer only) */}
      {hovered && hover && (
        <div
          className="pointer-events-none fixed z-[60] hidden w-[250px] rounded-[13px] border border-hairline bg-paper p-[15px] shadow-[0_12px_38px_rgba(0,0,0,0.17)] md:block"
          style={{
            left: hover.x > 1100 ? hover.x - 266 : hover.x + 16,
            top: Math.min(hover.y + 16, typeof window === 'undefined' ? 600 : window.innerHeight - 230),
          }}
        >
          <div className="flex items-center gap-2.5">
            <Avatar initials={initials(hovered.name)} size={34} />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{hovered.name}</div>
              <div className="font-space text-[11px] text-ink-muted">/{hovered.slug}</div>
            </div>
          </div>
          <div className="mt-3 font-space text-[23px] font-bold tracking-[-0.02em]">
            {hStat?.views ? compactNumber(hStat.views) : '—'}
          </div>
          <div className="font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">
            Site views · 30 days
          </div>
          <div className="mt-3 space-y-1 border-t border-hairline pt-3">
            <PopRow k="Plays" v={hStat?.plays ?? 0} />
            <PopRow k="Link clicks" v={hStat?.linkClicks ?? 0} />
          </div>
        </div>
      )}

      {/* request modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-7"
          onClick={(e) => e.target === e.currentTarget && !busy && setOpen(false)}
        >
          <form
            onSubmit={submit}
            className="max-h-[88vh] w-[460px] max-w-full overflow-auto rounded-2xl bg-paper p-6 shadow-2xl"
          >
            <h3 className="text-lg font-bold tracking-[-0.01em]">Request an artist</h3>
            <p className="mb-4 mt-2 font-space text-xs leading-relaxed text-ink-muted">
              Tell us about the artist. We&rsquo;ll build their site and add them to your roster.
            </p>
            <div className="space-y-3.5">
              <Field label="Artist name">
                <Input name="name" placeholder="e.g. Cody Johnson" autoFocus required />
              </Field>
              <Field label="Preferred handle">
                <Input name="handle" placeholder="/codyjohnson (optional)" />
              </Field>
              <Field label="Spotify or socials link">
                <Input name="link" placeholder="https://…" />
              </Field>
              <Field label="Notes">
                <Textarea name="notes" placeholder="Anything we should know — vibe, references, timeline…" />
              </Field>
            </div>
            {error && (
              <p className="mt-4 rounded-lg border border-danger-border bg-danger-soft px-3 py-2.5 font-space text-xs text-accent-red">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2.5">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Submitting…' : 'Submit request'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function PopRow({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex justify-between font-space text-[11px] text-ink-muted">
      <span>{k}</span>
      <b className="font-bold text-ink">{compactNumber(v)}</b>
    </div>
  )
}
