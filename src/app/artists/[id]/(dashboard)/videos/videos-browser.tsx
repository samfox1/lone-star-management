'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { KLabel } from '@/components/ui/ui'
import { FilterBar } from '../filter-bar'
import { CardGrid } from '../card-grid'
import { PublishBar } from '../publish-bar'
import { EmptyState } from '../empty-state'
import { OnSiteFilter, filterBySite, siteEmptyTitle, type SiteFilter } from '../on-site-filter'
import { Segmented } from '../segmented'
import { OriginSection, groupByOrigin } from '../origin'
import { useLiveOnSite } from '../use-live-on-site'
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
// Uploaded (self-hosted) videos group first — the manager's own files sit above the
// synced YouTube library.
const ORIGIN_ORDER = ['uploaded', 'youtube', 'soundcloud'] as const

/**
 * Videos view: normal uploads and Shorts split into two tabs (mirroring the music
 * page's release-type split). Within a tab, the On-site/Off-site toggle filters by
 * publish state and cards are grouped by provider (origin). Shorts are keyed off the
 * `is_short` flag set at import (or from a pasted /shorts/ link). Each tile's checkbox
 * is a LIVE on-site toggle (ADR 0009) — it writes immediately and the public site
 * follows without a publish, the same control the editor gives videos. The PublishBar
 * publishes the video CONTENT (titles, embeds), which stays password-gated.
 */
export function VideosBrowser({
  videos,
  artistId,
  dirty = false,
  trailing,
}: {
  videos: VideoItem[]
  artistId: string
  /** Unpublished content edits — what lights up the PublishBar now that presence is live. */
  dirty?: boolean
  trailing?: ReactNode
}) {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>('videos')
  const [site, setSite] = useState<SiteFilter>('all')
  const [sort, setSort] = useState<Sort>('added')
  const { onSite, toggle } = useLiveOnSite(videos, 'video', artistId)

  const inKind = videos.filter((v) => (v.is_short ? kind === 'shorts' : kind === 'videos'))
  let shown = filterBySite(inKind, site)
  if (sort === 'az') shown = [...shown].sort((a, b) => a.title.localeCompare(b.title))

  const groups = groupByOrigin(shown, (v) => v.provider ?? 'youtube', ORIGIN_ORDER, providerLabel)

  async function publish(password: string) {
    // Snapshot only — no reconcile. The on-site set is already whatever the toggles say.
    const res = await publishEntityAction('video', artistId, password)
    if (res.ok) router.refresh()
    return res
  }

  return (
    <div className="space-y-6 pb-24">
      <FilterBar
        leading={
          <div className="flex flex-wrap items-center gap-3">
            <KLabel>
              {inKind.length} {inKind.length === 1 ? KIND_NOUN[kind].one : KIND_NOUN[kind].many}
            </KLabel>
            <Segmented
              label="Videos or Shorts"
              options={(['videos', 'shorts'] as Kind[]).map((k) => ({ key: k, label: KIND_LABEL[k] }))}
              value={kind}
              onChange={setKind}
            />
            <OnSiteFilter value={site} onChange={setSite} />
          </div>
        }
        chips={[]}
        active=""
        onChip={() => {}}
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
                    onSite={onSite(v.id)}
                    onToggleOnSite={() => toggle(v.id)}
                  />
                ))}
              </CardGrid>
            </OriginSection>
          ))}
        </div>
      )}

      <PublishBar pendingCount={0} dirty={dirty} onPublish={publish} noun="videos" />
    </div>
  )
}
