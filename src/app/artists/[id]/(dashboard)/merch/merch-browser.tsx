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
import { MerchCard, type MerchItem } from './merch-card'

type Sort = 'added' | 'az' | 'price'

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  shopify: 'Shopify',
}
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s
const ORIGIN_ORDER = ['shopify', 'manual'] as const

/** Numeric price for sorting; null/blank sorts last. */
function priceValue(p: string | number | null): number {
  if (p === null || p === '') return Number.POSITIVE_INFINITY
  const n = typeof p === 'number' ? p : Number(p)
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n
}

/**
 * Merch view: a filterable list (by source) of the artist's products, mirroring the
 * Music page. Each tile carries a select checkbox + live/off badge; the manager picks
 * which products are on the site and commits with the password-gated PublishBar. The
 * add form + Shopify connect live on the page above; this owns filter + sort + publish.
 */
export function MerchBrowser({
  items,
  artistId,
  trailing,
}: {
  items: MerchItem[]
  artistId: string
  trailing?: ReactNode
}) {
  const router = useRouter()
  const [site, setSite] = useState<SiteFilter>('all')
  const [sort, setSort] = useState<Sort>('added')
  const { selected, toggle, pendingCount } = useOnSiteSelection(items)

  let shown = filterBySite(items, site)
  if (sort === 'az') shown = [...shown].sort((a, b) => a.title.localeCompare(b.title))
  else if (sort === 'price') shown = [...shown].sort((a, b) => priceValue(a.price) - priceValue(b.price))

  const groups = groupByOrigin(shown, (i) => i.source ?? 'manual', ORIGIN_ORDER, sourceLabel)

  async function publish(password: string) {
    const res = await publishEntityAction('merch', artistId, [...selected], password)
    if (res.ok) router.refresh()
    return res
  }

  return (
    <div className="space-y-6 pb-24">
      <FilterBar
        leading={
          <div className="flex items-center gap-3">
            <KLabel>
              {items.length} {items.length === 1 ? 'product' : 'products'}
            </KLabel>
            <OnSiteFilter value={site} onChange={setSite} />
          </div>
        }
        chips={[]}
        active=""
        onChip={() => {}}
        sortOptions={[
          { key: 'added', label: 'Added' },
          { key: 'az', label: 'A–Z' },
          { key: 'price', label: 'Price' },
        ]}
        sort={sort}
        onSort={setSort}
        trailing={trailing}
      />

      {groups.length === 0 ? (
        <EmptyState
          icon="merch"
          title={siteEmptyTitle(site, 'No products yet')}
          hint={site === 'all' ? 'Hit + Add, or connect Shopify to sync.' : undefined}
        />
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <OriginSection key={g.key} label={g.label} count={g.items.length}>
              <CardGrid size="md" count={g.items.length}>
                {g.items.map((i) => (
                  <MerchCard
                    key={i.id}
                    item={i}
                    artistId={artistId}
                    selected={selected.has(i.id)}
                    onToggleSelect={() => toggle(i.id)}
                  />
                ))}
              </CardGrid>
            </OriginSection>
          ))}
        </div>
      )}

      <PublishBar pendingCount={pendingCount} onPublish={publish} noun="merch" />
    </div>
  )
}
