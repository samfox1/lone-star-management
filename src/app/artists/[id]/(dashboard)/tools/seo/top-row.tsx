'use client'

/**
 * The SEO / GEO chrome (prototype round 4, V02): the sections as the assets page's
 * pill group on the left, "Test with" on the right, and the floating blue Publish bar
 * bottom-right — shown only while something this editor changes is unpublished.
 */
import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { buttonClass } from '@/components/ui/ui'
import { PublishBar } from '../../publish-bar'
import { publishSiteWithPasswordAction } from '../../actions'
import { SEO_SECTIONS } from './sections'

export function SeoTopRow({ artistId, unpublished, siteUrl }: { artistId: string; unpublished: boolean; siteUrl: string | null }) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const base = `/artists/${artistId}/tools/seo`
  const active = pathname.slice(base.length).replace(/^\//, '').split('/')[0] || SEO_SECTIONS[0].seg
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
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="SEO / GEO sections" className="inline-flex flex-wrap gap-0.5 rounded-lg border border-hairline p-1">
          {SEO_SECTIONS.map((s) => (
            <Link
              key={s.seg}
              href={`${base}/${s.seg}`}
              aria-current={s.seg === active ? 'page' : undefined}
              className={cx(
                'rounded-md px-3.5 py-1.5 font-space text-xs tracking-[0.02em] transition-colors',
                s.seg === active ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink',
              )}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        {tools.length > 0 && (
          <div className="relative">
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={buttonClass('ghost')}>
              Test with <Icon name="chevronRight" size={12} />
            </button>
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
        )}
      </div>
      <PublishBar
        pendingCount={0}
        dirty={unpublished}
        noun="site changes"
        onPublish={async (password) => {
          const res = await publishSiteWithPasswordAction(artistId, password)
          if (res.ok) router.refresh()
          return res
        }}
      />
    </>
  )
}
