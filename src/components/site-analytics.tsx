'use client'

import { useEffect } from 'react'
import { createAnalytics } from '@samfox1/site-bridge/analytics'

/**
 * Fan-side analytics for the public site: reports a `view` on mount, then every click on an
 * element carrying `data-track` through one delegated listener — so the server-rendered
 * templates only add data attributes and stay server components.
 *
 * The reporting itself lives in the bridge (`@samfox1/site-bridge/analytics`), which is the
 * ONE way any connected site talks to the `/event` door. This component is the React
 * lifecycle around it and nothing else: what goes on the wire, what never does, and what a
 * malformed attribute means are the bridge's rules, pinned in
 * tests/unit/analytics/site-bridge-analytics.test.ts.
 *
 * Mounted only on the live public page, never the manager's preview or editor.
 */
export function SiteAnalytics({ slug }: { slug: string }) {
  useEffect(() => {
    const analytics = createAnalytics({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      slug,
    })
    analytics.pageview()
    return analytics.listen(document)
  }, [slug])

  return null
}
