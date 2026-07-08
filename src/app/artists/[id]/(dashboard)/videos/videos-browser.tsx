'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { KLabel } from '@/components/ui/ui'
import { FilterBar } from '../filter-bar'
import { CardGrid } from '../card-grid'
import { PublishBar } from '../publish-bar'
import { EmptyState } from '../empty-state'
import { OnSiteFilter, filterBySite, siteEmptyTitle, type SiteFilter } from '../on-site-filter'
import { OriginSection, groupByOrigin } from '../origin'
import { useOnSiteSelection } from '../use-on-site-selection'
import { publishEntityAction } from '../actions'
import { VideoCard, type VideoItem } from './video-card'

type Kind = 'videos' | 'shorts'
type Sort = 'added' | 'az'

const KIND_LABEL: Record<Kind, string> = { videos: 'Videos', shorts: 'Shorts' }
const KIND_NOUN: Record<Kind, { one: string; many: string }> = {
  videos: { one: 'video', many: 'videos' },
  shorts: { one: 'short', many: 'shorts' },
}

// Videos group by PROVIDER (their hosting) — that's what governs embedding rules: a
// YouTube clip embeds one way, an other-service embed another, a self-hosted upload
// another. `uploaded` is reserved for the upcoming video-file feature.
const PROVIDER_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  uploaded: 'Uploaded',
}
const providerLabel = (p: string) => PROVIDER_LABEL[p] ?? p
const ORIGIN_ORDER = ['youtube', 'soundcloud', 'uploaded'] as const

/**
 * Videos view: normal uploads and Shorts split into two tabs (mirroring the music
 * page's release-type split). Within a tab, the On-site/Off-site toggle filters by
 * publish state and cards are grouped by provider (origin). Shorts are keyed off the
 * `is_short` flag set at import (or from a pasted /shorts/ link). Each tile carries a
 * select checkbox + live/off badge; the manager picks which are on the site and
 * commits with the password-gated PublishBar.
 */
export function VideosBrowser({
  videos,
  artistId,
  trailing,
}: {
  videos: VideoItem[]
  artistId: string
  trailing?: ReactNode
}) {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>('videos')
  const [site, setSite] = useState<SiteFilter>('all')
  const [sort, setSort] = useState<Sort>('added')
  const { selected, toggle, pendingCount } = useOnSiteSelection(videos)

  const inKind = videos.filter((v) => (v.is_short ? kind === 'shorts' : kind === 'videos'))
  let shown = filterBySite(inKind, site)
  if (sort === 'az') shown = [...shown].sort((a, b) => a.title.localeCompare(b.title))

  const groups = groupByOrigin(shown, (v) => v.provider ?? 'youtube', ORIGIN_ORDER, providerLabel)

  async function publish(password: string) {
    const res = await publishEntityAction('video', artistId, [...selected], password)
    if (res.ok) router.refresh()
    return res
  }

  return (
    <div className="space-y-6 pb-24">
      <FilterBar
        leading={
          <div className="flex items-center gap-3">
            <KLabel>
              {inKind.length} {inKind.length === 1 ? KIND_NOUN[kind].one : KIND_NOUN[kind].many}
            </KLabel>
            <OnSiteFilter value={site} onChange={setSite} />
          </div>
        }
        chips={(['videos', 'shorts'] as Kind[]).map((k) => ({ key: k, label: KIND_LABEL[k] }))}
        active={kind}
        onChip={(k) => setKind(k as Kind)}
        sortOptions={[
          { key: 'added', label: 'Added' },
          { key: 'az', label: 'A–Z' },
        ]}
        sort={sort}
        onSort={setSort}
        trailing={trailing}
      />

      {groups.length === 0 ? (
        kind === 'shorts' ? (
          <EmptyState
            icon="videos"
            title={siteEmptyTitle(site, 'No Shorts yet')}
            hint={site === 'all' ? 'Import your channel or paste a YouTube Shorts link.' : undefined}
          />
        ) : (
          <EmptyState
            icon="videos"
            title={siteEmptyTitle(site, 'No videos yet')}
            hint={site === 'all' ? 'Hit + Add to paste a YouTube link, or import your channel.' : undefined}
          />
        )
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <OriginSection key={g.key} label={g.label} count={g.items.length}>
              <CardGrid size={kind === 'shorts' ? 'short' : 'lg'} count={g.items.length}>
                {g.items.map((v) => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    artistId={artistId}
                    selected={selected.has(v.id)}
                    onToggleSelect={() => toggle(v.id)}
                  />
                ))}
              </CardGrid>
            </OriginSection>
          ))}
        </div>
      )}

      <PublishBar pendingCount={pendingCount} onPublish={publish} noun="videos" />
    </div>
  )
}
