'use client'

import { useState } from 'react'
import Link from 'next/link'
import { submitApplication } from './actions'
import { Button, Field, Input, Textarea } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'

export function ApplyForm() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await submitApplication(new FormData(e.currentTarget))
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-hairline bg-paper p-8 text-center shadow-sm">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon name="analytics" size={22} />
        </span>
        <h2 className="mt-4 text-lg font-bold tracking-[-0.01em]">Application received</h2>
        <p className="mt-2 font-space text-xs leading-relaxed text-ink-muted">
          Thanks — we’ll review your details and get back to you by email. In the meantime, keep an
          eye on your inbox.
        </p>
        <Link href="/welcome" className="mt-5 inline-block font-space text-xs font-bold text-accent hover:underline">
          ← Back to home
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-hairline bg-paper p-6 shadow-sm">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2.5 font-space text-xs text-accent-red"
        >
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name">
          <Input name="name" placeholder="Jane Manager" required autoFocus />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" placeholder="you@label.com" required />
        </Field>
      </div>
      <Field label="Artist / project">
        <Input name="artist_name" placeholder="Who are you managing?" />
      </Field>
      <Field label="Spotify or socials link">
        <Input name="link" placeholder="https://…" />
      </Field>
      <Field label="Anything else">
        <Textarea name="notes" placeholder="Roster size, goals, timeline…" />
      </Field>
      <Button type="submit" disabled={busy} className="w-full justify-center">
        {busy ? 'Submitting…' : 'Apply for access'}
      </Button>
    </form>
  )
}
