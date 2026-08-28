'use client'

import { useState } from 'react'
import { buttonClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { AuditPanel } from '../audit-panel'
import { SeeIt } from './rows'

/** Run the check, and open Google's own testers on the site. */
export function TestSection({ artistId, siteUrl }: { artistId: string; siteUrl: string | null }) {
  const [open, setOpen] = useState(false)
  const enc = siteUrl ? encodeURIComponent(siteUrl + '/') : ''
  const tools = siteUrl
    ? [
        { label: 'Rich Results Test', href: `https://search.google.com/test/rich-results?url=${enc}` },
        { label: 'Schema validator', href: `https://validator.schema.org/#url=${enc}` },
        { label: 'PageSpeed', href: `https://pagespeed.web.dev/analysis?url=${enc}` },
        { label: 'Search Console', href: 'https://search.google.com/search-console' },
        { label: 'Bing Webmaster', href: 'https://www.bing.com/webmasters' },
      ]
    : []
  return (
    <div className="space-y-4">
      <div className="relative flex justify-end">
        {tools.length > 0 && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={buttonClass('ghost')}>
            Test with <Icon name="chevronRight" size={12} />
          </button>
        )}
        {open && (
          <div className="absolute right-0 top-10 z-10 flex w-56 flex-col rounded-lg border border-hairline bg-paper p-1 shadow-lg">
            {tools.map((t) => (
              <a key={t.label} href={t.href} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-md px-3 py-2 font-space text-[11px] text-ink-muted hover:bg-surface hover:text-ink">
                {t.label} <Icon name="external" size={12} />
              </a>
            ))}
          </div>
        )}
      </div>
      <AuditPanel artistId={artistId} siteUrl={siteUrl} />
      <SeeIt>run it after each publish. Rows in red name the section that fixes them.</SeeIt>
    </div>
  )
}
