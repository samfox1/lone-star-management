'use client'

import { useActionState } from 'react'
import { subscribeAction, type SubscribeState } from '@/app/[slug]/actions'

/**
 * Public email-capture form for an artist site. Posts to the anon `subscribe`
 * door via a server action; on success it swaps to a thank-you, on a bad email
 * it shows the door's message. Styled to match the classic template's chrome.
 */
export function SubscribeForm({ slug }: { slug: string }) {
  const [state, formAction, pending] = useActionState(
    (_prev: SubscribeState | null, formData: FormData) => subscribeAction(slug, formData),
    null,
  )

  if (state?.ok) {
    return (
      <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
        Thanks — you&rsquo;re on the list.
      </p>
    )
  }

  return (
    <form action={formAction} className="mt-4 flex w-full max-w-md gap-2">
      <input
        name="email"
        type="email"
        required
        placeholder="you@email.com"
        aria-label="Email address"
        className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700"
      />
      <button
        type="submit"
        disabled={pending}
        className="flex-none rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-60 dark:bg-white dark:text-zinc-900"
      >
        {pending ? '…' : 'Notify me'}
      </button>
      {state?.error && (
        <p className="mt-2 basis-full text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </form>
  )
}
