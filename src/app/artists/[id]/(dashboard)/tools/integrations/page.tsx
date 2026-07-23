import Link from 'next/link'
import { Icon } from '@/components/ui/icons'
import { KLabel } from '@/components/ui/ui'
import { SyncPanel } from '../../sync-panel'
import { ShopifyPanel } from '../../shopify-panel'
import { getShopifyDomain, requireArtist } from '../../_data'
import { INTEGRATIONS_BY_SECTION, SECTION_LABEL } from '../../integrations'
import { connectShopifyAction, disconnectShopifyAction, syncShopifyAction } from '../../actions'

/**
 * Integrations hub (under Manager tools). Renders entirely from the INTEGRATIONS
 * registry, grouped by the section each source feeds (Music / Videos / Tour). Every
 * source is independent — the three music services coexist and their catalogs MERGE
 * into union tracks — and Shopify (token-based) is rendered on its own. Config
 * applies instantly (not part of the draft/publish flow); pulls land in draft rows
 * and never overwrite manual edits. Per-artist.
 */
export default async function IntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Both are independent round-trips — run them together, not gate-then-domain.
  const [artist, shopifyDomain] = await Promise.all([requireArtist(id), getShopifyDomain(id)])

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
          your manual edits are never overwritten. Connect more than one music service and their
          catalogs merge into one list.
        </p>
      </div>

      {/* Every integration, grouped by the section it feeds (Music shows all connected services) */}
      {(Object.keys(SECTION_LABEL) as Array<keyof typeof SECTION_LABEL>).map((section) => {
        const items = INTEGRATIONS_BY_SECTION[section] ?? []
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
