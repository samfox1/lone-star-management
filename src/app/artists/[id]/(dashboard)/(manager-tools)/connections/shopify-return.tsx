'use client'

import { useEffect, useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import type { ShopifyReturn } from '@/lib/merch/shopify-oauth'

/**
 * BACK FROM SHOPIFY: one line above the list — "Shopify connected.", or what went wrong in
 * plain words — until the manager dismisses it or leaves. The words are chosen on the server
 * from a CODE in the URL (`shopifyReturnNotice`), never read from the URL itself.
 *
 * A line, not a toast: a failure is something to read, and a toast raised on first paint can
 * fire before the dashboard's Toaster is listening. The `shopify`/`reason` params come out of
 * the address bar once shown, so a reload does not say it again.
 */
export function ShopifyReturnNotice({ kind, message }: ShopifyReturn) {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('shopify')) return
    url.searchParams.delete('shopify')
    url.searchParams.delete('reason')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  if (!open) return null
  const error = kind === 'error'
  return (
    <div className="mx-auto mb-4 max-w-3xl">
      <div role={error ? 'alert' : 'status'} className={cx('flex items-start gap-2 font-space text-[12px] leading-5', error ? 'text-accent-red' : 'text-ink-muted')}>
        <Icon name={error ? 'alert' : 'check'} size={12} className="mt-1 flex-none" />
        <span className="min-w-0 flex-1">{message}</span>
        <button type="button" aria-label="Dismiss" onClick={() => setOpen(false)} className="flex-none text-ink-faint transition-colors hover:text-ink">
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  )
}
