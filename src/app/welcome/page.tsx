import Link from 'next/link'
import { buttonClass, KLabel } from '@/components/ui/ui'
import { Icon, type IconName } from '@/components/ui/icons'

export const metadata = {
  title: 'Lone Star Management — the operating system for artist careers',
  description:
    'One dashboard for your roster: releases, tour, videos, merch, and real analytics — with a public site that stays current.',
}

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'roster',
    title: 'One dashboard',
    body: 'Roster, releases, tour dates, videos, and merch for every artist — managed in one place, not ten tabs.',
  },
  {
    icon: 'site',
    title: 'A site that stays current',
    body: 'Publish once and the artist’s public site updates itself — smart links, press kit, and all.',
  },
  {
    icon: 'analytics',
    title: 'Real analytics',
    body: 'Site views, plays, and link clicks per artist — honest numbers, no vanity metrics.',
  },
]

export default function WelcomePage() {
  return (
    <div className="font-ui text-ink flex min-h-screen flex-col bg-paper">
      {/* top bar */}
      <header className="flex items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2 text-[15px] font-normal tracking-[-0.01em]">
          <span className="text-accent">★</span> Lone Star <b className="font-bold">Management</b>
        </span>
        <div className="flex items-center gap-2.5">
          <Link href="/login" className={buttonClass('ghost')}>
            Sign in
          </Link>
          <Link href="/apply" className={buttonClass('solid')}>
            Apply for access
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 pb-16 pt-20 text-center sm:pt-28">
        <KLabel>Artist management, operationalized</KLabel>
        <h1 className="mt-5 text-[44px] font-bold leading-[1.05] tracking-[-0.02em] sm:text-[60px]">
          The operating system for artist careers.
        </h1>
        <p className="mt-5 max-w-xl font-space text-sm leading-relaxed text-ink-muted sm:text-base">
          Run your whole roster — releases, tour, videos, merch, and analytics — from one clean
          dashboard, with a public site for each artist that stays current on its own.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/apply" className={buttonClass('solid', 'px-5 py-2.5 text-sm')}>
            Apply for access
          </Link>
          <Link href="/login" className={buttonClass('ghost', 'px-5 py-2.5 text-sm')}>
            Sign in <Icon name="chevronRight" size={15} />
          </Link>
        </div>
      </section>

      {/* features */}
      <section className="mx-auto grid w-full max-w-4xl gap-3 px-6 pb-24 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-hairline p-6">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-ink">
              <Icon name={f.icon} size={20} />
            </span>
            <h3 className="mt-4 text-[15px] font-bold tracking-[-0.01em]">{f.title}</h3>
            <p className="mt-1.5 font-space text-[13px] leading-relaxed text-ink-muted">{f.body}</p>
          </div>
        ))}
      </section>

      {/* closing CTA */}
      <section className="mx-auto mb-24 w-full max-w-4xl px-6">
        <div className="flex flex-col items-center gap-5 rounded-3xl border border-hairline bg-surface px-6 py-14 text-center">
          <h2 className="max-w-xl text-[28px] font-bold tracking-[-0.02em] sm:text-[34px]">
            Bring your roster into one place.
          </h2>
          <p className="max-w-md font-space text-sm text-ink-muted">
            Tell us about your artists and we’ll build their sites and set up your dashboard.
          </p>
          <Link href="/apply" className={buttonClass('solid', 'px-6 py-3 text-sm')}>
            Apply for access
          </Link>
        </div>
      </section>

      <footer className="mt-auto border-t border-hairline px-6 py-8 text-center font-space text-xs text-ink-faint">
        © Lone Star Management
      </footer>
    </div>
  )
}
