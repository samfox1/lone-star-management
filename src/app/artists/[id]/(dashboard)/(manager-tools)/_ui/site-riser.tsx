'use client'

import { useRouter } from 'next/navigation'
import { publishEntityAction, publishSiteWithPasswordAction } from '../../actions'
import { PublishRiser } from './publish-riser'

/**
 * THE SITE PUBLISH BAR: the rising bar Brand uses (Sam's round 2 mock), on every SEO / GEO tab and
 * on Profile (site-pending.tsx renders it). It ships what those pages change: the site's words,
 * the profile and the site's photos (`publishSiteWithPasswordAction`, as the old floating bar did),
 * and the artist's links when an SEO test's fix changed one (the Apple Music store fix is a DRAFT
 * until published). One password, each part only when it is waiting.
 *
 * Was tools/seo/seo-riser.tsx (`SeoRiser`) until Profile shared it (2026-10-02).
 */
export function SiteRiser({ artistId, site, links, message }: { artistId: string; site: boolean; links: boolean; message: string }) {
  const router = useRouter()
  return (
    <PublishRiser
      dirty={site || links}
      message={message}
      noun="site changes"
      onPublish={async (password) => {
        if (site) {
          const res = await publishSiteWithPasswordAction(artistId, password)
          if (!res.ok) return res
        }
        if (links) {
          const res = await publishEntityAction('link', artistId, password)
          if (!res.ok) return res
        }
        router.refresh()
        return { ok: true }
      }}
    />
  )
}
