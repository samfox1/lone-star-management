import Link from 'next/link'
import { login } from '@/app/auth-actions'
import { Button, Field, Input } from '@/components/ui/ui'

export const metadata = { title: 'Sign in — Lone Star Management' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <div className="font-ui text-ink flex min-h-screen flex-col items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-[34px] leading-none text-accent">★</div>
          <h1 className="mt-4 text-[26px] font-bold tracking-[-0.02em]">Lone Star Management</h1>
          <p className="mt-2 font-space text-xs uppercase tracking-[0.1em] text-ink-faint">
            Manager sign in
          </p>
        </div>

        <form
          action={login}
          className="space-y-4 rounded-2xl border border-hairline bg-paper p-6 shadow-sm"
        >
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2.5 font-space text-xs text-accent-red"
            >
              {error}
            </p>
          )}

          <Field label="Email">
            <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
          </Field>

          <Field label="Password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>

          <Button type="submit" className="w-full justify-center">
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-center font-space text-xs text-ink-muted">
          Want a site for your artist?{' '}
          <Link href="/apply" className="font-bold text-accent hover:underline">
            Apply for access
          </Link>
        </p>
      </div>
    </div>
  )
}
