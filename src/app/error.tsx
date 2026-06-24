'use client' // Error boundaries must be Client Components in the App Router.

import { useEffect } from 'react'

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-20 text-center dark:bg-black">
      <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Something went wrong.
      </h2>
      <p className="mt-1 max-w-sm text-sm text-zinc-500">
        We couldn&apos;t load this page. This is on us, not your access — please
        try again.
      </p>
      <button
        onClick={() => unstable_retry()}
        className="mt-6 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        Try again
      </button>
    </div>
  )
}
