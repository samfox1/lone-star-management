'use client'

import { useEffect } from 'react'
import { createAnalytics } from '@samfox1/site-bridge/analytics'

/**
 * Fan-side analytics for the public site: one `view` when a fan LANDS on it, and every click
 * on an element carrying `data-track` through one delegated listener — so the
 * server-rendered templates only add data attributes and stay server components.
 *
 * The reporting itself lives in the bridge (`@samfox1/site-bridge/analytics`), which is the
 * ONE way any connected site talks to the `/event` door. This component is the React
 * lifecycle around it and nothing else; the bridge's rules are pinned in
 * tests/unit/analytics/site-bridge-*.test.ts, and what only this file decides is pinned in
 * tests/components/analytics/site-analytics.test.tsx.
 *
 * A VIEW IS A LANDING (Sam, 2026-09-17): arriving on the site, not switching pages inside
 * it. `landing()` runs once on mount and the bridge decides the rest: a page load reached
 * from the site itself is not a landing, and StrictMode's double mount counts once.
 *
 * NO POSTHOG MIRROR HERE, deliberately. This one app serves every artist at /[slug], and
 * PostHog, once started, keeps capturing with the first artist's slug frozen in. The
 * accuracy cross-check runs on a single-artist site (skeen).
 *
 * Mounted only on the live public page, never the manager's preview or editor.
 */
export function SiteAnalytics({ slug }: { slug: string }) {
  useEffect(() => {
    const analytics = createAnalytics({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      slug,
      // Only `production` reports; a preview deploy is not a fan.
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV,
    })
    analytics.landing()
    return analytics.listen(document)
  }, [slug])

  return null
}
