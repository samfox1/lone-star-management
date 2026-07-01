import Link from 'next/link'
import { ApplyForm } from './apply-form'

export const metadata = { title: 'Apply for access — Lone Star Management' }

export default function ApplyPage() {
  return (
    <div className="font-ui text-ink flex min-h-screen flex-col bg-paper">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/welcome" className="flex items-center gap-2 text-[15px] font-normal tracking-[-0.01em]">
          <span className="text-accent">★</span> Lone Star <b className="font-bold">Management</b>
        </Link>
        <Link href="/login" className="font-space text-xs text-ink-muted transition-colors hover:text-ink">
          Sign in
        </Link>
      </header>

      <div className="mx-auto w-full max-w-xl px-6 py-12">
        <div className="text-center">
          <h1 className="text-[32px] font-bold tracking-[-0.02em]">Apply for access</h1>
          <p className="mt-3 font-space text-sm leading-relaxed text-ink-muted">
            Tell us about you and your artists. We build the sites and set up your dashboard — access
            is granted by invite.
          </p>
        </div>
        <div className="mt-8">
          <ApplyForm />
        </div>
      </div>
    </div>
  )
}
