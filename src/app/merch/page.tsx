import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Icon } from '@/components/ui/icons'
import { EmptyState, RosterShell, SectionToolbar } from '../roster-chrome'
import { ownedArtists, rosterRows } from '../roster-data'

export const metadata = { title: 'Merch — Lone Star Management' }

export default async function MerchPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const artists = await ownedArtists(supabase)
  const rows = await rosterRows(supabase, 'merch', artists)

  return (
    <RosterShell active="merch" page="Merch" email={user?.email ?? null}>
      <SectionToolbar title="Merch" />
      {rows.length === 0 ? (
        <EmptyState
          icon="merch"
          title="No products yet"
          sub="Add merch inside an artist (Merch tab) or sync a Shopify store — products roll up here."
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5 px-7 pb-12">
          {rows.map(({ row, artist }) => {
            const img = row.image_url as string | null
            const price = row.price
            const hasPrice = price !== null && price !== undefined && price !== ''
            return (
              <Link key={row.id as string} href={`/artists/${artist.id}/merch`} className="group">
                <div className="aspect-square overflow-hidden rounded-xl border border-hairline bg-surface">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-ink-faint">
                      <Icon name="merch" size={32} />
                    </span>
                  )}
                </div>
                <div className="mt-2.5 truncate text-sm font-semibold group-hover:text-accent">
                  {row.title as string}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-space text-[11px] text-ink-muted">{artist.name}</span>
                  {hasPrice && (
                    <span className="flex-none font-space text-[13px] font-bold">{String(price)}</span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </RosterShell>
  )
}
