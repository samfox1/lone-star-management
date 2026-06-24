import Link from 'next/link'
import { logout } from '@/app/auth-actions'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Your artists — Lone Star Management' }

export default async function Home() {
  const supabase = await createClient()

  // The proxy guarantees a session here, but read the user for the header.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // RLS scopes this to only the artists this manager manages (admins see all).
  const { data: artists, error } = await supabase
    .from('artists')
    .select('id, name, slug')
    .order('name')

  // A failed read must never look like an empty result on the security gate.
  // Throw to the error boundary so "system broke" is distinct from "no access".
  if (error) throw error

  const isAdmin = user?.app_metadata?.role === 'admin'

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Lone Star Management
        </span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-500">{user?.email}</span>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Your artists
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {isAdmin
            ? 'Admin — every artist on the platform.'
            : 'The artists you manage.'}
        </p>

        {artists && artists.length > 0 ? (
          <ul className="mt-6 space-y-2">
            {artists.map((artist) => (
              <li key={artist.id}>
                <Link
                  href={`/artists/${artist.id}`}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {artist.name}
                  </span>
                  <span className="text-sm text-zinc-400">/{artist.slug}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No artists assigned to you yet.
          </p>
        )}
      </main>
    </div>
  )
}
