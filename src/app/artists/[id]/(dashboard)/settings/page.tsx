import Link from 'next/link'
import { Icon } from '@/components/ui/icons'
import { Button, Card, KLabel, buttonClass } from '@/components/ui/ui'
import { getShopifyDomain, requireArtist } from '../_data'
import { publishAction } from '../actions'

/**
 * Settings: the per-artist integrations hub + (soon) SEO/account. Config here
 * applies instantly — it is NOT part of the draft/publish flow. Connection state
 * lives per-artist on `artists.*_id` columns and the `integrations` table;
 * connect/pull controls still live on the section pages (linked via "Manage"),
 * to be folded in here as those pages are restyled.
 */
export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  const shopifyDomain = await getShopifyDomain(id)

  const providers = [
    { name: 'Spotify', desc: 'Catalog, tracks & artist id', connected: !!artist?.spotify_artist_id, detail: artist?.spotify_artist_id, seg: 'tracks' },
    { name: 'Apple Music', desc: 'Catalog source for releases', connected: !!artist?.apple_artist_id, detail: artist?.apple_artist_id, seg: 'tracks' },
    { name: 'Deezer', desc: 'Catalog source for releases', connected: !!artist?.deezer_artist_id, detail: artist?.deezer_artist_id, seg: 'tracks' },
    { name: 'YouTube', desc: 'Import music videos', connected: !!artist?.youtube_channel_id, detail: artist?.youtube_channel_id, seg: 'videos' },
    { name: 'Bandsintown', desc: 'Sync tour dates', connected: !!artist?.bandsintown_name, detail: artist?.bandsintown_name, seg: 'tour' },
    { name: 'Ticketmaster', desc: 'Import tour dates', connected: !!artist?.ticketmaster_attraction_id, detail: artist?.ticketmaster_attraction_id, seg: 'tour' },
    { name: 'Shopify', desc: 'Sync merch products', connected: !!shopifyDomain, detail: shopifyDomain, seg: 'merch' },
  ]

  return (
    <div className="space-y-10">
      <h1 className="text-[19px] font-bold tracking-[-0.01em]">Settings</h1>

      <section>
        <KLabel>This artist</KLabel>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <Link href={`/${artist.slug}`} className={buttonClass('ghost')}>
            View site <Icon name="external" size={15} />
          </Link>
          <Link href={`/artists/${id}/preview`} className={buttonClass('ghost')}>
            Preview
          </Link>
          <Link href={`/artists/${id}/edit`} className={buttonClass('ghost')}>
            Edit info
          </Link>
          <form action={publishAction.bind(null, id)}>
            <Button type="submit">Publish all</Button>
          </form>
        </div>
      </section>

      <section>
        <KLabel>Integrations · this artist</KLabel>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {providers.map((p) => (
            <Card key={p.name} className="flex flex-col gap-4 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-surface font-space text-sm font-bold">
                  {p.name[0]}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold">{p.name}</div>
                  <div className="mt-1 font-space text-[11px] leading-snug text-ink-muted">{p.desc}</div>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between gap-3">
                <span className="inline-flex min-w-0 items-center gap-2 font-space text-[11px] text-ink-muted">
                  {p.connected ? (
                    <>
                      <span className="h-[7px] w-[7px] flex-none rounded-full bg-accent" />
                      <span className="truncate">Connected{p.detail ? ` · ${p.detail}` : ''}</span>
                    </>
                  ) : (
                    <span className="text-ink-faint">Not connected</span>
                  )}
                </span>
                <Link href={`/artists/${id}/${p.seg}`} className={buttonClass('ghost')}>
                  Manage
                </Link>
              </div>
            </Card>
          ))}
        </div>
        <p className="mt-3 font-space text-xs text-ink-faint">
          Each artist connects their own sources — different artists can use different providers.
        </p>
      </section>

      <section>
        <KLabel>SEO &amp; account</KLabel>
        <p className="mt-2 font-space text-sm text-ink-muted">Coming soon.</p>
      </section>
    </div>
  )
}
