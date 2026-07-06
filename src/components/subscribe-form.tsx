'use client'

import { useActionState } from 'react'
import { subscribeAction, type SubscribeState } from '@/app/[slug]/actions'

type Variant = 'classic' | 'cinematic'

/** Per-template styling so the form matches each site's chrome. */
const STYLES: Record<Variant, { form: string; input: string; button: string; ok: string; error: string }> = {
  classic: {
    form: 'mt-4 flex w-full max-w-md gap-2',
    input:
      'min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700',
    button:
      'flex-none rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-60 dark:bg-white dark:text-zinc-900',
    ok: 'mt-4 text-sm text-zinc-500 dark:text-zinc-400',
    error: 'mt-2 basis-full text-sm text-red-600 dark:text-red-400',
  },
  cinematic: {
    form: 'mx-auto mt-8 flex w-full max-w-sm gap-2',
    input:
      'min-w-0 flex-1 border border-white/30 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-muted focus:border-flash-1',
    button:
      'flex-none border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-widest transition hover:border-flash-1 hover:text-flash-1 disabled:opacity-60',
    ok: 'mt-8 text-sm uppercase tracking-widest text-muted',
    error: 'mt-2 basis-full text-sm text-flash-1',
  },
}

/**
 * Public email-capture form for an artist site. Posts to the anon `subscribe`
 * door via a server action; on success it swaps to a thank-you, on a bad email
 * it shows the door's message. `variant` matches the active template's chrome.
 */
export function SubscribeForm({ slug, variant = 'classic' }: { slug: string; variant?: Variant }) {
  const s = STYLES[variant]
  const [state, formAction, pending] = useActionState(
    (_prev: SubscribeState | null, formData: FormData) => subscribeAction(slug, formData),
    null,
  )

  if (state?.ok) {
    return <p className={s.ok}>Thanks — you&rsquo;re on the list.</p>
  }

  return (
    <form action={formAction} className={s.form}>
      <input
        name="email"
        type="email"
        required
        placeholder="you@email.com"
        aria-label="Email address"
        className={s.input}
      />
      <button type="submit" disabled={pending} className={s.button}>
        {pending ? '…' : 'Notify me'}
      </button>
      {state?.error && <p className={s.error}>{state.error}</p>}
    </form>
  )
}
