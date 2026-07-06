import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { CATALOG_SOURCES, type CatalogSource } from '@/lib/catalog'
import { Icon } from '@/components/ui/icons'
import { KLabel } from '@/components/ui/ui'
import { SyncPanel } from '../../sync-panel'
import { ShopifyPanel } from '../../shopify-panel'
import { CatalogSourceForm } from '../../catalog-source-form'
import { getShopifyDomain, requireArtist } from '../../_data'
import {
  CATALOG_INTEGRATIONS,
  SECTION_LABEL,
  STANDALONE_INTEGRATIONS,
} from '../../integrations'
import {
  connectShopifyAction,
  disconnectShopifyAction,
  setCatalogSourceAction,
  syncShopifyAction,
} from '../../actions'

/**
 * Integrations hub (under Manager tools). Renders entirely from the INTEGRATIONS
 * registry: the catalog sources share one exclusive slot on Music, the standalone
 * sources are grouped by the section they feed, and Shopify (token-based) is
 * rendered on its own. Config applies instantly (not part of the draft/publish
 * flow); pulls land in draft rows and never overwrite manual edits. Per-artist.
 */
export default async function IntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const trackRows = await listContent(supabase, 'track', id)
  const shopifyDomain = await getShopifyDomain(id)

  const source = (artist.catalog_source ?? 'manual') as CatalogSource
  const activeCatalog = CATALOG_INTEGRATIONS.find((i) => i.catalogSource === source)
  const hasImportedTracks = source !== 'manual' && trackRows.some((r) => r.source === source)

  // Dropdown options for the exclusive catalog selector: manual + each catalog source.
  const catalogOptions = CATALOG_SOURCES.map((s) => ({
    value: s,
    label: s === 'manual' ? 'Manual only' : CATALOG_INTEGRATIONS.find((i) => i.catalogSource === s)!.label,
  }))

  // Standalone integrations grouped by the section they feed (videos, tour).
  const bySection = STANDALONE_INTEGRATIONS.reduce<Record<string, typeof STANDALONE_INTEGRATIONS>>(
    (acc, intg) => {
      ;(acc[intg.section] ??= []).push(intg)
      return acc
    },
    {},
  )

  return (
    <div className="space-y-10">
      <Link
        href={`/artists/${id}/tools`}
        className="inline-flex items-center gap-1 font-space text-xs text-ink-muted transition-colors hover:text-ink"
      >
        <Icon name="chevronLeft" size={15} /> Manager tools
      </Link>
      <div>
        <h1 className="text-[19px] font-bold tracking-[-0.01em]">Integrations</h1>
        <p className="mt-1 font-space text-xs text-ink-faint">
          Data sources for {artist.name}. Each artist connects their own — pulls land in draft rows,
          your manual edits are never overwritten.
        </p>
      </div>

      {/* Catalog — one exclusive importer feeding the Music tab */}
      <section>
        <KLabel>Catalog · Music</KLabel>
        <p className="mb-3 mt-1 font-space text-xs text-ink-faint">
          Import from one service. Switching replaces that import; your manual tracks stay.
        </p>
        <CatalogSourceForm
          action={setCatalogSourceAction.bind(null, id)}
          current={source}
          currentLabel={activeCatalog?.label ?? 'Manual only'}
          hasImportedTracks={hasImportedTracks}
          sources={catalogOptions}
        />
        {activeCatalog && (
          <div className="mt-3">
            <SyncPanel
              title={activeCatalog.label}
              idName={activeCatalog.idField}
              idValue={artist[activeCatalog.idField] ?? ''}
              placeholder={activeCatalog.placeholder}
              hasId={!!artist[activeCatalog.idField]}
              pullLabel={activeCatalog.pullLabel}
              saveAction={activeCatalog.save.bind(null, id)}
              pullAction={activeCatalog.pull.bind(null, id)}
            />
          </div>
        )}
      </section>

      {/* Standalone sources, grouped by the section they feed */}
      {(Object.keys(SECTION_LABEL) as Array<keyof typeof SECTION_LABEL>).map((section) => {
        const items = bySection[section] ?? []
        if (items.length === 0) return null
        return (
          <section key={section}>
            <KLabel>{SECTION_LABEL[section]}</KLabel>
            <div className="mt-3 space-y-3">
              {items.map((intg) => (
                <SyncPanel
                  key={intg.key}
                  title={intg.label}
                  idName={intg.idField}
                  idValue={artist[intg.idField] ?? ''}
                  placeholder={intg.placeholder}
                  hasId={!!artist[intg.idField]}
                  pullLabel={intg.pullLabel}
                  saveAction={intg.save.bind(null, id)}
                  pullAction={intg.pull.bind(null, id)}
                />
              ))}
            </div>
          </section>
        )
      })}

      {/* Merch — Shopify's token flow, rendered on its own */}
      <section>
        <KLabel>Merch</KLabel>
        <div className="mt-3">
          <ShopifyPanel
            storeDomain={shopifyDomain}
            connectAction={connectShopifyAction.bind(null, id)}
            pullAction={syncShopifyAction.bind(null, id)}
            disconnectAction={disconnectShopifyAction.bind(null, id)}
          />
        </div>
      </section>
    </div>
  )
}
