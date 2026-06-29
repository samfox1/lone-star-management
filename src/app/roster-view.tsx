'use client'

import { useState } from 'react'
import Link from 'next/link'
import { requestArtist } from './actions'
import { Icon } from '@/components/ui/icons'
import { Avatar, Button, Field, initials, Input, StatusDot, Textarea } from '@/components/ui/ui'

type Artist = { id: string; name: string; slug: string }
type Pending = { id: string; name: string; handle: string | null }

export function RosterView({
  artists,
  pending,
  subtitle,
}: {
  artists: Artist[]
  pending: Pending[]
  subtitle: string
}) {
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const empty = artists.length === 0 && pending.length === 0

  return (
    <div className="px-7 py-6">
      {/* toolbar */}
      <div className="flex items-center gap-3.5">
        <div>
          <h1 className="text-[19px] font-bold tracking-[-0.01em]">Your artists</h1>
          <p className="mt-0.5 font-space text-xs text-ink-muted">{subtitle}</p>
        </div>
        <div className="flex-1" />
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
          No artists yet — request one to get started.
        </p>
      ) : view === 'list' ? (
        <div className="mt-5 flex flex-col">
          {artists.map((a) => (
            <Link
              key={a.id}
              href={`/artists/${a.id}`}
              className="group flex items-center gap-4 rounded-xl px-3 py-4 transition-colors hover:bg-surface-hover"
            >
              <Avatar initials={initials(a.name)} />
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">{a.name}</div>
                <div className="font-space text-xs text-ink-muted">/{a.slug}</div>
              </div>
              <Icon
                name="chevronRight"
                size={18}
                className="ml-auto text-ink-faint group-hover:text-accent"
              />
            </Link>
          ))}
          {pending.map((p) => (
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
          {artists.map((a) => (
            <Link
              key={a.id}
              href={`/artists/${a.id}`}
              className="flex items-center gap-3 rounded-xl border border-hairline px-4 py-4 transition-colors hover:border-ink-faint hover:bg-surface-hover"
            >
              <Avatar initials={initials(a.name)} />
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">{a.name}</div>
                <div className="font-space text-xs text-ink-muted">/{a.slug}</div>
              </div>
            </Link>
          ))}
          {pending.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-xl border border-hairline px-4 py-4"
            >
              <Avatar initials={initials(p.name)} pending />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">{p.name}</div>
                {p.handle && <div className="font-space text-xs text-ink-muted">/{p.handle}</div>}
              </div>
              <StatusDot tone="pending" />
            </div>
          ))}
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
