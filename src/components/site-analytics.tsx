'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { EVENT_TYPE_SET } from '@/lib/events'

/**
 * Fan-side analytics for the public site: fires a `view` on mount, then captures
 * clicks on any element carrying `data-track` (and optional `data-target`) via
 * one delegated listener — so the server-rendered templates only add data
 * attributes, no client wrappers. Fire-and-forget through record_event (the
 * secure anon door); never blocks render and stores no PII. Mounted only on the
 * live public page, not the manager preview.
 */
export function SiteAnalytics({ slug }: { slug: string }) {
  useEffect(() => {
    const supabase = createClient()
    const fire = (type: string, target?: string | null) => {
      if (!EVENT_TYPE_SET.has(type)) return
      void supabase.rpc('record_event', { p_slug: slug, p_type: type, p_target: target ?? null })
    }

    fire('view')

    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest('[data-track]') as HTMLElement | null
      if (el?.dataset.track) fire(el.dataset.track, el.dataset.target ?? null)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [slug])

  return null
}
